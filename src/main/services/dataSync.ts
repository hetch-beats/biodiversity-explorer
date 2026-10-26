import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import {
  searchGBIFTaxon,
  getGBIFTaxonByKey,
  fetchGBIFOccurrences,
  countGBIFOccurrences,
  continentsFromOccurrences,
  fetchGBIFHabitats
} from '../ipc/gbif'
import { searchWikipedia } from '../ipc/wikipedia'
import { refreshConservationStatus } from './conservationStatus'
import { resolveSpeciesImage } from './speciesImage'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// Species refreshed by the automatic weekly sync and by a no-argument
// "Refresh data" click (i.e. when nothing is selected).
const DEFAULT_SYNC_SPECIES = [
  'Lion',
  'Tiger',
  'African Elephant',
  'Polar Bear',
  'Giant Panda',
  'Blue Whale',
  'Great White Shark',
  'Monarch Butterfly',
  'Emperor Penguin',
  'Bald Eagle'
]

interface SpeciesRef {
  id: string
  scientific_name: string
  gbif_key: string | null
}

function getLastSync(db: Database.Database): number | null {
  const row = db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('last_gbif_sync') as
    | { value: string }
    | undefined
  if (!row?.value) return null
  const t = Date.parse(row.value)
  return Number.isNaN(t) ? null : t
}

function setLastSync(db: Database.Database): void {
  db.prepare(
    `INSERT INTO sync_metadata (key, value, updated_at) VALUES ('last_gbif_sync', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(new Date().toISOString())
}

function storedKey(species: SpeciesRef): number | null {
  const n = Number(species.gbif_key)
  return Number.isInteger(n) && n > 0 ? n : null
}

const SPECIES_LEVEL = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM', 'INFRASPECIFIC_NAME'])

/**
 * GBIF backbone key for a species: the stored key when it's a species-level
 * taxon (keys saved by older versions could be a genus from a loose match —
 * checked via a month-cached lookup), otherwise a strict species-level name
 * match. `error` distinguishes "offline" from "GBIF doesn't know this name".
 */
async function resolveTaxonKey(species: SpeciesRef): Promise<{ key: number | null; error: boolean }> {
  const stored = storedKey(species)
  if (stored) {
    try {
      const taxon = await getGBIFTaxonByKey(stored)
      if (taxon && SPECIES_LEVEL.has(taxon.rank)) return { key: stored, error: false }
      // Not species-level (or gone): fall through to a fresh strict match.
    } catch {
      return { key: stored, error: false } // offline: use it; any fetch will fail cleanly anyway
    }
  }
  try {
    return { key: (await searchGBIFTaxon(species.scientific_name))?.taxonKey ?? null, error: false }
  } catch {
    return { key: null, error: true }
  }
}

/**
 * Fills in everything about a species EXCEPT occurrence points: description,
 * image (with credit/license), habitat. Cheap — a few requests, mostly from
 * the HTTP cache — so it runs when a species is opened, without
 * re-downloading thousands of occurrence records just to get a picture.
 * Only fills empty fields; curated values are never overwritten.
 *
 * image_checked_at is set only when the lookup actually completed (image
 * found, or every source answered "none"). If anything failed — e.g.
 * offline — it stays unset and the lookup is retried next time, instead of
 * permanently recording "no image". Never throws.
 */
export async function ensureSpeciesDetails(
  db: Database.Database,
  speciesId: string,
  knownTaxonKey?: number | null
): Promise<void> {
  try {
    const species = db
      .prepare(
        `SELECT id, scientific_name, gbif_key, habitat, wikipedia_url, image_checked_at FROM species WHERE id = ?`
      )
      .get(speciesId) as
      | (SpeciesRef & { habitat: string | null; wikipedia_url: string | null; image_checked_at: string | null })
      | undefined
    if (!species) return

    const taxon = knownTaxonKey ? { key: knownTaxonKey, error: false } : await resolveTaxonKey(species)

    // Wikipedia: text only. Its lead image is handed to the image resolver as
    // a labeled last resort, never used directly.
    let wikiFailed = false
    let wiki: Awaited<ReturnType<typeof searchWikipedia>> = null
    if (!species.wikipedia_url || !species.image_checked_at) {
      try {
        wiki = await searchWikipedia(species.scientific_name)
      } catch {
        wikiFailed = true
      }
    }
    if (wiki && !species.wikipedia_url) {
      db.prepare(
        `UPDATE species SET wikipedia_url = ?, description = COALESCE(NULLIF(description, ''), NULLIF(?, '')),
         updated_at = datetime('now') WHERE id = ?`
      ).run(wiki.url, wiki.extract, speciesId)
    }

    if (!species.image_checked_at) {
      const { image, complete } = await resolveSpeciesImage(taxon.key, species.scientific_name, wiki?.pageImageFile ?? null)
      if (image) {
        db.prepare(
          `UPDATE species SET image_url = ?, image_kind = ?, image_credit = ?, image_license = ?, image_source = ?,
           image_source_url = ?, image_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        ).run(image.url, image.kind, image.credit, image.license, image.source, image.sourceUrl, speciesId)
      } else if (complete && !wikiFailed && !taxon.error) {
        // Every source answered and none had a usable image: record that, and
        // drop any old placeholder/unattributed image so the UI shows its card.
        db.prepare(
          `UPDATE species SET image_url = NULL, image_kind = NULL, image_credit = NULL, image_license = NULL,
           image_source = NULL, image_source_url = NULL, image_checked_at = datetime('now') WHERE id = ?`
        ).run(speciesId)
      }
      // else: a lookup failed — leave unresolved so it's retried.
    }

    if (!species.habitat?.trim() && taxon.key) {
      const habitats = await fetchGBIFHabitats(taxon.key)
      if (habitats.length > 0) {
        db.prepare("UPDATE species SET habitat = ?, updated_at = datetime('now') WHERE id = ?").run(
          habitats.join(', '),
          speciesId
        )
      }
    }
  } catch (err) {
    console.error('[dataSync] ensureSpeciesDetails failed:', err)
  }
}

interface SyncOutcome {
  ok: boolean
  count: number
  error?: string
}

/**
 * Fetches fresh GBIF occurrences for one species, then its details and
 * conservation status.
 *
 * Safety: the stored occurrence set is replaced ONLY by a complete fetch. A
 * failed or partial fetch (offline, a page erroring) leaves what's stored
 * untouched and reports an error — it never wipes points or swaps a full set
 * for a partial one.
 *
 * With `skipIfUnchanged` (the weekly background sync) it first asks GBIF for
 * the record count — one tiny request — and skips the download when it
 * matches the count recorded at the last full sync.
 */
async function syncOneSpecies(db: Database.Database, species: SpeciesRef, skipIfUnchanged: boolean): Promise<SyncOutcome> {
  let taxon = await resolveTaxonKey(species)
  if (taxon.error) return { ok: false, count: 0, error: "Couldn't reach GBIF" }

  if (skipIfUnchanged && taxon.key) {
    const remote = await countGBIFOccurrences(taxon.key)
    const row = db.prepare('SELECT occurrence_remote_count FROM species WHERE id = ?').get(species.id) as {
      occurrence_remote_count: number | null
    }
    if (remote !== null && row?.occurrence_remote_count === remote) {
      console.log(`[dataSync] ${species.scientific_name}: ${remote} records, unchanged — skipped download`)
      await refreshConservationStatus(db, species)
      const stored = (db.prepare('SELECT COUNT(*) AS n FROM occurrences WHERE species_id = ?').get(species.id) as { n: number }).n
      return { ok: true, count: stored }
    }
  }

  if (!taxon.key) {
    // No trustworthy species-level match in GBIF's backbone. Don't touch any
    // stored points (the stricter match rules must not wipe existing data);
    // still fill details/status from the other sources.
    await ensureSpeciesDetails(db, species.id, null)
    await refreshConservationStatus(db, species)
    // Record that we checked, so this isn't retried on every session's first open.
    db.prepare("UPDATE species SET occurrences_synced_at = datetime('now') WHERE id = ?").run(species.id)
    const stored = (db.prepare('SELECT COUNT(*) AS n FROM occurrences WHERE species_id = ?').get(species.id) as { n: number }).n
    return { ok: true, count: stored }
  }

  let fetched = await fetchGBIFOccurrences(taxon.key)

  // A stored key that yields nothing might predate the species/match fix —
  // retry once with a fresh species-level name match if it differs.
  if (fetched && fetched.remoteCount === 0 && storedKey(species)) {
    try {
      const matched = await searchGBIFTaxon(species.scientific_name)
      if (matched && matched.taxonKey !== taxon.key) {
        taxon = { key: matched.taxonKey, error: false }
        fetched = await fetchGBIFOccurrences(matched.taxonKey)
      }
    } catch {
      /* keep the original (empty) result */
    }
  }

  if (!fetched) return { ok: false, count: 0, error: "Couldn't download occurrence records from GBIF" }
  if (!fetched.complete) {
    const stored = (db.prepare('SELECT COUNT(*) AS n FROM occurrences WHERE species_id = ?').get(species.id) as { n: number }).n
    if (stored > 0) {
      // Keep the complete set we already have rather than a partial one —
      // but still refresh details and status, which don't depend on it.
      await ensureSpeciesDetails(db, species.id, taxon.key)
      await refreshConservationStatus(db, species)
      return { ok: false, count: stored, error: 'Some GBIF pages failed — kept the previously downloaded records' }
    }
    // Nothing stored yet: a partial set is better than none, but don't mark it synced.
  }

  const clearStmt = db.prepare('DELETE FROM occurrences WHERE species_id = ?')
  const insertStmt = db.prepare(
    `INSERT INTO occurrences (species_id, latitude, longitude, country, observation_count, last_observed)
     VALUES (@species_id, @latitude, @longitude, @country, 1, @last_observed)`
  )
  db.transaction(() => {
    clearStmt.run(species.id)
    for (const o of fetched!.records) {
      insertStmt.run({
        species_id: species.id,
        latitude: o.latitude,
        longitude: o.longitude,
        country: o.country,
        last_observed: o.year ? `${o.year}-01-01` : null
      })
    }
    db.prepare(
      `UPDATE species SET gbif_key = COALESCE(?, gbif_key),
         occurrences_synced_at = CASE WHEN ? THEN datetime('now') ELSE occurrences_synced_at END,
         occurrence_remote_count = CASE WHEN ? THEN ? ELSE occurrence_remote_count END,
         updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      taxon.key ? String(taxon.key) : null,
      fetched!.complete ? 1 : 0,
      fetched!.complete ? 1 : 0,
      fetched!.remoteCount,
      species.id
    )
  })()

  // Continents from the occurrences just fetched (no extra request); only
  // filled when empty, so curated values stay.
  const row = db.prepare('SELECT continents FROM species WHERE id = ?').get(species.id) as { continents: string | null }
  let hasContinents = false
  try {
    hasContinents = (JSON.parse(row?.continents || '[]') as unknown[]).length > 0
  } catch {
    hasContinents = false
  }
  if (!hasContinents) {
    const continents = continentsFromOccurrences(fetched.records)
    if (continents.length > 0) {
      db.prepare("UPDATE species SET continents = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(continents),
        species.id
      )
    }
  }

  await ensureSpeciesDetails(db, species.id, taxon.key)
  await refreshConservationStatus(db, species) // never throws

  return fetched.complete
    ? { ok: true, count: fetched.records.length }
    : { ok: false, count: fetched.records.length, error: 'Some GBIF pages failed — showing a partial set' }
}

/**
 * "Refresh data" entry point (IPC: sync:refreshData). With speciesId,
 * refreshes that species in full; otherwise the DEFAULT_SYNC_SPECIES batch.
 * The weekly-sync clock only advances for a batch run where at least one
 * species synced — opening individual species no longer resets it.
 */
export async function refreshSpeciesData(
  db: Database.Database,
  speciesId?: string,
  opts: { skipIfUnchanged?: boolean } = {}
): Promise<{ status: 'success' | 'error'; message: string; count: number }> {
  try {
    const select = 'SELECT id, scientific_name, gbif_key FROM species'
    const placeholders = DEFAULT_SYNC_SPECIES.map(() => '?').join(', ')
    const targets: SpeciesRef[] = speciesId
      ? (db.prepare(`${select} WHERE id = ?`).all(speciesId) as SpeciesRef[])
      : (db.prepare(`${select} WHERE common_name IN (${placeholders})`).all(...DEFAULT_SYNC_SPECIES) as SpeciesRef[])

    let total = 0
    let succeeded = 0
    const errors: string[] = []
    for (const s of targets) {
      const outcome = await syncOneSpecies(db, s, opts.skipIfUnchanged ?? false)
      total += outcome.count
      if (outcome.ok) succeeded++
      else if (outcome.error) errors.push(outcome.error)
    }

    if (!speciesId && succeeded > 0) setLastSync(db)

    if (succeeded === 0 && errors.length > 0) {
      return { status: 'error', message: errors[0], count: total }
    }
    return {
      status: 'success',
      message: `Refreshed ${succeeded} of ${targets.length} species (${total} occurrence points).`,
      count: total
    }
  } catch (err) {
    console.error('[dataSync] refreshSpeciesData failed:', err)
    return { status: 'error', message: (err as Error).message, count: 0 }
  }
}

/**
 * Runs once on app startup. If the last batch sync was more than 7 days ago
 * (or never happened), refreshes the default batch in the background —
 * skipping any species whose GBIF record count hasn't changed — and notifies
 * the renderer when done, without blocking launch.
 */
export function startWeeklySchedule(db: Database.Database, mainWindow: BrowserWindow): void {
  const runIfDue = async (): Promise<void> => {
    const last = getLastSync(db)
    const due = last === null || Date.now() - last > SEVEN_DAYS_MS
    if (!due) return

    try {
      const result = await refreshSpeciesData(db, undefined, { skipIfUnchanged: true })
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:complete', result)
      }
    } catch (err) {
      console.error('[dataSync] weekly sync failed:', err)
    }
  }

  // Give the UI a moment to mount before firing off network requests.
  setTimeout(runIfDue, 5000)
}
