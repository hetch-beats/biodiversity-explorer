export type ConservationStatus =
  | 'EXTINCT'
  | 'EXTINCT_IN_WILD'
  | 'CRITICALLY_ENDANGERED'
  | 'ENDANGERED'
  | 'VULNERABLE'
  | 'NEAR_THREATENED'
  | 'LEAST_CONCERN'
  | 'DATA_DEFICIENT'

export interface SpeciesData {
  id: string
  common_name: string
  scientific_name: string
  animal_group: string
  kingdom: string
  phylum: string
  class_name: string
  order_name: string
  family: string
  genus: string
  description: string
  /** Null until an attributed image has been resolved (or none exists) — show SpeciesImageCard's fallback. */
  image_url: string | null
  image_kind: 'photo' | 'specimen' | 'fossil' | 'illustration' | 'image' | null
  image_credit: string | null
  image_license: string | null
  image_source: string | null
  image_source_url: string | null
  image_checked_at: string | null
  /** When the stored occurrence set was last completely replaced from GBIF (SQLite UTC "YYYY-MM-DD HH:MM:SS"). */
  occurrences_synced_at: string | null
  occurrence_remote_count: number | null
  conservation_status: ConservationStatus
  /** 'gbif-iucn' = IUCN's checklist on GBIF (default); 'iucn' = user's own IUCN API token; 'wikidata' = legacy rows. */
  conservation_status_source: 'iucn' | 'gbif-iucn' | 'wikidata' | null
  habitat: string
  diet: string
  size_cm: number
  lifespan_years: number
  behavior: string
  migratory: boolean
  continents: string[]
  gbif_key: string | null
  wikipedia_url: string | null
  iucn_url: string | null
  created_at: string
  updated_at: string
}

export interface Occurrence {
  id: number
  species_id: string
  latitude: number
  longitude: number
  country: string | null
  observation_count: number
  last_observed: string | null
}

export interface SearchHistoryItem {
  id: number
  species_id: string | null
  species_name: string | null
  search_term: string
  searched_at: string
}

export interface FilterState {
  continents: string[]
  animalGroups: string[]
  conservationStatus: ConservationStatus[]
  habitatTypes: string[]
  sizeRange: [number, number]
  endangeredOnly: boolean
}

// 11 curated palettes (see biodiversity-explorer-phase2-spec.md "Aesthetics —
// research rationale"): every theme's large surfaces stay low-saturation at
// medium brightness regardless of hue family — saturation is spent only on
// each theme's accent color, not its backgrounds. 'daylight' is the default
// (not a dark theme) since NN/g's synthesis of the dark-vs-light-mode
// research found light mode outperforms dark on reading/proofreading tasks
// with no measured fatigue difference, and the explicit goal here is focus.
export type ThemeId =
  | 'daylight'
  | 'obsidian'
  | 'midnight'
  | 'canopy'
  | 'ember'
  | 'tide'
  | 'amethyst'
  | 'savanna'
  | 'sunset'
  | 'blossom'
  | 'glacier'
export type FontSize = 'small' | 'medium' | 'large'

export interface AppSettings {
  theme: ThemeId
  colorblindMode: boolean
  highContrastMode: boolean
  fontSize: FontSize
}

export interface SyncStatus {
  status: 'success' | 'error'
  message: string
  count?: number
}

export interface GlobePoint {
  lat: number
  lng: number
  count: number
}
