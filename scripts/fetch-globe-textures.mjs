// Downloads the globe's base-map imagery from its publishers and resizes it
// into GPU-friendly textures:
//
//   npm run fetch-textures            fetch whatever is missing
//   npm run fetch-textures -- --force rebuild everything
//   npm run fetch-textures -- --keep-sources   keep the raw downloads (~230 MB)
//
// Output (src/renderer/public/assets/textures/, git-ignored):
//   earth-satellite-8k.jpg   8192×4096   NASA Blue Marble NG, July 2004, topography & bathymetry
//   earth-satellite-16k.jpg  16384×8192  same source (opt-in in Settings)
//   earth-relief-8k.jpg      8192×4096   Natural Earth 1:50m cross-blended hypsometric tints
//   earth-simple-8k.jpg      8192×4096   Natural Earth 1:50m Gray Earth
//   earth-night-8k.jpg       8192×4096   NASA Black Marble 2016
//   earth-<view>-preview.jpg 512×256     thumbnails for the view switcher
//   SOURCES.md                           provenance and licences
//
// Accuracy: every source is a published, georeferenced equirectangular raster
// covering exactly -180..180 / -90..90. This script only resizes them. It
// checks each source is exactly 2:1 and refuses anything else, because a
// cropped or padded image would put coastlines in the wrong place on the
// sphere. It never draws, warps or reprojects anything.
//
// All sources are public domain (NASA imagery is not copyrighted; Natural
// Earth is explicitly public domain). Credits are shown in the app anyway.
//
// Needs `sharp` (devDependency) and ~1.5 GB of free RAM while resizing the
// 21600×10800 Blue Marble. Safe to re-run: finished files are skipped.
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'src', 'renderer', 'public', 'assets', 'textures')
const CACHE_DIR = join(ROOT, 'node_modules', '.cache', 'globe-texture-sources')

const args = new Set(process.argv.slice(2))
const FORCE = args.has('--force')
const KEEP_SOURCES = args.has('--keep-sources')

const NE = (file) => [
  `https://naciscdn.org/naturalearth/50m/raster/${file}`,
  `https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/50m/raster/${file}`
]

const SOURCES = {
  blueMarble: {
    urls: [
      'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/july/world.topo.bathy.200407.3x21600x10800.jpg'
    ],
    file: 'world.topo.bathy.200407.3x21600x10800.jpg',
    title: 'Blue Marble: Next Generation w/ Topography and Bathymetry, July 2004 (21600×10800)',
    publisher: 'NASA Earth Observatory (Reto Stöckli, NASA GSFC)',
    page: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry',
    licence: 'NASA imagery, not subject to copyright (public domain)'
  },
  hypso: {
    urls: NE('HYP_50M_SR_W.zip'),
    file: 'HYP_50M_SR_W.zip',
    zipMember: /\.tiff?$/i,
    title: 'Natural Earth 1:50m Cross Blended Hypso with Shaded Relief and Water (10800×5400)',
    publisher: 'Natural Earth (Tom Patterson, NACIS)',
    page: 'https://www.naturalearthdata.com/downloads/50m-raster-data/50m-cross-blend-hypso/',
    licence: 'Public domain'
  },
  grayEarth: {
    urls: NE('GRAY_50M_SR_OB.zip'),
    file: 'GRAY_50M_SR_OB.zip',
    zipMember: /\.tiff?$/i,
    title: 'Natural Earth 1:50m Gray Earth with Shaded Relief, Hypsography and Ocean Bottom (10800×5400)',
    publisher: 'Natural Earth (Tom Patterson, NACIS)',
    page: 'https://www.naturalearthdata.com/downloads/50m-raster-data/50m-gray-earth/',
    licence: 'Public domain'
  },
  blackMarble: {
    urls: [
      'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg'
    ],
    file: 'BlackMarble_2016_3km.jpg',
    title: 'Earth at Night (Black Marble) 2016, colour, 3 km (13500×6750)',
    publisher: 'NASA Earth Observatory (Joshua Stevens, Miguel Román, NASA GSFC; Suomi NPP VIIRS)',
    page: 'https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps',
    licence: 'NASA imagery, not subject to copyright (public domain)'
  }
}

const OUTPUTS = [
  { file: 'earth-satellite-8k.jpg', source: 'blueMarble', width: 8192 },
  { file: 'earth-satellite-16k.jpg', source: 'blueMarble', width: 16384 },
  { file: 'earth-satellite-preview.jpg', source: 'blueMarble', width: 512 },
  { file: 'earth-relief-8k.jpg', source: 'hypso', width: 8192 },
  { file: 'earth-relief-preview.jpg', source: 'hypso', width: 512 },
  { file: 'earth-simple-8k.jpg', source: 'grayEarth', width: 8192 },
  { file: 'earth-simple-preview.jpg', source: 'grayEarth', width: 512 },
  { file: 'earth-night-8k.jpg', source: 'blackMarble', width: 8192 },
  { file: 'earth-night-preview.jpg', source: 'blackMarble', width: 512 }
]

const log = (...a) => console.log('[fetch-textures]', ...a)
const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`

async function loadDeps() {
  try {
    const sharp = (await import('sharp')).default
    const extract = (await import('extract-zip')).default
    return { sharp, extract }
  } catch {
    console.error('[fetch-textures] missing dependencies — run "npm install" first (needs sharp and extract-zip).')
    process.exit(1)
  }
}

/** Streams url to dest with an idle timeout; writes to .part and renames on success. */
async function download(url, dest) {
  const part = `${dest}.part`
  const controller = new AbortController()
  let idle
  const resetIdle = () => {
    clearTimeout(idle)
    idle = setTimeout(() => controller.abort(new Error('no data for 60 s')), 60_000)
  }
  resetIdle()
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const type = res.headers.get('content-type') ?? ''
    if (type.startsWith('text/html')) throw new Error('got an HTML page instead of the file')
    // fetch() transparently decompresses, so Content-Length (the compressed
    // size) is only comparable to the bytes received when nothing was encoded.
    const encoded = !!res.headers.get('content-encoding') && res.headers.get('content-encoding') !== 'identity'
    const total = encoded ? 0 : Number(res.headers.get('content-length')) || 0
    const out = createWriteStream(part)
    let received = 0
    let nextReport = 0.1
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      received += value.length
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      if (total && received / total >= nextReport) {
        log(`  ${Math.round((received / total) * 100)}% of ${mb(total)}`)
        nextReport += 0.1
      }
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())))
    if (total && received !== total) throw new Error(`incomplete download (${received} of ${total} bytes)`)
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  } finally {
    clearTimeout(idle)
  }
}

async function fetchSource(key, extract) {
  const src = SOURCES[key]
  mkdirSync(CACHE_DIR, { recursive: true })
  const archive = join(CACHE_DIR, src.file)
  if (!existsSync(archive)) {
    let lastError
    for (const url of src.urls) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          log(`downloading ${src.file} from ${new URL(url).host}${attempt > 1 ? ` (attempt ${attempt})` : ''}`)
          await download(url, archive)
          lastError = undefined
          break
        } catch (err) {
          lastError = err
          log(`  failed: ${err instanceof Error ? err.message : err}`)
          if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
      }
      if (!lastError) break
    }
    if (lastError) throw new Error(`could not download ${src.file}`)
  }
  if (!src.zipMember) return archive

  const dir = join(CACHE_DIR, src.file.replace(/\.zip$/i, ''))
  const findMember = () =>
    existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).find((f) => src.zipMember.test(f)) : undefined
  if (!findMember()) {
    log(`unzipping ${src.file}`)
    rmSync(dir, { recursive: true, force: true })
    await extract(archive, { dir })
  }
  const member = findMember()
  if (!member) throw new Error(`${src.file} did not contain a raster matching ${src.zipMember}`)
  return join(dir, member)
}

async function checkFullGlobe(sharp, file, key) {
  const { width, height } = await sharp(file, { limitInputPixels: false }).metadata()
  if (!width || !height || width !== height * 2) {
    throw new Error(
      `${SOURCES[key].file} is ${width}×${height}, not a 2:1 full-globe equirectangular image — refusing to use it`
    )
  }
  return { width, height }
}

async function resize(sharp, input, output, width) {
  const tmp = `${output}.tmp.jpg`
  await sharp(input, { limitInputPixels: false })
    .removeAlpha()
    .resize(width, width / 2, { fit: 'fill', kernel: 'lanczos3' })
    // Baseline (non-progressive) JPEG decodes fastest, and mozjpeg's smaller
    // files don't decode any faster — plain libjpeg at q90 is the sweet spot.
    .jpeg({ quality: width <= 512 ? 82 : 90, progressive: false, chromaSubsampling: '4:2:0' })
    .toFile(tmp)
  renameSync(tmp, output)
}

function writeSourcesMd() {
  const lines = [
    '# Globe texture sources',
    '',
    'Generated by `scripts/fetch-globe-textures.mjs`. The files were only resized',
    '(Lanczos-3) from the originals below; nothing was redrawn or reprojected.',
    ''
  ]
  for (const [key, src] of Object.entries(SOURCES)) {
    const outs = OUTPUTS.filter((o) => o.source === key).map((o) => `\`${o.file}\``)
    lines.push(`## ${src.title}`, '', `- Publisher: ${src.publisher}`, `- Page: ${src.page}`)
    lines.push(`- Original: ${src.urls[0]}`, `- Licence: ${src.licence}`, `- Used for: ${outs.join(', ')}`, '')
  }
  lines.push(
    '## Online zoom detail (not stored here)',
    '',
    'When zoomed in, the app streams tiles from NASA GIBS',
    '(https://gibs.earthdata.nasa.gov): `BlueMarble_ShadedRelief_Bathymetry` and `VIIRS_Black_Marble`.',
    '"We acknowledge the use of imagery provided by services from NASA\'s Global Imagery Browse',
    'Services (GIBS), part of NASA\'s Earth Science Data and Information System (ESDIS)."',
    ''
  )
  writeFileSync(join(OUT_DIR, 'SOURCES.md'), lines.join('\n'))
}

async function main() {
  const { sharp, extract } = await loadDeps()
  sharp.cache(false) // the inputs are huge and each is read only a few times
  mkdirSync(OUT_DIR, { recursive: true })

  const failures = []
  for (const key of Object.keys(SOURCES)) {
    const outputs = OUTPUTS.filter((o) => o.source === key)
    const todo = outputs.filter((o) => FORCE || !existsSync(join(OUT_DIR, o.file)))
    if (todo.length === 0) {
      log(`${key}: all outputs present, skipping`)
      continue
    }
    try {
      const input = await fetchSource(key, extract)
      const { width, height } = await checkFullGlobe(sharp, input, key)
      log(`${key}: source ${width}×${height} ✓ full globe`)
      for (const o of todo) {
        if (o.width > width) log(`  note: ${o.file} is larger than its source (${width} px wide)`)
        log(`  writing ${o.file} (${o.width}×${o.width / 2})`)
        await resize(sharp, input, join(OUT_DIR, o.file), o.width)
        log(`    ${mb(statSync(join(OUT_DIR, o.file)).size)}`)
      }
      if (!KEEP_SOURCES) {
        rmSync(join(CACHE_DIR, SOURCES[key].file), { force: true })
        rmSync(join(CACHE_DIR, SOURCES[key].file.replace(/\.zip$/i, '')), { recursive: true, force: true })
      }
    } catch (err) {
      failures.push(key)
      console.error(`[fetch-textures] ${key} failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  writeSourcesMd()
  if (failures.length) {
    console.error(`[fetch-textures] finished with failures (${failures.join(', ')}). Re-run to retry — finished files are kept.`)
    process.exit(1)
  }
  log('done. Restart "npm run dev" to see the new views.')
}

main().catch((err) => {
  console.error('[fetch-textures]', err)
  process.exit(1)
})
