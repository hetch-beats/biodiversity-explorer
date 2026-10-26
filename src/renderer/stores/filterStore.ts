import { create } from 'zustand'
import type { ConservationStatus, FilterState } from '../types'
import { DEFAULT_SIZE_RANGE } from '../constants'

function emptyFilters(): FilterState {
  return {
    continents: [],
    animalGroups: [],
    conservationStatus: [],
    habitatTypes: [],
    sizeRange: [...DEFAULT_SIZE_RANGE],
    endangeredOnly: false
  }
}

interface FilterStoreState {
  // Filters apply live as soon as you toggle them — there is no separate
  // "apply"/"refresh" step. (There used to be a draft/apply split here that
  // required an extra click before anything changed; that's what made it
  // look like filters "didn't work".)
  filters: FilterState

  toggleContinent: (continent: string) => void
  toggleAnimalGroup: (group: string) => void
  toggleConservationStatus: (status: ConservationStatus) => void
  toggleHabitat: (habitat: string) => void
  setSizeRange: (min: number, max: number) => void
  toggleEndangeredOnly: () => void

  clearAllFilters: () => void
  activeFilterCount: () => number
}

function toggleItem<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((i) => i !== item) : [...list, item]
}

export const useFilterStore = create<FilterStoreState>((set, get) => ({
  filters: emptyFilters(),

  toggleContinent: (continent) =>
    set((s) => ({ filters: { ...s.filters, continents: toggleItem(s.filters.continents, continent) } })),

  toggleAnimalGroup: (group) =>
    set((s) => ({ filters: { ...s.filters, animalGroups: toggleItem(s.filters.animalGroups, group) } })),

  toggleConservationStatus: (status) =>
    set((s) => ({
      filters: { ...s.filters, conservationStatus: toggleItem(s.filters.conservationStatus, status) }
    })),

  toggleHabitat: (habitat) =>
    set((s) => ({ filters: { ...s.filters, habitatTypes: toggleItem(s.filters.habitatTypes, habitat) } })),

  setSizeRange: (min, max) => set((s) => ({ filters: { ...s.filters, sizeRange: [min, max] } })),

  toggleEndangeredOnly: () => set((s) => ({ filters: { ...s.filters, endangeredOnly: !s.filters.endangeredOnly } })),

  clearAllFilters: () => set({ filters: emptyFilters() }),

  activeFilterCount: () => {
    const f = get().filters
    return (
      f.continents.length +
      f.animalGroups.length +
      f.conservationStatus.length +
      f.habitatTypes.length +
      (f.endangeredOnly ? 1 : 0) +
      (f.sizeRange[0] !== DEFAULT_SIZE_RANGE[0] || f.sizeRange[1] !== DEFAULT_SIZE_RANGE[1] ? 1 : 0)
    )
  }
}))
