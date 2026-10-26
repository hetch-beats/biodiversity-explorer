import { create } from 'zustand'
import type { SearchHistoryItem, SpeciesData } from '../types'

interface SpeciesState {
  allSpecies: SpeciesData[]
  loadingAll: boolean
  selectedSpecies: SpeciesData | null
  comparisonSpecies: SpeciesData | null
  favorites: SpeciesData[]
  searchHistory: SearchHistoryItem[]

  loadAllSpecies: () => Promise<void>
  setSelectedSpecies: (species: SpeciesData | null) => void
  setComparisonSpecies: (species: SpeciesData | null) => void
  /** Merges a species into allSpecies (add if new, replace if already present by id) — used when
   *  "Browse full Red List" resolves a species that wasn't in the local library yet, so it shows
   *  up in search/filters immediately rather than only after the next full reload. */
  upsertSpecies: (species: SpeciesData) => void

  toggleFavorite: (species: SpeciesData) => Promise<void>
  fetchFavorites: () => Promise<void>
  isFavorite: (speciesId: string) => boolean

  addToSearchHistory: (speciesId: string | null, term: string) => Promise<void>
  fetchSearchHistory: () => Promise<void>
  clearSearchHistory: () => Promise<void>
}

export const useSpeciesStore = create<SpeciesState>((set, get) => ({
  allSpecies: [],
  loadingAll: false,
  selectedSpecies: null,
  comparisonSpecies: null,
  favorites: [],
  searchHistory: [],

  loadAllSpecies: async () => {
    set({ loadingAll: true })
    try {
      const species = await window.api.getAllSpecies()
      set({ allSpecies: species, loadingAll: false })
    } catch (err) {
      console.error('Failed to load species:', err)
      set({ loadingAll: false })
    }
  },

  setSelectedSpecies: (species) => set({ selectedSpecies: species }),
  setComparisonSpecies: (species) => set({ comparisonSpecies: species }),

  upsertSpecies: (species) =>
    set((state) => {
      const exists = state.allSpecies.some((s) => s.id === species.id)
      return {
        allSpecies: exists
          ? state.allSpecies.map((s) => (s.id === species.id ? species : s))
          : [...state.allSpecies, species]
      }
    }),

  toggleFavorite: async (species) => {
    const isFav = get().isFavorite(species.id)
    try {
      if (isFav) {
        await window.api.removeFavorite(species.id)
      } else {
        await window.api.addFavorite(species.id)
      }
      await get().fetchFavorites()
    } catch (err) {
      // The IPC handlers already catch their own DB errors and resolve with
      // {success:false} rather than rejecting — this only fires if the IPC
      // channel itself fails (e.g. the main process restarting mid-call).
      console.error('Failed to toggle favorite:', err)
    }
  },

  fetchFavorites: async () => {
    try {
      const favorites = await window.api.getFavorites()
      set({ favorites })
    } catch (err) {
      console.error('Failed to load favorites:', err)
    }
  },

  isFavorite: (speciesId) => get().favorites.some((f) => f.id === speciesId),

  addToSearchHistory: async (speciesId, term) => {
    if (!term.trim()) return
    try {
      await window.api.addSearchHistory(speciesId, term.trim())
      await get().fetchSearchHistory()
    } catch (err) {
      console.error('Failed to record search history:', err)
    }
  },

  fetchSearchHistory: async () => {
    try {
      const searchHistory = await window.api.getSearchHistory(15)
      set({ searchHistory })
    } catch (err) {
      console.error('Failed to load search history:', err)
    }
  },

  clearSearchHistory: async () => {
    try {
      await window.api.clearSearchHistory()
      set({ searchHistory: [] })
    } catch (err) {
      console.error('Failed to clear search history:', err)
    }
  }
}))
