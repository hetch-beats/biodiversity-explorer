import * as THREE from 'three'
import SlippyMapGlobe from 'three-slippy-map-globe'
import type ThreeGlobe from 'three-globe'
import { LEGACY_SATELLITE_TEXTURE, VIEWS, textureUrl, type GlobeView } from './views'

/**
 * Owns the globe's surface imagery: the bundled texture for the active view,
 * the optional NASA GIBS zoom tiles on top of it, and view-appropriate
 * lighting. Pure three.js (no React) so it can be exercised headlessly.
 *
 * Geometry is never ours: the bundled texture is mapped by three-globe's own
 * sphere, and tiles are placed by three-slippy-map-globe — the same tile
 * engine three-globe embeds for its `globeTileEngineUrl`. We run our own
 * instance only because three-globe HIDES the base sphere whenever its tile
 * engine is on, which would leave a blank globe offline and at the poles
 * (Web Mercator stops at ±85°). Ours sits just above the base sphere instead,
 * so the bundled texture always shows through wherever a tile is missing.
 */

export type LoadedTexture = '16k' | '8k' | 'legacy-4k' | 'none'

export interface ViewResult {
  view: GlobeView
  /** Which texture ended up on the globe; 'none' = the view isn't downloaded. */
  loaded: LoadedTexture
  /** False when a newer setView() call superseded this one. */
  current: boolean
}

export interface GpuInfo {
  maxTextureSize: number
  software: boolean
  supports16k: boolean
}

// Tiles float 0.1% above the base sphere (0.1 units at the default radius of
// 100) so the two surfaces never z-fight. Occurrence markers sit at 1.5%.
const TILE_LIFT = 1.001

// A tile level is worth drawing once its pixels are at least as dense as the
// screen's. Visible arc ≈ 2·alt·tan(fov/2) radii ≈ 47.5·alt degrees for a 45°
// FOV, so tiles (256·2^L px per 360°) match the screen at 2^L ≈ 0.0296·H/alt
// for a canvas H device pixels tall. 0.025 accepts ~1.2× upscaling in
// exchange for ~30% fewer tile requests.
const TILE_DENSITY = 0.025
const POV_THROTTLE_MS = 120
const MERCATOR_MAX_LAT = 85.0511287798

export function gpuInfo(renderer: THREE.WebGLRenderer): GpuInfo {
  const gl = renderer.getContext()
  const maxTextureSize = renderer.capabilities.maxTextureSize
  let rendererName = ''
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (ext) rendererName = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
  } catch {
    // extension unavailable — treat as hardware
  }
  const software = /swiftshader|llvmpipe|softpipe|basic render/i.test(rendererName)
  return { maxTextureSize, software, supports16k: maxTextureSize >= 16384 && !software }
}

class MissingTexture extends Error {}

/**
 * Decode an image into a texture, off the main thread where the platform
 * allows. fetch → Blob → createImageBitmap decodes in a background worker
 * (textures come from the globe-texture:// protocol, which supports fetch).
 * If fetch fails for any other reason, fall back to <img> + decode() — also
 * asynchronous.
 */
async function decodeTexture(url: string, renderer: THREE.WebGLRenderer): Promise<{ texture: THREE.Texture; width: number }> {
  let texture: THREE.Texture
  let width: number
  try {
    const res = await fetch(url)
    // 404 from globe-texture:// (or a non-image body) means it isn't on disk.
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new MissingTexture()
    const blob = await res.blob()
    // ImageBitmaps ignore texture.flipY at upload; flip during decode instead
    // (three.js's documented ImageBitmap convention).
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' })
    texture = new THREE.Texture(bitmap)
    texture.flipY = false
    width = bitmap.width
  } catch (err) {
    if (err instanceof MissingTexture) throw err
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode() // rejects if the file is missing or corrupt
    texture = new THREE.Texture(img)
    width = img.naturalWidth
  }
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  texture.needsUpdate = true
  // Upload now, while the previous view is still on screen, so the swap
  // itself is a single frame instead of a hitch on the next render.
  renderer.initTexture(texture)
  // The GPU holds the pixels now; release the CPU copy (128 MB at 8K).
  if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close()
  return { texture, width }
}

interface Deps {
  globe: ThreeGlobe
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  radius: number
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  /** Called when the GIBS tile layer starts or stops being drawn. */
  onTilesActiveChange?: (active: boolean) => void
}

export class GlobeImagery {
  readonly material: THREE.MeshPhongMaterial
  private readonly slippy: SlippyMapGlobe
  private view: GlobeView | null = null
  private texture: THREE.Texture | null = null
  private baseLevel = 0 // tile level whose resolution equals the bundled texture's
  private token = 0
  private tilesAllowed = true
  private tilesOn = false
  private thresholds: number[] = []
  private readonly lastPos = new THREE.Vector3(NaN, NaN, NaN)
  private lastPovAt = 0
  private povTimer: ReturnType<typeof setTimeout> | null = null
  private camera: THREE.Camera | null = null
  private disposed = false

  constructor(private readonly deps: Deps) {
    // Low, dim specular: a faint sheen reads as a sphere without glare
    // washing out the imagery.
    this.material = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x111111, shininess: 6 })
    deps.globe.globeMaterial(this.material)

    this.slippy = new SlippyMapGlobe(deps.radius * TILE_LIFT, { mercatorProjection: true })
    this.slippy.visible = false
    // Web Mercator tiles only reach ±85.0511°; the tile engine fills the polar
    // caps by smearing each tile's edge row up to the pole. Clip every tile at
    // the Mercator limit instead, so the correctly projected bundled texture
    // shows at the poles. (The globe's north axis is +Y.)
    deps.renderer.localClippingEnabled = true
    const capY = deps.radius * TILE_LIFT * Math.sin((MERCATOR_MAX_LAT * Math.PI) / 180)
    const polarClip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), capY), new THREE.Plane(new THREE.Vector3(0, 1, 0), capY)]
    const addTile = this.slippy.add.bind(this.slippy)
    this.slippy.add = (...objects: THREE.Object3D[]) => {
      for (const o of objects) {
        const mat = (o as THREE.Mesh).material
        if (mat && !Array.isArray(mat)) mat.clippingPlanes = polarClip
      }
      return addTile(...objects)
    }
    deps.scene.add(this.slippy)
    this.setViewport(1000)
    this.applyLighting('lit')
  }

  /** Canvas height in device pixels — sets how early deeper tiles kick in. */
  setViewport(heightDevicePx: number): void {
    const k = TILE_DENSITY * Math.max(200, heightDevicePx)
    this.thresholds = Array.from({ length: 30 }, (_, i) => k / 2 ** i)
    this.slippy.thresholds = this.thresholds
    this.lastPos.set(NaN, NaN, NaN) // force re-evaluation
  }

  /** Online zoom detail on/off (user setting AND network availability). */
  setTilesAllowed(allowed: boolean): void {
    if (allowed === this.tilesAllowed) return
    this.tilesAllowed = allowed
    this.lastPos.set(NaN, NaN, NaN)
  }

  async setView(view: GlobeView, opts: { ultra: boolean; gpu: GpuInfo; revision?: number }): Promise<ViewResult> {
    const token = ++this.token
    const spec = VIEWS[view]
    const candidates: { file: string; kind: LoadedTexture }[] = []
    if (opts.ultra && opts.gpu.supports16k && spec.texture16k) candidates.push({ file: spec.texture16k, kind: '16k' })
    candidates.push({ file: spec.texture, kind: '8k' })
    if (view === 'satellite') candidates.push({ file: LEGACY_SATELLITE_TEXTURE, kind: 'legacy-4k' })

    for (const c of candidates) {
      let decoded: { texture: THREE.Texture; width: number }
      try {
        decoded = await decodeTexture(textureUrl(c.file, opts.revision), this.deps.renderer)
      } catch {
        if (token !== this.token || this.disposed) return { view, loaded: 'none', current: false }
        continue // not downloaded (or unreadable) — try the next candidate
      }
      if (token !== this.token || this.disposed) {
        decoded.texture.dispose()
        return { view, loaded: c.kind, current: false }
      }
      this.applyTexture(view, decoded.texture, decoded.width)
      return { view, loaded: c.kind, current: true }
    }
    // Nothing for this view on disk. Keep whatever is showing; only fall back
    // to the plain stylized sphere if there is nothing at all yet.
    if (!this.texture) this.applyStylized()
    return { view, loaded: 'none', current: true }
  }

  private applyTexture(view: GlobeView, texture: THREE.Texture, width: number): void {
    const previous = this.texture
    const viewChanged = view !== this.view
    this.view = view
    this.texture = texture
    this.baseLevel = Math.max(0, Math.round(Math.log2(width / 256)))
    this.material.map = texture
    this.material.color.set(0xffffff)
    this.material.needsUpdate = true
    previous?.dispose()
    this.applyLighting(VIEWS[view].lighting)
    if (viewChanged) this.resetTiles()
    this.lastPos.set(NaN, NaN, NaN)
  }

  private applyStylized(): void {
    this.view = null
    this.material.map = null
    this.material.color.set(0x17233a)
    this.material.needsUpdate = true
    this.applyLighting('lit')
    this.resetTiles()
  }

  private applyLighting(mode: 'lit' | 'flat'): void {
    // three.js r155+ uses physical light units: a Lambert/Phong surface under
    // an intensity-π ambient light shows its texture colour exactly.
    if (mode === 'flat') {
      // Night lights are emitted, not reflected: no day/night shading.
      this.deps.ambient.intensity = Math.PI
      this.deps.sun.intensity = 0
    } else {
      // Soft sun: texture brightness from 0.75× (limb) to ~1.15× (sub-solar).
      this.deps.ambient.intensity = 0.75 * Math.PI
      this.deps.sun.intensity = 0.4 * Math.PI
    }
  }

  private resetTiles(): void {
    this.slippy.tileUrl = undefined
    this.slippy.clearTiles()
    this.slippy.visible = false
    this.setTilesOn(false)
  }

  private setTilesOn(on: boolean): void {
    if (on === this.tilesOn) return
    this.tilesOn = on
    this.deps.onTilesActiveChange?.(on)
  }

  private levelFor(altitude: number): number {
    const idx = this.thresholds.findIndex((t) => t <= altitude)
    return idx < 0 ? this.thresholds.length : idx
  }

  /** Call every frame; does nothing unless the camera moved. */
  update(camera: THREE.Camera): void {
    this.camera = camera
    if (camera.position.equals(this.lastPos)) return
    this.lastPos.copy(camera.position)

    const tiles = this.view ? VIEWS[this.view].tiles : undefined
    const altitude = camera.position.length() / (this.deps.radius * TILE_LIFT) - 1
    const want = !!tiles && this.tilesAllowed && this.levelFor(altitude) > this.baseLevel

    if (want && !this.tilesOn && tiles) {
      this.slippy.maxLevel = tiles.maxLevel
      this.slippy.minLevel = 0
      this.slippy.visible = true
      this.slippy.tileUrl = tiles.url
      this.setTilesOn(true)
    } else if (!want && this.tilesOn) {
      // Zoomed back out to where the bundled texture is as sharp as tiles:
      // drop them to free GPU memory (the HTTP cache makes a re-zoom cheap).
      this.resetTiles()
      return
    }
    if (this.tilesOn) this.schedulePov()
  }

  private schedulePov(): void {
    const now = performance.now()
    const wait = POV_THROTTLE_MS - (now - this.lastPovAt)
    if (wait <= 0) {
      this.runPov()
    } else if (!this.povTimer) {
      // Trailing call so the final resting view always gets its tiles.
      this.povTimer = setTimeout(() => {
        this.povTimer = null
        this.runPov()
      }, wait)
    }
  }

  private runPov(): void {
    if (this.disposed || !this.tilesOn || !this.camera) return
    this.lastPovAt = performance.now()
    this.slippy.updatePov(this.camera)
  }

  dispose(): void {
    this.disposed = true
    this.token++
    if (this.povTimer) clearTimeout(this.povTimer)
    this.slippy.tileUrl = undefined
    this.slippy.clearTiles()
    this.deps.scene.remove(this.slippy)
    this.texture?.dispose()
    this.material.dispose()
  }
}
