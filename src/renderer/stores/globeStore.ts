import { create } from 'zustand'
import type { GlobePoint, Occurrence } from '../types'
import type { GlobeView } from '../globe/views'
import type { GpuInfo, LoadedTexture } from '../globe/imagery'

interface MigrationRoute {
  season: string
  points: Array<[number, number]> // [lat, lng]
}

interface GlobeState {
  occurrencePoints: GlobePoint[]
  loadingOccurrences: boolean
  // True while a species selection is triggering its first-ever GBIF sync
  // (see App.tsx) — distinct from loadingOccurrences, which is just the
  // near-instant local-DB read.
  syncingSpecies: boolean
  // Short-lived status shown after an auto-sync finishes (e.g. "No GBIF
  // occurrence records found for Chelonia mydas"), so an empty globe reads
  // as "no data exists" instead of looking broken. Null when there's
  // nothing to show.
  syncMessage: string | null
  // True while the lightweight detail/image lookup runs for the selected species.
  detailsLoading: boolean
  migrationRoutes: MigrationRoute[]
  comparisonMode: boolean
  selectedRegion: string | null
  screenshotRequestId: number
  // Surface imagery status, published by Globe.tsx for the view switcher and
  // Settings. `loaded` is what is actually on the globe for `view`.
  imagery: { view: GlobeView | null; loaded: LoadedTexture | null; loading: boolean; tilesActive: boolean }
  gpu: GpuInfo | null

  loadOccurrences: (speciesId: string) => Promise<void>
  clearOccurrences: () => void
  setSyncingSpecies: (syncing: boolean) => void
  setSyncMessage: (message: string | null) => void
  setDetailsLoading: (loading: boolean) => void
  toggleComparisonMode: () => void
  setSelectedRegion: (region: string | null) => void
  requestScreenshot: () => void
  setImagery: (patch: Partial<GlobeState['imagery']>) => void
  setGpu: (gpu: GpuInfo) => void
}

function toPoints(occurrences: Occurrence[]): GlobePoint[] {
  return occurrences.map((o) => ({ lat: o.latitude, lng: o.longitude, count: o.observation_count || 1 }))
}

export const useGlobeStore = create<GlobeState>((set) => ({
  occurrencePoints: [],
  loadingOccurrences: false,
  syncingSpecies: false,
  syncMessage: null,
  detailsLoading: false,
  migrationRoutes: [],
  comparisonMode: false,
  selectedRegion: null,
  screenshotRequestId: 0,
  imagery: { view: null, loaded: null, loading: true, tilesActive: false },
  gpu: null,

  loadOccurrences: async (speciesId) => {
    set({ loadingOccurrences: true })
    try {
      const occurrences = await window.api.getOccurrences(speciesId)
      set({ occurrencePoints: toPoints(occurrences), loadingOccurrences: false })
    } catch (err) {
      console.error('Failed to load occurrences:', err)
      set({ occurrencePoints: [], loadingOccurrences: false })
    }
  },

  clearOccurrences: () => set({ occurrencePoints: [] }),
  setSyncingSpecies: (syncing) => set({ syncingSpecies: syncing }),
  setSyncMessage: (message) => set({ syncMessage: message }),
  setDetailsLoading: (loading) => set({ detailsLoading: loading }),
  toggleComparisonMode: () => set((s) => ({ comparisonMode: !s.comparisonMode })),
  setSelectedRegion: (region) => set({ selectedRegion: region }),
  // Globe.tsx watches this counter and captures a PNG whenever it changes.
  requestScreenshot: () => set((s) => ({ screenshotRequestId: s.screenshotRequestId + 1 })),
  setImagery: (patch) => set((s) => ({ imagery: { ...s.imagery, ...patch } })),
  setGpu: (gpu) => set({ gpu })
}))
