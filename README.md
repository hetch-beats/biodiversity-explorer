# Biodiversity Explorer

A free, open-source desktop app for exploring where animal species live, on an interactive 3D globe. It is built with Electron, React, three.js/three-globe and SQLite, and it works offline once data has been cached.

![status](https://img.shields.io/badge/status-active%20development-blue)

## Overview

**Goal.** The same view serves hobbyists and scientists, and the app aims for research credibility: every point, status and image comes from a published, citable source and is shown with its provenance.

**Data sources** (all free and keyless by default):

| Source | Used for |
| --- | --- |
| [GBIF](https://www.gbif.org/) occurrence API | Georeferenced occurrence records drawn on the globe |
| GBIF — IUCN Red List checklist dataset [`19491596-35ae-4a91-9a98-85cf505f1bd3`](https://www.gbif.org/dataset/19491596-35ae-4a91-9a98-85cf505f1bd3) | Conservation status and the Red List browser (no IUCN token needed) |
| IUCN Red List API (optional) | Authoritative status if the user pastes their own token in Settings. A shared token isn't bundled: IUCN tokens are personal and non-commercial. |
| iNaturalist research-grade photos (via GBIF), museum specimen images, [Wikimedia Commons](https://commons.wikimedia.org/) | Species images. Only openly licensed images are used, always credited, and badged when they aren't a photo of the living animal (specimen, fossil, illustration). |
| [Wikipedia](https://www.wikipedia.org/) | Species descriptions |
| NASA Blue Marble / Black Marble, Natural Earth, NASA GIBS | Globe imagery (see [Globe imagery](#globe-imagery)) |

## Getting started

Prerequisites: [Node.js](https://nodejs.org/) 20 LTS or newer. Development and packaging are tested on Windows 11. macOS and Linux targets are configured but haven't been tested.

```bash
npm install            # also downloads the bundled 4K Earth texture and rebuilds native modules for Electron
npm run dev            # Vite dev server + Electron window
```

On first launch the app seeds 96 curated species into a local SQLite database, so it works with no network. Selecting a species fetches its GBIF occurrences, status, description and image, and caches them.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run in development |
| `npm run typecheck` | `tsc --noEmit` over main, preload and renderer |
| `npm run build` | Production bundle into `out/` |
| `npm run build:win` / `build:mac` / `build:linux` | Package with electron-builder into `release/`. Windows produces an NSIS installer. |
| `npm run fetch-redlist` | Re-download the bundled Red List snapshot (`src/main/data/redlist/*.json`) from GBIF's IUCN checklist |
| `npm run fetch-textures` | Dev only: build the 8K/16K globe textures into `src/renderer/public/assets/textures/` (needs ~1.5 GB RAM) |
| `npm run generate-icon` | Regenerate `build/icon.svg`, `icon.png` and `icon.ico` |

### Windows packaging notes

- `win.signAndEditExecutable` is `false`. electron-builder's own exe-editing step needs the Windows symlink privilege (Developer Mode or an admin shell) to unpack its tools.
- Instead, the `afterPack` hook (`scripts/after-pack.cjs`) uses the `rcedit` npm package to embed **only** the icon into the `.exe`.
- The result is unsigned and has default version metadata.
- Native modules (`better-sqlite3`, `sharp`/`@img`) are listed in `build.asarUnpack`. Electron can't load `.node` files from inside `app.asar`, and without this the packaged app fails at startup.

## Architecture

```
src/
  main/                 Electron main process (Node)
    index.ts            window creation, protocol + IPC registration
    windowState.ts      default size, 1024×640 minimum, remembered bounds/maximized state
    net/http.ts         the only path to external APIs: per-host rate limits, request de-duplication,
                        SQLite response cache with per-endpoint TTL, stale-if-error, retry/backoff
    ipc/                IPC handlers + API clients (GBIF, IUCN checklist, IUCN API, Wikipedia)
    services/           data sync, species images, Red List browse/search, globe texture download
    database/           schema, migrations, seed data, settings
  preload/index.ts      contextBridge — the renderer's entire API surface
  renderer/             React app (Vite root)
    components/         Globe, ExploreSheet (Search/Browse/Filters), SpeciesPanel, SettingsPanel, ui.tsx, icons.tsx
    globe/              views.ts (map views), imagery.ts (texture loading, GIBS tiles)
    stores/             Zustand: ui (persisted settings), species, globe, filters, textures
    styles/globals.css  11 theme palettes + design tokens
scripts/                texture/Red List/icon generators, afterPack hook
build/                  app icon + licence (electron-builder buildResources)
```

- **Isolation.** `contextIsolation` is on and `nodeIntegration` is off. The renderer reaches main only through the named calls in `src/preload/index.ts`.
- **`globe-texture://` protocol** (`src/main/services/globeTextures.ts`) serves globe textures to the renderer. It looks first in `<userData>/globe-textures` (the in-app download), then in the bundled folder. Only plain `*.jpg` file names are accepted; anything else returns 404.
- **Coordinates.** Every point and outline is placed with three-globe's `getCoords()`, the same conversion the globe's texture uses, so markers and imagery can't drift apart.
- **Layout.** The window has three real columns: Explore sheet | globe | species sheet. The globe canvas resizes between them. Layers stack in a fixed order: globe → globe overlays → sheets → Settings modal.

## Globe imagery

- **Bundled 4K Blue Marble** (`earth.jpg`). `npm install` fetches it, and it is always available as the fallback.
- **8K views (Satellite, Relief, Simple, Night lights).** Installers don't ship these. Turning on **Settings → Globe → 8K globe imagery** downloads the public-domain sources once (~230 MB), checks each is an exact 2:1 full-globe equirectangular raster, resizes it with `sharp`, saves the result to app data, and deletes the raw downloads. The globe updates live. Interrupted downloads resume on next launch.
- **16K satellite** is opt-in and GPU-gated (needs ≥16384 px textures, hardware rendering).
- **Zoom detail.** With "Sharper imagery when zoomed in" on, NASA GIBS tiles stream over the Satellite and Night views; this needs internet.
- **Country outlines** come from Natural Earth via `world-atlas`, bundled.

## What's done

- **Core (MVP):**
  - Globe with occurrence points and hover tooltips.
  - Fuzzy search, filters (continent, group, status, habitat, size), favorites, search history.
  - Two-species comparison overlay, PNG export, weekly background sync.
- **Phase 2a:**
  - 11 curated theme palettes (Daylight default) with low-saturation surfaces and saturated accents only.
  - Inter font (bundled), colorblind-safe and high-contrast modes.
- **Data, image and API work (2026-09-30):**
  - Conservation status from IUCN's Red List checklist on GBIF (keyless), with an optional personal IUCN token.
  - Bundled Red List snapshot plus SQLite cache, and instant local search across cached Red List taxa.
  - Verified, attributed species images (iNaturalist research-grade via GBIF → museum specimens → vetted Commons), badged by kind.
  - `net/http.ts` request layer.
- **Phase 2c (layout and polish):**
  - Docked Explore and Species sheets, fixed layer order.
  - Design tokens: one radius, spacing, control-height and type scale.
  - Lucide icons (`lucide-react`, bundled) instead of text glyphs.
  - Themed globe overlays; a themed taxon-group card when no image exists.
- **Font size setting** actually scales the UI: root font-size, applied before first paint, persisted.
- **In-app 8K/16K texture download** with progress, retry and resume.
- **Heatmap:** Points | Heatmap switch, a kernel-density map of GBIF occurrence records weighted by log(record count). It is labelled as record density, not population.
- **Themed scrollbars** everywhere, including Settings.
- **Window:** resizable and maximizable, 1024×640 minimum, sized to the screen on first launch, size and maximized state remembered. Side sheets shrink on narrow windows.
- **App icon:** "BE" monogram (CC0) on the installer, the `.exe`, shortcuts and the window.

## What's pending

- **Time layer.**
  - By month: needs the GBIF `month` stored per occurrence; today only `last_observed` is stored.
  - By decade: needs per-record years.
  - Filtering should happen instantly in memory.
- **Phase 2b — research credibility:**
  - Occurrence schema: `basis_of_record`, `coordinate_uncertainty_m`, GBIF `issues`.
  - Data-quality UI built on that (filter or flag uncertain and unvouchered records).
  - Citation-ready export, and an opt-in GBIF download with a DOI.
  - Proper IUCN citation for status.
  - A dedicated Compare view (today: a two-species overlay only).
  - An Insights view with documented methodology. Optional: Living Planet Index (LPI) trends.
- **Not yet built from the original roadmap:** migration route animation (the store has a data model, nothing is drawn), country-region selection, and auto-update via `electron-updater` + GitHub Releases.
- **Known issues:**
  - The Recent list repeats a species every time it's picked; it should de-duplicate.
  - On the start screen, the "N species ready to explore" subtitle overlaps the top of the globe.
  - `net/http.ts`: in-flight request sharing ignores differing TTLs between callers.
  - A stale cached page served offline could overwrite a newer stored conservation status.
  - Icon sizes are in px, so they don't scale with the font-size setting.
  - Unverified: macOS/Linux packaging and the first-time 8K download inside a fresh install (it was tested in dev, and the 16K step inside the packaged app).

## Guidelines

These are the rules the code follows. Keep to them in new work.

**Data integrity**
- Real data from published sources only. Never hand-generate, draw, warp or reproject imagery or data. Bundled globe textures must be exact 2:1 full-globe equirectangular rasters and are only resized.
- Label derived views honestly. The heatmap and any month/decade view show *records/sightings*, never population or abundance.
- Only openly licensed images, always shown with creator, licence and source. Anything that isn't a photo of the living animal is badged.
- GBIF threat and status queries are scoped to the IUCN checklist dataset (`19491596-…`).
- A failed fetch must never overwrite stored data. Keep the last good value.
- Verify the content of data, not just its shape. For example, check that a GBIF taxon match is the right species, not merely that a key came back.
- All network access goes through `src/main/net/http.ts`.

**Design**
- Muted, low-saturation surfaces; saturated colour only on accents. Daylight is the default theme, and all 11 themes must work.
- Use design tokens: `rounded-*`, `h-control`, `p-inset`/`p-gutter`, `text-3xs`/`2xs`/`body`, `shadow-overlay`, theme colour variables. No ad-hoc pixel values. Everything is rem-based so the font-size setting scales it.
- Motion: fades and slides only, and respect `prefers-reduced-motion` (`globals.css` already does).
- Docked sheets, not floating panels. Keep the fixed layer order: globe → overlays → sheets → modal → toasts.
- Icons come from Lucide via `src/renderer/components/icons.tsx`. No text glyphs for controls.
- Don't set `scrollbar-width` or `scrollbar-color`: Chromium then ignores the custom scrollbar styling.

**Process**
- Run `npm run typecheck` and `npm run build` before calling anything done, and check it in `npm run dev`.
- Build features in steps that can each be tested on their own, and test each step before starting the next.

## Licensing and credits

- Code: MIT — see [LICENSE](./LICENSE).
- App icon: original "BE" monogram, CC0 1.0 — see [build/ICON-LICENSE.md](./build/ICON-LICENSE.md).
- Occurrence data © GBIF.org contributors, under GBIF's data-use terms; cite the datasets used.
- Conservation status: IUCN Red List (via GBIF's IUCN checklist, or the IUCN API with a personal token). © IUCN — see IUCN's terms of use.
- Images: credited per image (creator, licence, source) in the app.
- Descriptions: Wikipedia, CC BY-SA 4.0.
- Globe imagery: NASA Blue Marble / Black Marble and NASA GIBS (public domain); Natural Earth (public domain). Provenance is written to `SOURCES.md` by `npm run fetch-textures`.
- Icons: [Lucide](https://lucide.dev) (ISC). Font: [Inter](https://rsms.me/inter/) via `@fontsource/inter` (SIL OFL 1.1).
