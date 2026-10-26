import { app, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { refreshSpeciesData, ensureSpeciesDetails } from '../services/dataSync'
import { getIucnToken, setIucnToken } from '../database/settings'
import { fetchIucnConservationStatus } from './iucn'
import { browseRedList } from '../services/redListBrowse'
import { searchRedListTaxa } from '../services/redListSearch'
import { ensureSpeciesByScientificName } from '../services/ensureSpecies'
import type { ConservationStatus } from '../utils/conservationStatus'
import { downloadTextures, getTextureStatus, type TextureTier } from '../services/globeTextures'

/** Row shape as it comes back from SQLite (continents/migratory are still raw). */
interface SpeciesRow {
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
  image_url: string | null
  image_kind: string | null
  image_credit: string | null
  image_license: string | null
  image_source: string | null
  image_source_url: string | null
  image_checked_at: string | null
  occurrences_synced_at: string | null
  occurrence_remote_count: number | null
  conservation_status: string
  conservation_status_source: string | null
  habitat: string
  diet: string
  size_cm: number
  lifespan_years: number
  behavior: string
  migratory: number
  continents: string
  gbif_key: string | null
  wikipedia_url: string | null
  iucn_url: string | null
  created_at: string
  updated_at: string
}

function toSpecies(row: SpeciesRow) {
  return {
    ...row,
    // Only images that passed the attribution-checked resolver
    // (services/speciesImage.ts) ever reach the UI. Older rows still hold
    // placeholders or raw Wikipedia lead images until they're resolved on
    // first view; until then the UI shows its neutral card instead.
    image_url: row.image_checked_at ? row.image_url : null,
    migratory: !!row.migratory,
    continents: JSON.parse(row.continents || '[]')
  }
}

/**
 * Registers every ipcMain.handle() channel the renderer is allowed to call
 * (see src/preload/index.ts for the matching whitelist). Call once from
 * src/main/index.ts after the database is open.
 */
export function registerIpcHandlers(db: Database.Database): void {
  // ---- Species data ----

  ipcMain.handle('db:getAllSpecies', () => {
    const rows = db.prepare('SELECT * FROM species ORDER BY common_name ASC').all() as SpeciesRow[]
    return rows.map(toSpecies)
  })

  ipcMain.handle('db:getSpeciesDetails', (_event, speciesId: string) => {
    const row = db.prepare('SELECT * FROM species WHERE id = ?').get(speciesId) as SpeciesRow | undefined
    return row ? toSpecies(row) : null
  })

  ipcMain.handle('db:getOccurrences', (_event, speciesId: string) => {
    return db
      .prepare(
        'SELECT id, species_id, latitude, longitude, country, observation_count, last_observed FROM occurrences WHERE species_id = ? LIMIT 10000'
      )
      .all(speciesId)
  })

  // ---- Favorites ----

  ipcMain.handle('db:addFavorite', (_event, speciesId: string) => {
    try {
      db.prepare('INSERT OR IGNORE INTO favorites (species_id) VALUES (?)').run(speciesId)
      return { success: true }
    } catch (err) {
      console.error('[ipc] addFavorite failed:', err)
      return { success: false }
    }
  })

  ipcMain.handle('db:removeFavorite', (_event, speciesId: string) => {
    try {
      db.prepare('DELETE FROM favorites WHERE species_id = ?').run(speciesId)
      return { success: true }
    } catch (err) {
      console.error('[ipc] removeFavorite failed:', err)
      return { success: false }
    }
  })

  ipcMain.handle('db:getFavorites', () => {
    const rows = db
      .prepare(
        `SELECT s.* FROM favorites f JOIN species s ON s.id = f.species_id ORDER BY f.added_at DESC`
      )
      .all() as SpeciesRow[]
    return rows.map(toSpecies)
  })

  // ---- Search history ----

  ipcMain.handle('db:getSearchHistory', (_event, limit = 15) => {
    return db
      .prepare(
        `SELECT h.id, h.species_id, s.common_name as species_name, h.search_term, h.searched_at
         FROM search_history h
         LEFT JOIN species s ON s.id = h.species_id
         ORDER BY h.searched_at DESC
         LIMIT ?`
      )
      .all(limit)
  })

  ipcMain.handle('db:addSearchHistory', (_event, speciesId: string | null, searchTerm: string) => {
    try {
      db.prepare('INSERT INTO search_history (species_id, search_term) VALUES (?, ?)').run(
        speciesId,
        searchTerm
      )
      return { success: true }
    } catch (err) {
      console.error('[ipc] addSearchHistory failed:', err)
      return { success: false }
    }
  })

  ipcMain.handle('db:clearSearchHistory', () => {
    try {
      db.prepare('DELETE FROM search_history').run()
      return { success: true }
    } catch (err) {
      console.error('[ipc] clearSearchHistory failed:', err)
      return { success: false }
    }
  })

  // ---- Data sync ----

  ipcMain.handle('sync:refreshData', async (_event, speciesId?: string) => {
    return refreshSpeciesData(db, speciesId)
  })

  // Lightweight: description, attributed image, habitat — no occurrence
  // download. Used when a species with cached points is opened but hasn't
  // had its details resolved yet.
  // (Uses the species' stored GBIF key when it has one.)
  ipcMain.handle('species:ensureDetails', async (_event, speciesId: string) => {
    await ensureSpeciesDetails(db, speciesId)
    const row = db.prepare('SELECT * FROM species WHERE id = ?').get(speciesId) as SpeciesRow | undefined
    return row ? toSpecies(row) : null
  })

  ipcMain.handle('sync:getLastSync', () => {
    const row = db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('last_gbif_sync') as
      | { value: string }
      | undefined
    return row?.value ?? null
  })

  // ---- Settings: IUCN API token ----
  // Conservation status defaults to IUCN's Red List checklist on GBIF
  // (keyless — src/main/ipc/iucnChecklist.ts). This is the optional
  // bring-your-own-token override for the IUCN Red List API itself
  // (src/main/ipc/iucn.ts); see that file for why no token ships built in.

  ipcMain.handle('settings:getIucnToken', () => getIucnToken(db))

  ipcMain.handle('settings:setIucnToken', async (_event, token: string | null) => {
    setIucnToken(db, token)
    if (!token) return { validated: false, message: null }

    // Give immediate feedback rather than making the user wait for the next
    // sync to discover a typo'd or expired token — tested against a species
    // virtually guaranteed to have an IUCN assessment.
    const result = await fetchIucnConservationStatus('Panthera leo', token)
    return {
      validated: result.ok,
      message: result.ok ? 'Token verified — IUCN data will be used from now on.' : result.message
    }
  })

  // ---- Browse the IUCN Red List (animals) ----
  // Paged straight from IUCN's checklist on GBIF (src/main/services/redListBrowse.ts),
  // with true totals. Opening a result creates a local species row for that
  // one species only (src/main/services/ensureSpecies.ts).

  ipcMain.handle(
    'browse:redList',
    async (_event, status: ConservationStatus, offset = 0, limit = 100, forceRefresh = false, fromBundled = false) => {
      return browseRedList(db, status, offset, limit, forceRefresh, fromBundled)
    }
  )

  // Unified, instant, cross-status search — this is what lets the main
  // search bar treat "the curated library" and "the full Red List" as one
  // surface (see src/main/services/redListSearch.ts). Synchronous/local
  // only, safe to call on every keystroke.
  ipcMain.handle('search:redListTaxa', (_event, query: string, limit = 20) => {
    try {
      return searchRedListTaxa(db, query, limit)
    } catch (err) {
      console.error('[ipc] searchRedListTaxa failed:', err)
      return []
    }
  })

  ipcMain.handle(
    'browse:ensureSpecies',
    async (
      _event,
      scientificName: string,
      status: ConservationStatus,
      commonName?: string | null,
      gbifKey?: number | null
    ) => {
      const result = await ensureSpeciesByScientificName(db, scientificName, status, commonName, gbifKey)
      if (result.status === 'error') return result
      return { status: result.status, species: toSpecies(result.row as unknown as SpeciesRow) }
    }
  )

  // ---- App info ----

  // Globe imagery: status, and the on-demand 8K/16K download (Settings → Globe).
  ipcMain.handle('textures:getStatus', () => getTextureStatus())
  ipcMain.handle('textures:download', (_e, tiers: unknown) => {
    const valid = (Array.isArray(tiers) ? tiers : []).filter((t): t is TextureTier => t === '8k' || t === '16k')
    return downloadTextures(valid)
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:checkForUpdates', () => {
    // electron-updater drives real update checks in a packaged build (see
    // src/main/services/dataSync.ts / future auto-update wiring). In dev
    // there is nothing to check against, so report a stable "no update".
    return { updateAvailable: false, currentVersion: app.getVersion() }
  })
}
