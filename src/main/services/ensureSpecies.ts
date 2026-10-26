import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { getGBIFTaxonByKey, searchGBIFTaxon } from '../ipc/gbif'
import { mapGbifClassificationToAnimalGroup } from '../utils/animalGroup'
import type { ConservationStatus } from '../utils/conservationStatus'

export type EnsureSpeciesResult =
  | { status: 'existing' | 'created'; row: Record<string, unknown> }
  | { status: 'error'; message: string }

const inflight = new Map<string, Promise<EnsureSpeciesResult>>()

/**
 * Returns the local DB row for a species, creating a minimal one on the fly
 * if it isn't in the library yet — what lets a Browse/Search result open in
 * the globe, species panel, favorites, etc.
 *
 * - If the caller already knows the GBIF backbone key (Red List results from
 *   IUCN's checklist on GBIF carry it), the taxon is fetched by key: no name
 *   matching, no risk of matching the wrong taxon.
 * - Concurrent calls for the same name share one promise, so a double-click
 *   can't race two inserts or two lookups.
 * - No placeholder image is stored; images are resolved with attribution by
 *   ensureSpeciesDetails() (dataSync.ts) when the species is first viewed.
 */
export function ensureSpeciesByScientificName(
  db: Database.Database,
  scientificName: string,
  knownStatus: ConservationStatus,
  knownCommonName?: string | null,
  knownGbifKey?: number | null
): Promise<EnsureSpeciesResult> {
  const key = scientificName.trim().toLowerCase()
  let pending = inflight.get(key)
  if (!pending) {
    pending = doEnsure(db, scientificName, knownStatus, knownCommonName, knownGbifKey).finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return pending
}

async function doEnsure(
  db: Database.Database,
  scientificName: string,
  knownStatus: ConservationStatus,
  knownCommonName?: string | null,
  knownGbifKey?: number | null
): Promise<EnsureSpeciesResult> {
  const findByName = db.prepare('SELECT * FROM species WHERE scientific_name = ? COLLATE NOCASE')
  const existing = findByName.get(scientificName) as Record<string, unknown> | undefined
  if (existing) return { status: 'existing', row: existing }

  let taxon
  try {
    taxon = knownGbifKey ? await getGBIFTaxonByKey(knownGbifKey) : await searchGBIFTaxon(scientificName)
  } catch {
    return { status: 'error', message: "Couldn't reach GBIF — check your connection and try again." }
  }
  if (!taxon) {
    return {
      status: 'error',
      message: `GBIF has no species-level record for "${scientificName}" (it may be a synonym or a recently described species).`
    }
  }

  const animalGroup = mapGbifClassificationToAnimalGroup(taxon.kingdom, taxon.phylum, taxon.className)
  if (!animalGroup) {
    return {
      status: 'error',
      message: `"${scientificName}" is in kingdom ${taxon.kingdom ?? 'unknown'} — this app covers animals only.`
    }
  }

  // The canonical GBIF name can differ from the list's spelling (e.g. a
  // recombined genus); if that row already exists, reuse it.
  const byCanonical = findByName.get(taxon.name) as Record<string, unknown> | undefined
  if (byCanonical) return { status: 'existing', row: byCanonical }

  const commonName = knownCommonName?.trim() || taxon.name

  const row = {
    id: randomUUID(),
    common_name: commonName,
    scientific_name: taxon.name,
    animal_group: animalGroup,
    kingdom: taxon.kingdom,
    phylum: taxon.phylum,
    class_name: taxon.className,
    order_name: taxon.order,
    family: taxon.family,
    genus: taxon.genus,
    description: '',
    image_url: null,
    conservation_status: knownStatus,
    conservation_status_source: 'gbif-iucn',
    habitat: '',
    diet: '',
    size_cm: 0,
    lifespan_years: 0,
    behavior: '',
    migratory: 0,
    continents: '[]',
    gbif_key: String(taxon.taxonKey),
    wikipedia_url: null,
    iucn_url: null
  }

  try {
    db.prepare(
      `INSERT INTO species (
        id, common_name, scientific_name, animal_group, kingdom, phylum, class_name, order_name,
        family, genus, description, image_url, conservation_status, conservation_status_source,
        habitat, diet, size_cm, lifespan_years, behavior, migratory, continents, gbif_key,
        wikipedia_url, iucn_url
      ) VALUES (
        @id, @common_name, @scientific_name, @animal_group, @kingdom, @phylum, @class_name, @order_name,
        @family, @genus, @description, @image_url, @conservation_status, @conservation_status_source,
        @habitat, @diet, @size_cm, @lifespan_years, @behavior, @migratory, @continents, @gbif_key,
        @wikipedia_url, @iucn_url
      )`
    ).run(row)
  } catch (err) {
    const raced = findByName.get(taxon.name) as Record<string, unknown> | undefined
    if (raced) return { status: 'existing', row: raced }
    console.error(`[ensureSpecies] insert failed for "${scientificName}":`, (err as Error).message)
    return { status: 'error', message: `Couldn't save "${scientificName}" locally: ${(err as Error).message}` }
  }

  const inserted = db.prepare('SELECT * FROM species WHERE id = ?').get(row.id) as Record<string, unknown>
  return { status: 'created', row: inserted }
}
