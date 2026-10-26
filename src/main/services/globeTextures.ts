/*
 * In-app download of the globe's 8K (and optional 16K) base-map textures.
 *
 * Installed builds don't ship these (only the 4K satellite fallback);
 * turning on Settings → Globe → "8K globe imagery" fetches them once, from
 * the same public-domain publishers as scripts/fetch-globe-textures.mjs, and
 * applies the same rules: every source must be an exact 2:1 full-globe
 * equirectangular raster, and it is only resized — never drawn, warped or
 * reprojected. SOURCES / OUTPUTS below mirror that script; keep them in sync.
 *
 * Files land in <userData>/globe-textures and are served to the renderer by
 * the globe-texture:// protocol (see registerGlobeTextureProtocol), which
 * also falls back to the textures bundled with the app / fetched by the dev
 * script, so both paths keep working.
 */
import { app, BrowserWindow, net, protocol } from 'electron'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type TextureTier = '8k' | '16k'

export interface TextureStatus {
  /** Which tiers are fully present on disk. */
  have: Record<TextureTier, boolean>
  job: {
    tiers: TextureTier[]
    state: 'running' | 'done' | 'error'
    /** Human-readable current step, e.g. "Downloading NASA Blue Marble". */
    step: string
    /** 0–100 for the whole job, null when unknown. */
    percent: number | null
    error?: string
  } | null
}

export const TEXTURE_SCHEME = 'globe-texture'

const NE = (file: string): string[] => [
  `https://naciscdn.org/naturalearth/50m/raster/${file}`,
  `https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/50m/raster/${file}`
]

interface Source {
  label: string
  urls: string[]
  file: string
  zipMember?: RegExp
}

const SOURCES: Record<string, Source> = {
  blueMarble: {
    label: 'NASA Blue Marble',
    urls: [
      'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg'
    ],
    file: 'world.topo.bathy.200407.3x21600x10800.jpg'
  },
  hypso: { label: 'Natural Earth relief', urls: NE('HYP_50M_SR_W.zip'), file: 'HYP_50M_SR_W.zip', zipMember: /\.tiff?$/i },
  grayEarth: {
    label: 'Natural Earth Gray Earth',
    urls: NE('GRAY_50M_SR_OB.zip'),
    file: 'GRAY_50M_SR_OB.zip',
    zipMember: /\.tiff?$/i
  },
  blackMarble: {
    label: 'NASA Black Marble',
    urls: [
      'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg'
    ],
    file: 'BlackMarble_2016_3km.jpg'
  }
}

const OUTPUTS: { file: string; source: keyof typeof SOURCES; width: number; tier: TextureTier }[] = [
  { file: 'earth-satellite-8k.jpg', source: 'blueMarble', width: 8192, tier: '8k' },
  { file: 'earth-satellite-preview.jpg', source: 'blueMarble', width: 512, tier: '8k' },
  { file: 'earth-relief-8k.jpg', source: 'hypso', width: 8192, tier: '8k' },
  { file: 'earth-relief-preview.jpg', source: 'hypso', width: 512, tier: '8k' },
  { file: 'earth-simple-8k.jpg', source: 'grayEarth', width: 8192, tier: '8k' },
  { file: 'earth-simple-preview.jpg', source: 'grayEarth', width: 512, tier: '8k' },
  { file: 'earth-night-8k.jpg', source: 'blackMarble', width: 8192, tier: '8k' },
  { file: 'earth-night-preview.jpg', source: 'blackMarble', width: 512, tier: '8k' },
  { file: 'earth-satellite-16k.jpg', source: 'blueMarble', width: 16384, tier: '16k' }
]

const userDir = (): string => join(app.getPath('userData'), 'globe-textures')
const cacheDir = (): string => join(userDir(), '.sources')

/** Textures shipped with the app (packaged) or fetched by `npm run fetch-textures` (dev). */
function bundledDir(): string {
  return app.isPackaged
    ? join(__dirname, '../renderer/assets/textures')
    : join(app.getAppPath(), 'src', 'renderer', 'public', 'assets', 'textures')
}

function findTexture(file: string): string | null {
  for (const dir of [userDir(), bundledDir()]) {
    const p = join(dir, file)
    if (existsSync(p)) return p
  }
  return null
}

let job: TextureStatus['job'] = null

export function getTextureStatus(): TextureStatus {
  const have = (tier: TextureTier): boolean => OUTPUTS.filter((o) => o.tier === tier).every((o) => findTexture(o.file))
  return { have: { '8k': have('8k'), '16k': have('16k') }, job }
}

function broadcast(): void {
  const status = getTextureStatus()
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('textures:status', status)
}

// ---- protocol ---------------------------------------------------------------

/** Must run before app 'ready'. */
export function registerTextureScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: TEXTURE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

/**
 * globe-texture://textures/<file>.jpg → the file from <userData>/globe-textures
 * or the bundled folder; 404 if neither has it. Only plain texture file names
 * are accepted, so the renderer can't read anything else from disk.
 */
export function registerGlobeTextureProtocol(): void {
  protocol.handle(TEXTURE_SCHEME, async (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '')
    const path = /^[a-z0-9][a-z0-9.-]*\.jpe?g$/i.test(name) ? findTexture(name) : null
    if (!path) return new Response(null, { status: 404, headers: { 'access-control-allow-origin': '*' } })
    const body = await readFile(path)
    return new Response(body, {
      headers: { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' }
    })
  })
}

// ---- download + resize --------------------------------------------------------

async function download(url: string, dest: string, onProgress: (fraction: number | null) => void): Promise<void> {
  const part = `${dest}.part`
  const controller = new AbortController()
  let idle: NodeJS.Timeout | undefined
  const resetIdle = (): void => {
    clearTimeout(idle)
    idle = setTimeout(() => controller.abort(new Error('no data for 60 s')), 60_000)
  }
  resetIdle()
  try {
    const res = await net.fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    if ((res.headers.get('content-type') ?? '').startsWith('text/html')) throw new Error('got a web page instead of the file')
    const encoding = res.headers.get('content-encoding')
    const total = encoding && encoding !== 'identity' ? 0 : Number(res.headers.get('content-length')) || 0
    const out = createWriteStream(part)
    let received = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      received += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      onProgress(total ? received / total : null)
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    if (total && received !== total) throw new Error(`incomplete download (${received} of ${total} bytes)`)
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  } finally {
    clearTimeout(idle)
  }
}

async function fetchSource(src: Source, onProgress: (fraction: number | null) => void): Promise<string> {
  mkdirSync(cacheDir(), { recursive: true })
  const archive = join(cacheDir(), src.file)
  if (!existsSync(archive)) {
    let lastError: unknown
    for (const url of src.urls) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await download(url, archive, onProgress)
          lastError = undefined
          break
        } catch (err) {
          lastError = err
          console.warn(`[textures] ${src.file} from ${new URL(url).host} failed (attempt ${attempt}):`, err)
          if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
      }
      if (!lastError) break
    }
    if (lastError) throw new Error(`Couldn't download ${src.label} — check your internet connection`)
  }
  if (!src.zipMember) return archive

  const { default: extract } = await import('extract-zip')
  const dir = join(cacheDir(), src.file.replace(/\.zip$/i, ''))
  const findMember = (): string | undefined =>
    existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).find((f) => src.zipMember!.test(f)) : undefined
  if (!findMember()) {
    rmSync(dir, { recursive: true, force: true })
    await extract(archive, { dir })
  }
  const member = findMember()
  if (!member) throw new Error(`${src.file} did not contain the expected raster`)
  return join(dir, member)
}

function cleanSource(src: Source): void {
  rmSync(join(cacheDir(), src.file), { force: true })
  rmSync(join(cacheDir(), src.file.replace(/\.zip$/i, '')), { recursive: true, force: true })
}

/**
 * Fetch every missing texture for `tiers`, in one pass (8K and 16K share the
 * Blue Marble source, so asking for both downloads it once). Idempotent and
 * resumable: finished files are skipped, so a failed or interrupted run
 * simply continues next time. One job at a time; a request while one runs
 * is a no-op.
 */
export async function downloadTextures(tiers: TextureTier[]): Promise<TextureStatus> {
  if (job?.state === 'running') return getTextureStatus()
  const todo = OUTPUTS.filter((o) => tiers.includes(o.tier) && !findTexture(o.file))
  if (todo.length === 0) {
    job = null
    broadcast()
    return getTextureStatus()
  }

  const sources = [...new Set(todo.map((o) => o.source))]
  job = { tiers, state: 'running', step: 'Starting…', percent: 0 }
  broadcast()

  // Each source counts as one equal share of the job: 80% download, 20% resize.
  const share = 100 / sources.length
  let lastSent = 0
  const report = (step: string, percent: number | null): void => {
    job = { tiers, state: 'running', step, percent: percent === null ? null : Math.min(99, Math.round(percent)) }
    const now = Date.now()
    if (now - lastSent > 250) {
      lastSent = now
      broadcast()
    }
  }

  try {
    const { default: sharp } = await import('sharp')
    sharp.cache(false) // inputs are huge and each is read only a few times
    mkdirSync(userDir(), { recursive: true })

    for (const [i, key] of sources.entries()) {
      const src = SOURCES[key]
      const base = i * share
      const input = await fetchSource(src, (f) =>
        report(`Downloading ${src.label}`, f === null ? null : base + f * share * 0.8)
      )
      report(`Processing ${src.label}`, base + share * 0.8)
      const { width, height } = await sharp(input, { limitInputPixels: false }).metadata()
      if (!width || !height || width !== height * 2) {
        throw new Error(`${src.label} isn't a full-globe 2:1 image (${width}×${height}) — refusing to use it`)
      }
      for (const o of todo.filter((t) => t.source === key)) {
        const outPath = join(userDir(), o.file)
        const tmp = `${outPath}.tmp.jpg`
        await sharp(input, { limitInputPixels: false })
          .removeAlpha()
          .resize(o.width, o.width / 2, { fit: 'fill', kernel: 'lanczos3' })
          .jpeg({ quality: o.width <= 512 ? 82 : 90, progressive: false, chromaSubsampling: '4:2:0' })
          .toFile(tmp)
        renameSync(tmp, outPath)
      }
      cleanSource(src)
      report(`Processing ${src.label}`, base + share)
    }
    job = { tiers, state: 'done', step: 'Done', percent: 100 }
  } catch (err) {
    console.error('[textures] download failed:', err)
    job = {
      tiers,
      state: 'error',
      step: 'Failed',
      percent: null,
      error: err instanceof Error ? err.message : String(err)
    }
  }
  broadcast()
  return getTextureStatus()
}
