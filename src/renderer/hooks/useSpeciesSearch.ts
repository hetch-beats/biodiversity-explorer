import { useMemo } from 'react'
import Fuse, { type IFuseOptions } from 'fuse.js'
import type { SpeciesData } from '../types'

const FUSE_OPTIONS: IFuseOptions<SpeciesData> = {
  keys: [
    { name: 'common_name', weight: 0.4 },
    { name: 'scientific_name', weight: 0.3 },
    { name: 'animal_group', weight: 0.1 },
    { name: 'habitat', weight: 0.1 },
    { name: 'conservation_status', weight: 0.1 }
  ],
  threshold: 0.35,
  ignoreLocation: true
}

/** Builds (and memoizes) a Fuse.js index over the full species list for fuzzy, typo-tolerant search. */
export function useSpeciesSearch(allSpecies: SpeciesData[]) {
  const fuse = useMemo(() => new Fuse(allSpecies, FUSE_OPTIONS), [allSpecies])

  return (query: string, limit = 20): SpeciesData[] => {
    if (!query.trim()) return []
    return fuse.search(query, { limit }).map((r) => r.item)
  }
}
