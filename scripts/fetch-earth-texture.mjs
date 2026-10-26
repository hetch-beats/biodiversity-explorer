// Downloads a real photographic Earth texture (NASA "Blue Marble" imagery —
// public domain) once during `npm install`, so the globe can render real
// satellite/land imagery instead of an abstract wireframe sphere.
//
// Idempotent: skips the download if the file is already present, so it only
// ever runs once per checkout (and never slows down a repeat `npm install`).
//
// Never fails the install: if there's no network right now (or the host is
// blocked by a firewall/proxy), this logs a warning and moves on. Globe.tsx
// detects the missing file at runtime and falls back to the app's built-in
// stylized globe (procedural shading + the bundled world-atlas country
// borders) — so "works fully offline, zero required setup" still holds even
// if this download never succeeds.
//
// Fetched straight off npm via jsDelivr's CDN, which serves any file inside
// any published package without needing to `npm install` that package. This
// gets us the exact "earth-blue-marble.jpg" asset bundled inside the
// MIT-licensed `three-globe` package (real NASA Blue Marble Next Generation
// photographic imagery) without pulling in three-globe's own large
// dependency tree (three.js, d3-*, h3-js, etc.) — we only need this one file.
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const destDir = join(__dirname, '..', 'src', 'renderer', 'public', 'assets', 'textures')
const destFile = join(destDir, 'earth.jpg')

const SOURCE_URL = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.2/example/img/earth-blue-marble.jpg'

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const cleanup = () => {
      file.close()
    }
    https
      .get(url, (res) => {
        const { statusCode, headers } = res
        if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location && redirectsLeft > 0) {
          cleanup()
          res.resume()
          download(headers.location, dest, redirectsLeft - 1).then(resolve, reject)
          return
        }
        if (statusCode !== 200) {
          cleanup()
          reject(new Error(`HTTP ${statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
      })
      .on('error', (err) => {
        cleanup()
        reject(err)
      })
  })
}

async function main() {
  if (existsSync(destFile)) {
    console.log('[fetch-earth-texture] real Earth texture already present, skipping download')
    return
  }
  mkdirSync(destDir, { recursive: true })
  try {
    await download(SOURCE_URL, destFile)
    console.log('[fetch-earth-texture] saved real Earth texture to', destFile)
  } catch (err) {
    try {
      if (existsSync(destFile)) unlinkSync(destFile)
    } catch {
      // ignore cleanup failure
    }
    console.warn(
      '[fetch-earth-texture] could not download the real Earth texture (no network, or the host is unreachable):',
      err instanceof Error ? err.message : err
    )
    console.warn(
      '[fetch-earth-texture] not fatal — the app will fall back to its built-in stylized globe. ' +
        'Run "npm install" again later (with internet access) to fetch it.'
    )
  }
}

main()
