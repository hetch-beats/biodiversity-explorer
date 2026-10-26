import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { createSchema } from './schema'
import { SEED_SPECIES } from './seedData'

let dbInstance: Database.Database | null = null

/**
 * Lazily opens (and, on first run, creates + seeds) the app's SQLite
 * database in the user's per-OS app-data folder. Safe to call repeatedly —
 * subsequent calls return the same open connection.
 */
export function getDb(): Database.Database {
  if (dbInstance) return dbInstance

  const dbPath = join(app.getPath('userData'), 'biodiversity-explorer.db')
  const db = new Database(dbPath)

  createSchema(db)
  seedMissingSpecies(db)

  dbInstance = db
  return db
}

/**
 * Inserts any curated species from SEED_SPECIES that aren't already in the
 * database, keyed on scientific_name (UNIQUE in the schema). Runs on every
 * launch, not just when the table is empty — SEED_SPECIES has grown since
 * the original release (53 -> 96 species, rebalancing continents/groups
 * that were thin — see the comment atop seedData.ts), and an install that
 * seeded before that growth needs those species to actually reach it rather
 * than being permanently stuck with whatever was in the table on first run.
 * INSERT OR IGNORE means an already-present species (including one the user
 * has since synced fresh GBIF/Wikipedia/conservation-status data into) is
 * left untouched — this only ever adds rows, never modifies existing ones.
 */
function seedMissingSpecies(db: Database.Database): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO species (
      id, common_name, scientific_name, animal_group, kingdom, phylum, class_name, order_name,
      family, genus, description, image_url, conservation_status, habitat, diet, size_cm,
      lifespan_years, behavior, migratory, continents, gbif_key, wikipedia_url, iucn_url
    ) VALUES (
      @id, @common_name, @scientific_name, @animal_group, @kingdom, @phylum, @class_name, @order_name,
      @family, @genus, @description, @image_url, @conservation_status, @habitat, @diet, @size_cm,
      @lifespan_years, @behavior, @migratory, @continents, @gbif_key, @wikipedia_url, @iucn_url
    )
  `)

  const insertAll = db.transaction((species: typeof SEED_SPECIES) => {
    let added = 0
    for (const s of species) {
      const result = insert.run({
        id: randomUUID(),
        ...s,
        // No placeholder image: an attributed image is resolved on first view
        // (services/speciesImage.ts); until then the UI shows a taxon-group card.
        image_url: null,
        migratory: s.migratory ? 1 : 0,
        continents: JSON.stringify(s.continents),
        gbif_key: null,
        wikipedia_url: null,
        iucn_url: null
      })
      if (result.changes > 0) added++
    }
    return added
  })

  const added = insertAll(SEED_SPECIES)
  if (added > 0) {
    console.log(`[db] Seeded ${added} new species (${SEED_SPECIES.length - added} already present).`)
  }
}
