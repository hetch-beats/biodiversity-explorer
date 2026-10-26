// Generates the app icon — a "BE" (Biodiversity Explorer) monogram — from
// geometry drawn here, so no font file or third-party artwork is involved.
//
//   node scripts/generate-icon.mjs
//
// Output (committed; see build/ICON-LICENSE.md, CC0 1.0):
//   build/icon.svg   source artwork, 512×512
//   build/icon.png   512×512 (electron-builder, Linux, runtime window icon)
//   build/icon.ico   16–256 px, PNG-compressed entries (Windows)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
mkdirSync(OUT, { recursive: true })

// Letterforms on a 512 grid: 40-unit strokes, cap height 146..366.
// B = stem + two bowls (outer shapes in white, counters re-filled with the
// background gradient); E = stem + three bars. dx centres the pair.
const dx = -5
const x = (v) => v + dx
const B_OUTER = [
  `M${x(132)},146 H${x(192)} A60,60 0 0 1 ${x(192)},266 H${x(132)} Z`,
  `M${x(132)},230 H${x(196)} A68,68 0 0 1 ${x(196)},366 H${x(132)} Z`
]
const B_COUNTERS = [
  `M${x(172)},186 H${x(192)} A20,20 0 0 1 ${x(192)},226 H${x(172)} Z`,
  `M${x(172)},270 H${x(196)} A28,28 0 0 1 ${x(196)},326 H${x(172)} Z`
]
const E_RECTS = [
  [290, 146, 40, 220],
  [290, 146, 100, 40],
  [290, 236, 86, 40],
  [290, 326, 100, 40]
]

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <title>Biodiversity Explorer</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#2f8f6b"/>
      <stop offset="1" stop-color="#155e75"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g fill="#ffffff">
    ${B_OUTER.map((d) => `<path d="${d}"/>`).join('\n    ')}
    ${E_RECTS.map(([rx, ry, w, h]) => `<rect x="${x(rx)}" y="${ry}" width="${w}" height="${h}"/>`).join('\n    ')}
  </g>
  <g fill="url(#bg)">
    ${B_COUNTERS.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
</svg>
`
writeFileSync(join(OUT, 'icon.svg'), svg)

// Rendered at 512 and downsampled (Lanczos) for each size.
const png = (size) => sharp(Buffer.from(svg)).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer()
writeFileSync(join(OUT, 'icon.png'), await png(512))

// ICO with PNG-compressed images (supported since Windows Vista).
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map(png))
const header = Buffer.alloc(6 + 16 * sizes.length)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
sizes.forEach((size, i) => {
  const e = 6 + 16 * i
  header.writeUInt8(size >= 256 ? 0 : size, e) // 0 means 256
  header.writeUInt8(size >= 256 ? 0 : size, e + 1)
  header.writeUInt8(0, e + 2) // palette
  header.writeUInt8(0, e + 3) // reserved
  header.writeUInt16LE(1, e + 4) // colour planes
  header.writeUInt16LE(32, e + 6) // bits per pixel
  header.writeUInt32LE(images[i].length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += images[i].length
})
writeFileSync(join(OUT, 'icon.ico'), Buffer.concat([header, ...images]))
console.log('[icon] wrote build/icon.svg, icon.png, icon.ico')
