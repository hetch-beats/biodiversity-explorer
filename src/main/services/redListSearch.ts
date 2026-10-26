import Fuse from 'fuse.js'
import type Database from 'better-sqlite3'
import type { RedListTaxon } from '../ipc/iucnChecklist'
import type { ConservationStatus } from '../utils/conservationStatus'
import { BUNDLED_REDLIST_DATA } from '../data/redlist'
import { redListCacheVersion } from './redListCache'

export interface RedListSearchHit extends RedListTaxon {
  status: ConservationStatus
}

interface CacheRow {
  status: string
  scientific_name: string
  common_name: string | null
  gbif_key: number | null
}

/**
 * Search-as-you-type over every Red List taxon this install has on hand —
 * the bundled snapshot (`npm run fetch-redlist`) plus every page seen while
 * browsing (redlist_cache) — merged across all statuses. Local only: it runs
 * on every keystroke, so it never makes a network request.
 *
 * The Fuse index is rebuilt only when the cache has been written to since
 * the last build — not on every keystroke.
 */
let indexed: { version: number; fuse: Fuse<RedListSearchHit> } | null = null

export function searchRedListTaxa(db: Database.Database, query: string, limit = 20): RedListSearchHit[] {
  if (!query.trim()) return []

  const version = redListCacheVersion()
  if (!indexed || indexed.version !== version) {
    let rows: CacheRow[] = []
    try {
      rows = db.prepare('SELECT status, scientific_name, common_name, gbif_key FROM redlist_cache').all() as CacheRow[]
    } catch (err) {
      console.error('[redListSearch] reading cache failed — searching bundled data only:', err)
    }
    // Bundled first, then browsed rows — the latter are newer, so they win on conflicts.
    const merged = new Map<string, RedListSearchHit>()
    for (const status of Object.keys(BUNDLED_REDLIST_DATA) as ConservationStatus[]) {
      for (const t of BUNDLED_REDLIST_DATA[status].taxa) merged.set(t.scientificName.toLowerCase(), { ...t, status })
    }
    for (const r of rows) {
      merged.set(r.scientific_name.toLowerCase(), {
        scientificName: r.scientific_name,
        commonName: r.common_name,
        gbifKey: r.gbif_key,
        status: r.status as ConservationStatus
      })
    }
    indexed = {
      version,
      fuse: new Fuse(Array.from(merged.values()), {
        keys: [
          { name: 'scientificName', weight: 0.6 },
          { name: 'commonName', weight: 0.4 }
        ],
        threshold: 0.35,
        ignoreLocation: true
      })
    }
  }

  return indexed.fuse.search(query, { limit }).map((r) => r.item)
}
