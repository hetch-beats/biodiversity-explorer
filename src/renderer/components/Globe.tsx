import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import ThreeGlobe from 'three-globe'
import { useGlobeStore } from '../stores/globeStore'
import { useSpeciesStore } from '../stores/speciesStore'
import { useUiStore } from '../stores/uiStore'
import { useTextureStore } from '../stores/textureStore'
import { IconFlame, IconLoaderCircle, IconMapPin } from './icons'
import GlobeViewSwitcher from './GlobeViewSwitcher'
import { WORLD_COUNTRY_RINGS } from '../data/worldMap'
import { GlobeImagery, gpuInfo, type GpuInfo } from '../globe/imagery'
import { VIEWS } from '../globe/views'
import type { Occurrence } from '../types'

// Every occurrence point (and the fallback country-border overlay) is
// positioned with globe.getCoords(lat, lng, altitude) — three-globe's own,
// documented coordinate-conversion method — rather than a hand-rolled
// lat/lng-to-XYZ formula. That's the entire point of this rewrite: an
// earlier hand-rolled version needed three separate compensating fixes
// (a rotation, an inverted texture flag, a mirrored UV scale) and still
// ended up wrong, because the sphere's texture mapping and our own point
// math were two independently-maintained systems that had to be kept in
// sync by hand. Routing everything through the globe's own conversion
// method makes that class of bug structurally impossible: there's only one
// system now, and it's the one that also renders the texture.
// Globe overlays (legend, tooltips, status) follow the active theme instead of
// fixed black boxes: a translucent panel surface with the theme's border.
const OVERLAY =
  'rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--bg-secondary))]/90 text-[rgb(var(--text-primary))] shadow-overlay backdrop-blur-sm'

/** The active theme's --bg-primary as a THREE.Color (CSS stores it as "r g b"). */
function themeBackground(): THREE.Color {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()
  const [r, g, b] = raw.split(/[\s,]+/).map(Number)
  if ([r, g, b].some((n) => !Number.isFinite(n))) return new THREE.Color(0x0b0e16)
  return new THREE.Color(`rgb(${r}, ${g}, ${b})`)
}

const MAX_RENDERED_POINTS = 4000 // perf guard so this stays smooth on modest hardware
const DEFAULT_ALTITUDE = 2.2 // camera height above the surface, in globe radii
// Closest zoom: deep enough to use GIBS's finest tiles when streaming, but no
// closer than the bundled texture stays sharp when it isn't.
const MIN_ALTITUDE_STREAMING = 0.12
const MIN_ALTITUDE_BUNDLED = 0.4

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
const PRIMARY_COLOR = 0xfa9e29
const COMPARISON_COLOR = 0x40bffb

/*
 * Heatmap (Points / Heatmap toggle): a kernel density estimate of the
 * selected species' GBIF occurrence records, weighted by log(1 + each cell's record
 * count), drawn by three-globe's heatmap layer (same coordinate system as the
 * globe texture). It shows where records are dense — observation effort
 * shapes it as much as abundance, so it is labelled "record density", never
 * population size. Sequential yellow → red → plum ramp (readable on light
 * and dark imagery); opacity rises with density so sparse areas fade out.
 */
const HEAT_STOPS: [number, [number, number, number]][] = [
  [0, [255, 237, 160]],
  [0.35, [254, 178, 76]],
  [0.65, [240, 59, 32]],
  [1, [122, 1, 119]]
]
const HEAT_GRADIENT_CSS = `linear-gradient(to right, ${HEAT_STOPS.map(
  ([t, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${t * 100}%`
).join(', ')})`
function heatColor(t: number): string {
  const x = clamp(t, 0, 1)
  let i = 1
  while (i < HEAT_STOPS.length - 1 && x > HEAT_STOPS[i][0]) i++
  const [t0, c0] = HEAT_STOPS[i - 1]
  const [t1, c1] = HEAT_STOPS[i]
  const f = (x - t0) / (t1 - t0 || 1)
  const [r, g, b] = c0.map((v, k) => Math.round(v + (c1[k] - v) * f))
  return `rgba(${r}, ${g}, ${b}, ${Math.cbrt(x) * 0.9})`
}
/** Kernel width in degrees: wide enough to merge neighbouring records into regions. */
const HEAT_BANDWIDTH = 2

export default function Globe(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const globeRef = useRef<ThreeGlobe | null>(null)
  const globeRadiusRef = useRef(100)
  const primaryGroupRef = useRef<THREE.Group | null>(null)
  const comparisonGroupRef = useRef<THREE.Group | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const imageryRef = useRef<GlobeImagery | null>(null)
  const gpuRef = useRef<GpuInfo | null>(null)
  const bordersRef = useRef<{ group: THREE.Group; material: THREE.LineBasicMaterial } | null>(null)
  // Markers are sized for the default view; they shrink as the camera closes
  // in so they don't swamp the map at street-level zoom.
  const markerScaleRef = useRef(1)

  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  const occurrencePoints = useGlobeStore((s) => s.occurrencePoints)
  const screenshotRequestId = useGlobeStore((s) => s.screenshotRequestId)
  const syncingSpecies = useGlobeStore((s) => s.syncingSpecies)
  const syncMessage = useGlobeStore((s) => s.syncMessage)
  const comparisonSpecies = useSpeciesStore((s) => s.comparisonSpecies)
  const selectedSpecies = useSpeciesStore((s) => s.selectedSpecies)
  const theme = useUiStore((s) => s.theme)
  const highContrast = useUiStore((s) => s.highContrastMode)
  const globeView = useUiStore((s) => s.globeView)
  const streamDetail = useUiStore((s) => s.globeStreamDetail)
  const ultraDetail = useUiStore((s) => s.globeUltraDetail)
  const textureRevision = useTextureStore((s) => s.revision)
  const occurrenceDisplay = useUiStore((s) => s.occurrenceDisplay)
  const setOccurrenceDisplay = useUiStore((s) => s.setOccurrenceDisplay)
  const setImagery = useGlobeStore((s) => s.setImagery)
  const setGpu = useGlobeStore((s) => s.setGpu)
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const [comparisonPoints, setComparisonPoints] = useState<{ lat: number; lng: number }[]>([])

  // Match the scene background to the theme. Deferred a frame: App applies the
  // new data-theme attribute in its own effect, which runs after this child's.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (sceneRef.current) sceneRef.current.background = themeBackground()
    })
    return () => cancelAnimationFrame(id)
  }, [theme, highContrast])

  // --- one-time scene setup ---
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.background = themeBackground()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.rotateSpeed = 0.5
    controls.zoomSpeed = 0.7
    controlsRef.current = controls

    // Intensities are set per view by GlobeImagery.
    const ambient = new THREE.AmbientLight(0xffffff, 1)
    scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffffff, 1)
    sun.position.set(-1, 1.2, 1)
    scene.add(sun)

    // animateIn off: three-globe's intro spins and scales the globe for ~1s,
    // during which the occurrence markers (separate scene objects) would sit
    // over the wrong places.
    const globe = new ThreeGlobe({ animateIn: false })
    globeRef.current = globe
    scene.add(globe)

    // getCoords is pure spherical math, independent of texture load state,
    // so it's safe to measure the globe's actual radius right away rather
    // than trusting an assumed constant.
    const surfacePoint = globe.getCoords(0, 0, 0) as { x: number; y: number; z: number }
    const radius = Math.hypot(surfacePoint.x, surfacePoint.y, surfacePoint.z) || 100
    globeRadiusRef.current = radius

    camera.position.set(0, 0, radius * (1 + DEFAULT_ALTITUDE))
    controls.minDistance = radius * (1 + MIN_ALTITUDE_BUNDLED)
    controls.maxDistance = radius * 8
    controls.update()

    globe.showGraticules(true)

    const gpu = gpuInfo(renderer)
    gpuRef.current = gpu
    setGpu(gpu)
    imageryRef.current = new GlobeImagery({
      globe,
      scene,
      renderer,
      radius,
      ambient,
      sun,
      onTilesActiveChange: (tilesActive) => useGlobeStore.getState().setImagery({ tilesActive })
    })

    // Natural Earth country outlines (world-atlas, bundled): drawn over the
    // Simple view, and over the plain fallback sphere when no imagery has been
    // downloaded at all. Colour and visibility are set by the view effect.
    const bordersGroup = new THREE.Group()
    bordersGroup.visible = false
    scene.add(bordersGroup)
    const bordersMat = new THREE.LineBasicMaterial({ color: 0x8cb8ea, transparent: true, opacity: 0.55 })
    for (const ring of WORLD_COUNTRY_RINGS) {
      const pts = ring.map(([lng, lat]) => {
        const c = globe.getCoords(lat, lng, 0.003) as { x: number; y: number; z: number }
        return new THREE.Vector3(c.x, c.y, c.z)
      })
      const geom = new THREE.BufferGeometry().setFromPoints(pts)
      bordersGroup.add(new THREE.Line(geom, bordersMat))
    }
    bordersRef.current = { group: bordersGroup, material: bordersMat }

    const primaryGroup = new THREE.Group()
    scene.add(primaryGroup)
    primaryGroupRef.current = primaryGroup

    const comparisonGroup = new THREE.Group()
    scene.add(comparisonGroup)
    comparisonGroupRef.current = comparisonGroup

    // --- hover tooltips: our own raycasting against the point meshes above,
    // since three-globe's points layer doesn't expose hover/click events. ---
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    function onPointerMove(ev: PointerEvent): void {
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects([...primaryGroup.children, ...comparisonGroup.children], false)[0]
      if (hit?.object.userData.tooltip) {
        setTooltip({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, text: hit.object.userData.tooltip as string })
      } else {
        setTooltip(null)
      }
    }
    canvas.addEventListener('pointermove', onPointerMove)

    let frameId = 0
    let lastAltitude = -1
    function animate(): void {
      controls.update()
      const altitude = camera.position.length() / radius - 1
      if (Math.abs(altitude - lastAltitude) > 1e-4) {
        lastAltitude = altitude
        const nearness = clamp(altitude / DEFAULT_ALTITUDE, 0.06, 1)
        // A fixed rotate speed flings the surface past at close zoom.
        controls.rotateSpeed = 0.5 * clamp(nearness, 0.08, 1)
        const scale = clamp(nearness, 0.12, 1)
        if (scale !== markerScaleRef.current) {
          markerScaleRef.current = scale
          for (const child of primaryGroup.children) child.scale.setScalar(scale)
          for (const child of comparisonGroup.children) child.scale.setScalar(scale)
        }
      }
      imageryRef.current?.update(camera)
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }
    animate()

    // Resizing a WebGL drawing buffer clears it. The frame loop above renders
    // at the START of a frame, but ResizeObserver callbacks fire AFTER layout,
    // just before paint — so a resize there used to hand the compositor an
    // empty buffer, once per frame while a docked sheet animated its width:
    // the black flash. Rendering again right after setSize() fills the buffer
    // before paint. Skipping no-op sizes avoids needless buffer reallocation.
    let lastW = 0
    let lastH = 0
    let lastDpr = Math.min(window.devicePixelRatio, 2)
    function resize(): void {
      const { clientWidth, clientHeight } = canvas
      if (clientWidth === 0 || clientHeight === 0) return
      const dpr = Math.min(window.devicePixelRatio, 2)
      if (clientWidth === lastW && clientHeight === lastH && dpr === lastDpr) return
      if (dpr !== lastDpr) renderer.setPixelRatio(dpr) // window moved to a monitor with different scaling
      lastW = clientWidth
      lastH = clientHeight
      lastDpr = dpr
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight, false)
      imageryRef.current?.setViewport(clientHeight * dpr)
      renderer.render(scene, camera)
    }
    resize()
    // CSS-driven layout changes (a docked sheet opening/closing) resize this
    // canvas without a window 'resize' event, so watch the canvas itself.
    const resizeObserver = new ResizeObserver(resize)
    window.addEventListener('resize', resize) // catches scaling changes that don't alter CSS size
    resizeObserver.observe(canvas)

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointermove', onPointerMove)
      controls.dispose()
      imageryRef.current?.dispose()
      imageryRef.current = null
      controlsRef.current = null
      bordersRef.current = null
      renderer.dispose()
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      globeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- surface imagery: view, 16K and streaming settings ---
  useEffect(() => {
    const imagery = imageryRef.current
    const gpu = gpuRef.current
    if (!imagery || !gpu) return
    let cancelled = false
    setImagery({ loading: true })
    imagery.setView(globeView, { ultra: ultraDetail, gpu, revision: textureRevision }).then((result) => {
      if (cancelled || !result.current) return
      if (result.loaded === 'none' && imagery.material.map) {
        // This view isn't downloaded; the previous imagery is still showing.
        // Go back to Satellite, which always has at least the 4K fallback.
        console.warn(`[globe] "${globeView}" imagery isn't downloaded — turn on Settings → Globe → 8K globe imagery.`)
        setImagery({ loading: false })
        if (globeView !== 'satellite') useUiStore.getState().setGlobeView('satellite')
        return
      }
      if (result.loaded === 'none' && globeView !== 'satellite') {
        // Nothing on the globe yet and the saved view is missing: try Satellite.
        useUiStore.getState().setGlobeView('satellite')
        return
      }
      const stylized = result.loaded === 'none'
      const borders = bordersRef.current
      if (borders) {
        borders.group.visible = stylized || VIEWS[globeView].borders
        // Dark outlines on the light Gray Earth; pale ones on the dark fallback.
        borders.material.color.set(stylized ? 0x8cb8ea : 0x3f4a56)
        borders.material.opacity = stylized ? 0.55 : 0.6
      }
      setImagery({ view: stylized ? null : globeView, loaded: result.loaded, loading: false })
    })
    return () => {
      cancelled = true
    }
  }, [globeView, ultraDetail, textureRevision, setImagery])

  useEffect(() => {
    const imagery = imageryRef.current
    const controls = controlsRef.current
    if (!imagery || !controls) return
    const streaming = streamDetail && online
    imagery.setTilesAllowed(streaming)
    const canZoomDeep = streaming && !!VIEWS[globeView].tiles
    controls.minDistance = globeRadiusRef.current * (1 + (canZoomDeep ? MIN_ALTITUDE_STREAMING : MIN_ALTITUDE_BUNDLED))
  }, [streamDetail, online, globeView])

  // --- render primary occurrence points ---
  useEffect(() => {
    const globe = globeRef.current
    const group = primaryGroupRef.current
    if (!globe || !group) return

    group.clear()
    if (occurrenceDisplay === 'heatmap') {
      // Accessors before data, so the first density pass already uses them.
      globe
        .heatmapPoints('points')
        .heatmapPointLat('lat')
        .heatmapPointLng('lng')
        // log weighting: record counts per cell are heavily skewed (a few
        // well-surveyed parks hold most records), so linear weights collapse
        // the map into one hotspot. The legend says "log scale".
        .heatmapPointWeight((p: object) => Math.log1p((p as { count: number }).count))
        .heatmapBandwidth(HEAT_BANDWIDTH)
        .heatmapColorFn(() => heatColor)
        .heatmapBaseAltitude(0.006)
        .heatmapTopAltitude(0.03)
        .heatmapsData(occurrencePoints.length ? [{ points: occurrencePoints }] : [])
      return
    }
    globe.heatmapsData([])
    const radius = globeRadiusRef.current
    const geom = new THREE.SphereGeometry(radius * 0.011, 8, 8)
    const mat = new THREE.MeshBasicMaterial({ color: PRIMARY_COLOR })

    for (const p of occurrencePoints.slice(0, MAX_RENDERED_POINTS)) {
      const c = globe.getCoords(p.lat, p.lng, 0.015) as { x: number; y: number; z: number }
      const mesh = new THREE.Mesh(geom, mat)
      mesh.position.set(c.x, c.y, c.z)
      mesh.scale.setScalar(markerScaleRef.current)
      mesh.userData.tooltip = `${selectedSpecies?.common_name ?? 'Species'} – ${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}`
      group.add(mesh)
    }
  }, [occurrencePoints, selectedSpecies, occurrenceDisplay])

  // --- fetch + render comparison species points ---
  useEffect(() => {
    let cancelled = false
    if (!comparisonSpecies) {
      setComparisonPoints([])
      return
    }
    const species = comparisonSpecies

    async function loadComparison(): Promise<void> {
      let occ: Occurrence[] = await window.api.getOccurrences(species.id)
      // Same first-view auto-sync App.tsx does for the primary species — a
      // species picked for comparison may never have been synced either, or
      // may have a stale gbif_key from before the /species/match fix (which
      // points at the wrong taxon and has zero real occurrences), so gate on
      // actual cached data rather than gbif_key's mere presence.
      if (occ.length === 0) {
        await window.api.refreshSpeciesData(species.id)
        if (cancelled) return
        occ = await window.api.getOccurrences(species.id)
      }
      if (cancelled) return
      setComparisonPoints(occ.map((o) => ({ lat: o.latitude, lng: o.longitude })))
    }

    loadComparison()
    return () => {
      cancelled = true
    }
  }, [comparisonSpecies])

  useEffect(() => {
    const globe = globeRef.current
    const group = comparisonGroupRef.current
    if (!globe || !group) return

    group.clear()
    if (!comparisonSpecies) return
    const radius = globeRadiusRef.current
    const geom = new THREE.SphereGeometry(radius * 0.011, 8, 8)
    const mat = new THREE.MeshBasicMaterial({ color: COMPARISON_COLOR })

    for (const p of comparisonPoints.slice(0, MAX_RENDERED_POINTS)) {
      const c = globe.getCoords(p.lat, p.lng, 0.02) as { x: number; y: number; z: number }
      const mesh = new THREE.Mesh(geom, mat)
      mesh.position.set(c.x, c.y, c.z)
      mesh.scale.setScalar(markerScaleRef.current)
      mesh.userData.tooltip = `${comparisonSpecies.common_name} – ${p.lat.toFixed(1)}, ${p.lng.toFixed(1)}`
      group.add(mesh)
    }
  }, [comparisonPoints, comparisonSpecies])

  // --- screenshot export ---
  useEffect(() => {
    if (screenshotRequestId === 0) return
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    if (!renderer || !scene || !camera) return

    const prevSize = new THREE.Vector2()
    renderer.getSize(prevSize)
    const prevAspect = camera.aspect

    renderer.setSize(1600, 1000, false)
    camera.aspect = 1600 / 1000
    camera.updateProjectionMatrix()
    renderer.render(scene, camera)

    const dataUrl = renderer.domElement.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `biodiversity-explorer-${Date.now()}.png`
    a.click()

    renderer.setSize(prevSize.x, prevSize.y, false)
    camera.aspect = prevAspect
    camera.updateProjectionMatrix()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshotRequestId])

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full outline-none touch-none block" />

      {tooltip && (
        <div
          className={`pointer-events-none absolute z-10 px-2 py-1 text-xs ${OVERLAY}`}
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.text}
        </div>
      )}

      {comparisonSpecies && (
        <div className={`absolute top-inset left-inset z-10 px-2.5 py-1.5 text-xs flex items-center gap-3 ${OVERLAY}`}>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#fa9e29]" />
            {selectedSpecies?.common_name ?? 'Selected'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#40bffb]" />
            {comparisonSpecies.common_name}
          </span>
        </div>
      )}

      {syncingSpecies && (
        <div className={`absolute top-inset right-inset z-10 px-2.5 py-1.5 text-xs flex items-center gap-2 ${OVERLAY}`}>
          <IconLoaderCircle size={14} className="animate-spin text-[rgb(var(--accent))]" />
          Fetching occurrence data from GBIF…
        </div>
      )}

      {!syncingSpecies && syncMessage && (
        <div className={`absolute top-inset right-inset z-10 px-2.5 py-1.5 text-xs max-w-xs text-right ${OVERLAY}`}>
          {syncMessage}
        </div>
      )}

      {/* Bottom overlay row: occurrence display (left) and map view (right).
          wrap-reverse: when the globe column is too narrow for both, the
          view picker moves up a line instead of overlapping. */}
      <div className="absolute inset-x-inset bottom-inset z-10 flex flex-wrap-reverse items-end justify-between gap-2 pointer-events-none">
        {selectedSpecies && occurrencePoints.length > 0 && (
          <div className="pointer-events-auto flex flex-col items-start gap-2">
            {occurrenceDisplay === 'points' && occurrencePoints.length > MAX_RENDERED_POINTS && (
              <div className={`px-2.5 py-1.5 text-xs ${OVERLAY}`}>
                Showing {MAX_RENDERED_POINTS.toLocaleString()} of {occurrencePoints.length.toLocaleString()} occurrence
                points (capped for smooth performance)
              </div>
            )}
            <div className={`p-1.5 flex flex-col gap-1.5 ${OVERLAY}`}>
              <div role="group" aria-label="Occurrence display" className="flex gap-1">
                {(['points', 'heatmap'] as const).map((mode) => {
                  const active = occurrenceDisplay === mode
                  const Icon = mode === 'points' ? IconMapPin : IconFlame
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setOccurrenceDisplay(mode)}
                      className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors ${
                        active
                          ? 'bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))]'
                          : 'text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--text-primary))]'
                      }`}
                    >
                      <Icon size={13} />
                      {mode === 'points' ? 'Points' : 'Heatmap'}
                    </button>
                  )
                })}
              </div>
              {occurrenceDisplay === 'heatmap' && (
                <div className="px-1 pb-0.5 w-52">
                  <div className="h-2 rounded-full" style={{ background: HEAT_GRADIENT_CSS }} />
                  <div className="mt-1 flex justify-between text-3xs text-[rgb(var(--text-secondary))]">
                    <span>Fewer records</span>
                    <span>More records (log scale)</span>
                  </div>
                  <p className="mt-1 text-3xs leading-snug text-[rgb(var(--text-secondary))]">
                    Density of GBIF occurrence records — reflects where the species is recorded, not population size.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="pointer-events-auto ml-auto">
          <GlobeViewSwitcher overlayClass={OVERLAY} />
        </div>
      </div>
    </div>
  )
}
