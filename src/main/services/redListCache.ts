import type Database from 'better-sqlite3'
import type { ConservationStatus } from '../utils/conservationStatus'
import type { RedListTaxon } from '../ipc/iucnChecklist'

/**
 * Every Red List taxon this install has seen while browsing, so the instant
 * Search tab (src/main/services/redListSearch.ts) can find it by name later
 * without a network round trip per keystroke.
 *
 * Response caching itself now lives in the shared HTTP layer
 * (src/main/net/http.ts), so this table is only a searchable index — rows
 * are upserted, never trusted as a complete list.
 */
let version = 0
/** Bumped on every write, so the search index knows when to rebuild. */
export function redListCacheVersion(): number {
  return version
}

export function rememberTaxa(db: Database.Database, status: ConservationStatus, taxa: RedListTaxon[]): void {
  if (taxa.length === 0) return
  version++
  try {
    const upsert = db.prepare(
      `INSERT INTO redlist_cache (status, scientific_name, common_name, gbif_key, sort_order) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(status, scientific_name) DO UPDATE SET
         common_name = COALESCE(excluded.common_name, common_name),
         gbif_key = COALESCE(excluded.gbif_key, gbif_key)`
    )
    const clearOtherStatuses = db.prepare('DELETE FROM redlist_cache WHERE scientific_name = ? AND status != ?')
    db.transaction(() => {
      for (const t of taxa) {
        // A reassessment can move a species between categories; keep only the latest one.
        clearOtherStatuses.run(t.scientificName, status)
        upsert.run(status, t.scientificName, t.commonName, t.gbifKey ?? null)
      }
    })()
  } catch (err) {
    // Search index only — losing a write just means that name isn't searchable offline yet.
    console.error(`[redListCache] remembering ${status} taxa failed:`, err)
  }
}
