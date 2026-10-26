// Globe base-map views. Every view is a published, georeferenced
// equirectangular (plate carrée, full -180..180 / -90..90 extent) raster from
// a trusted source. Nothing here is drawn or reprojected by the app: the
// bundled rasters are only RESIZED (scripts/fetch-globe-textures.mjs, which
// refuses any source that isn't an exact 2:1 full-globe image), and the
// optional zoom tiles are NASA GIBS's own Web Mercator tiles, placed by
// three-slippy-map-globe (the tile engine three-globe itself uses).

export type GlobeView = 'satellite' | 'relief' | 'simple' | 'night'

export interface TileSource {
  /** XYZ tile URL for level/row/column. */
  url: (x: number, y: number, level: number) => string
  /** Deepest level the service publishes (GIBS: GoogleMapsCompatible_Level8). */
  maxLevel: number
  credit: string
}

export interface ViewSpec {
  id: GlobeView
  label: string
  /** 8192×4096 texture (file name under assets/textures/). */
  texture: string
  /** Optional 16384×8192 texture, used only when enabled and the GPU supports it. */
  texture16k?: string
  /** 512×256 thumbnail — also how the app detects that a view was downloaded. */
  preview: string
  credit: string
  creditUrl: string
  /** Online zoom detail, drawn over the bundled texture when zoomed in. */
  tiles?: TileSource
  /** 'flat' = unshaded (night lights are emitted light, not reflected sunlight). */
  lighting: 'lit' | 'flat'
  /** Draw the bundled Natural Earth country outlines over this view. */
  borders: boolean
}

// GIBS WMTS REST endpoints (Web Mercator, 256px tiles, levels 0–8). Checked:
// level 3 tiles return imagery, level 9 returns HTTP 400.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const GIBS_CREDIT = 'Zoom detail: NASA GIBS'

export const VIEWS: Record<GlobeView, ViewSpec> = {
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    texture: 'earth-satellite-8k.jpg',
    texture16k: 'earth-satellite-16k.jpg',
    preview: 'earth-satellite-preview.jpg',
    credit: 'NASA Blue Marble: Next Generation (topography & bathymetry, July 2004)',
    creditUrl: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/',
    tiles: {
      url: (x, y, l) => `${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${l}/${y}/${x}.jpeg`,
      maxLevel: 8,
      credit: GIBS_CREDIT
    },
    lighting: 'lit',
    borders: false
  },
  relief: {
    id: 'relief',
    label: 'Relief',
    texture: 'earth-relief-8k.jpg',
    preview: 'earth-relief-preview.jpg',
    credit: 'Natural Earth: cross-blended hypsometric tints with shaded relief & water',
    creditUrl: 'https://www.naturalearthdata.com/downloads/50m-raster-data/50m-cross-blend-hypso/',
    lighting: 'lit',
    borders: false
  },
  simple: {
    id: 'simple',
    label: 'Simple',
    texture: 'earth-simple-8k.jpg',
    preview: 'earth-simple-preview.jpg',
    credit: 'Natural Earth: Gray Earth with shaded relief & ocean bottom; borders: Natural Earth via world-atlas',
    creditUrl: 'https://www.naturalearthdata.com/downloads/50m-raster-data/50m-gray-earth/',
    lighting: 'lit',
    borders: true
  },
  night: {
    id: 'night',
    label: 'Night lights',
    texture: 'earth-night-8k.jpg',
    preview: 'earth-night-preview.jpg',
    credit: 'NASA Black Marble 2016 (Suomi NPP VIIRS)',
    creditUrl: 'https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps',
    tiles: {
      url: (x, y, l) => `${GIBS}/VIIRS_Black_Marble/default/GoogleMapsCompatible_Level8/${l}/${y}/${x}.png`,
      maxLevel: 8,
      credit: GIBS_CREDIT
    },
    lighting: 'flat',
    borders: false
  }
}

export const VIEW_ORDER: GlobeView[] = ['satellite', 'relief', 'simple', 'night']

/** The pre-Phase-2c 4K Blue Marble from `npm install` (fetch-earth-texture.mjs). */
export const LEGACY_SATELLITE_TEXTURE = 'earth.jpg'

/**
 * Textures are served by the main process's globe-texture:// protocol, which
 * looks in app data (in-app 8K/16K download) and then in the bundled folder.
 * `revision` (textureStore) busts any cached 404 once a download lands.
 */
export function textureUrl(file: string, revision = 0): string {
  return `globe-texture://textures/${file}${revision ? `?v=${revision}` : ''}`
}
