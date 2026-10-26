import type Database from 'better-sqlite3'
import { fetchIucnConservationStatus } from '../ipc/iucn'
import { lookupIucnStatus } from '../ipc/iucnChecklist'
import { getIucnToken } from '../database/settings'

export type StatusSource = 'iucn' | 'gbif-iucn'

/**
 * Refreshes one species' conservation status.
 *
 * Default (no setup): IUCN's own Red List checklist as published on GBIF
 * (src/main/ipc/iucnChecklist.ts), cached a week. This replaced Wikidata,
 * which answered per-species lookups with HTTP 429 under ordinary use.
 *
 * If the user has added their own IUCN API token in Settings, that's tried
 * first (the API carries the very latest assessment); anything short of a
 * definite answer falls through to the checklist.
 *
 * Only writes when a source returns a status — a miss leaves the stored
 * value alone rather than blanking it.
 */
export async function refreshConservationStatus(
  db: Database.Database,
  species: { id: string; scientific_name: string }
): Promise<void> {
  const token = getIucnToken(db)

  if (token) {
    const iucnResult = await fetchIucnConservationStatus(species.scientific_name, token)
    if (iucnResult.ok && iucnResult.status) {
      writeStatus(db, species.id, iucnResult.status, 'iucn')
      return
    }
    if (!iucnResult.ok && iucnResult.reason === 'invalid-token') {
      console.warn(`[conservationStatus] ${iucnResult.message}`)
    }
  }

  const status = await lookupIucnStatus(species.scientific_name)
  if (status) writeStatus(db, species.id, status, 'gbif-iucn')
}

function writeStatus(db: Database.Database, speciesId: string, status: string, source: StatusSource): void {
  db.prepare(
    `UPDATE species SET conservation_status = ?, conservation_status_source = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, source, speciesId)
}
