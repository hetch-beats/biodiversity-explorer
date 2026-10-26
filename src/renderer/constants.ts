import type { ConservationStatus, ThemeId } from './types'

export const CONTINENTS = [
  'Africa',
  'Asia',
  'Europe',
  'North America',
  'South America',
  'Oceania',
  'Antarctica'
]

export const ANIMAL_GROUPS = [
  'Mammals',
  'Birds',
  'Reptiles',
  'Amphibians',
  'Fish',
  'Insects',
  'Arachnids',
  'Mollusks',
  'Crustaceans'
]

export const HABITATS = ['Forest', 'Grassland', 'Desert', 'Mountain', 'Wetland', 'Coastal', 'Ocean', 'Urban', 'Polar']

export const CONSERVATION_STATUS_ORDER: ConservationStatus[] = [
  'EXTINCT',
  'EXTINCT_IN_WILD',
  'CRITICALLY_ENDANGERED',
  'ENDANGERED',
  'VULNERABLE',
  'NEAR_THREATENED',
  'LEAST_CONCERN',
  'DATA_DEFICIENT'
]

export const CONSERVATION_STATUS_LABELS: Record<ConservationStatus, string> = {
  EXTINCT: 'Extinct',
  EXTINCT_IN_WILD: 'Extinct in the Wild',
  CRITICALLY_ENDANGERED: 'Critically Endangered',
  ENDANGERED: 'Endangered',
  VULNERABLE: 'Vulnerable',
  NEAR_THREATENED: 'Near Threatened',
  LEAST_CONCERN: 'Least Concern',
  DATA_DEFICIENT: 'Data Deficient'
}

/**
 * Colorblind-safe palette (Okabe-Ito derived) shared by status badges, the
 * filter panel, and the globe's threat heat-map. In "high contrast" mode the
 * UI additionally pairs each color with the status label/icon rather than
 * relying on hue alone.
 */
export const CONSERVATION_STATUS_COLORS: Record<ConservationStatus, string> = {
  EXTINCT: '#1a1a1a',
  EXTINCT_IN_WILD: '#4d4d4d',
  CRITICALLY_ENDANGERED: '#D55E00',
  ENDANGERED: '#E69F00',
  VULNERABLE: '#F0E442',
  NEAR_THREATENED: '#56B4E9',
  LEAST_CONCERN: '#009E73',
  DATA_DEFICIENT: '#999999'
}

export const ENDANGERED_STATUSES: ConservationStatus[] = [
  'VULNERABLE',
  'ENDANGERED',
  'CRITICALLY_ENDANGERED',
  'EXTINCT_IN_WILD'
]

export const DEFAULT_SIZE_RANGE: [number, number] = [0, 3000]

// Display order + labels for the theme picker. Swatch colors read straight
// off each theme's CSS custom properties at render time (see globals.css),
// so this is just metadata, not the color values themselves.
export const THEME_ORDER: ThemeId[] = [
  'daylight',
  'obsidian',
  'midnight',
  'canopy',
  'ember',
  'tide',
  'amethyst',
  'savanna',
  'sunset',
  'blossom',
  'glacier'
]

export const THEME_LABELS: Record<ThemeId, string> = {
  daylight: 'Daylight',
  obsidian: 'Obsidian',
  midnight: 'Midnight',
  canopy: 'Canopy',
  ember: 'Ember',
  tide: 'Tide',
  amethyst: 'Amethyst',
  savanna: 'Savanna',
  sunset: 'Sunset',
  blossom: 'Blossom',
  glacier: 'Glacier'
}

/**
 * Preview swatches for the theme picker (SettingsPanel). Mirrors the
 * --bg-primary/--accent values in globals.css for each theme — duplicated
 * here (rather than read from CSS at runtime) because the picker needs to
 * show all 11 themes' colors simultaneously, while CSS custom properties are
 * only live for whichever theme is currently applied to :root. Keep in sync
 * with globals.css if a palette changes.
 */
export const THEME_SWATCHES: Record<ThemeId, { bg: string; accent: string }> = {
  daylight: { bg: 'rgb(250 251 253)', accent: 'rgb(37 99 235)' },
  obsidian: { bg: 'rgb(12 14 19)', accent: 'rgb(96 165 250)' },
  midnight: { bg: 'rgb(4 5 8)', accent: 'rgb(120 140 255)' },
  canopy: { bg: 'rgb(12 17 15)', accent: 'rgb(74 194 132)' },
  ember: { bg: 'rgb(19 13 12)', accent: 'rgb(224 96 74)' },
  tide: { bg: 'rgb(10 15 20)', accent: 'rgb(62 158 214)' },
  amethyst: { bg: 'rgb(16 13 20)', accent: 'rgb(164 110 214)' },
  savanna: { bg: 'rgb(18 16 11)', accent: 'rgb(214 172 74)' },
  sunset: { bg: 'rgb(19 14 11)', accent: 'rgb(224 128 68)' },
  blossom: { bg: 'rgb(19 13 16)', accent: 'rgb(224 104 158)' },
  glacier: { bg: 'rgb(10 17 18)', accent: 'rgb(70 196 208)' }
}
