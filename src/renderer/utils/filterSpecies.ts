import type { FilterState, SpeciesData } from '../types'
import { ENDANGERED_STATUSES } from '../constants'

export function speciesMatchesFilters(s: SpeciesData, f: FilterState): boolean {
  if (f.continents.length && !f.continents.some((c) => s.continents.includes(c))) return false
  if (f.animalGroups.length && !f.animalGroups.includes(s.animal_group)) return false
  if (f.conservationStatus.length && !f.conservationStatus.includes(s.conservation_status)) return false
  if (f.habitatTypes.length && !f.habitatTypes.includes(s.habitat)) return false
  if (s.size_cm < f.sizeRange[0] || s.size_cm > f.sizeRange[1]) return false
  if (f.endangeredOnly && !ENDANGERED_STATUSES.includes(s.conservation_status)) return false
  return true
}

/** Applies every active filter with AND logic (per the project spec). */
export function filterSpeciesList(all: SpeciesData[], f: FilterState): SpeciesData[] {
  return all.filter((s) => speciesMatchesFilters(s, f))
}
