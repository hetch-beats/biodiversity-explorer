import type Database from 'better-sqlite3'

/**
 * Creates every table the app needs, idempotently. Safe to call on every
 * launch — CREATE TABLE IF NOT EXISTS means an existing database is never
 * touched.
 */
export function createSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS species (
      id TEXT PRIMARY KEY,
      common_name TEXT NOT NULL,
      scientific_name TEXT UNIQUE NOT NULL,
      animal_group TEXT NOT NULL,
      kingdom TEXT,
      phylum TEXT,
      class_name TEXT,
      order_name TEXT,
      family TEXT,
      genus TEXT,
      description TEXT,
      image_url TEXT,
      conservation_status TEXT NOT NULL DEFAULT 'DATA_DEFICIENT',
      habitat TEXT,
      diet TEXT,
      size_cm REAL,
      lifespan_years REAL,
      behavior TEXT,
      migratory INTEGER NOT NULL DEFAULT 0,
      continents TEXT NOT NULL DEFAULT '[]',
      gbif_key TEXT,
      wikipedia_url TEXT,
      iucn_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_species_common_name ON species(common_name);
    CREATE INDEX IF NOT EXISTS idx_species_scientific_name ON species(scientific_name);
    CREATE INDEX IF NOT EXISTS idx_species_group ON species(animal_group);

    CREATE TABLE IF NOT EXISTS occurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      species_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      country TEXT,
      observation_count INTEGER DEFAULT 1,
      last_observed TEXT,
      FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_occurrences_species ON occurrences(species_id);
    CREATE INDEX IF NOT EXISTS idx_occurrences_country ON occurrences(country);

    CREATE TABLE IF NOT EXISTS favorites (
      species_id TEXT PRIMARY KEY,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      species_id TEXT,
      search_term TEXT NOT NULL,
      searched_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Searchable index of every Red List taxon seen while browsing
    -- (src/main/services/redListCache.ts), so the instant Search tab can find
    -- it offline. HTTP responses themselves are cached in http_cache (net/http.ts).
    CREATE TABLE IF NOT EXISTS redlist_cache (
      status TEXT NOT NULL,
      scientific_name TEXT NOT NULL,
      common_name TEXT,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (status, scientific_name)
    );

    CREATE INDEX IF NOT EXISTS idx_redlist_cache_status_sort ON redlist_cache(status, sort_order);

    CREATE TABLE IF NOT EXISTS redlist_cache_meta (
      status TEXT PRIMARY KEY,
      total_count INTEGER,
      cached_count INTEGER NOT NULL,
      source TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  migrateAddColumn(db, 'species', 'conservation_status_source', "TEXT")
  migrateAddColumn(db, 'redlist_cache', 'gbif_key', 'INTEGER')

  // Image provenance (src/main/services/speciesImage.ts): every image shown
  // carries where it came from, who made it, and under what license.
  migrateAddColumn(db, 'species', 'image_kind', 'TEXT') // photo | specimen | fossil | illustration | image
  migrateAddColumn(db, 'species', 'image_credit', 'TEXT')
  migrateAddColumn(db, 'species', 'image_license', 'TEXT')
  migrateAddColumn(db, 'species', 'image_source', 'TEXT') // human-readable source, e.g. "iNaturalist via GBIF"
  migrateAddColumn(db, 'species', 'image_source_url', 'TEXT')
  migrateAddColumn(db, 'species', 'image_checked_at', 'TEXT') // null = not resolved yet

  // Occurrence sync bookkeeping (services/dataSync.ts): when the stored set
  // was last fully replaced, and how many records GBIF reported at the time —
  // lets the weekly sync skip unchanged species even above the 5,000 cap, and
  // stops species with no mappable continent from re-downloading every session.
  const addedSyncColumn = migrateAddColumn(db, 'species', 'occurrences_synced_at', 'TEXT')
  migrateAddColumn(db, 'species', 'occurrence_remote_count', 'INTEGER')
  if (addedSyncColumn) {
    // One-time backfill: species that already have stored points (and
    // continents) count as synced as of their last update, so upgrading
    // doesn't re-download every species on first open. Species with points
    // but no continents yet are left unmarked so they get one full sync,
    // which fills continents from GBIF's occurrence data.
    db.exec(`UPDATE species SET occurrences_synced_at = updated_at
             WHERE occurrences_synced_at IS NULL
               AND continents IS NOT NULL AND continents != '[]'
               AND EXISTS (SELECT 1 FROM occurrences o WHERE o.species_id = species.id)`)
  }

  invalidateStaleRedListCache(db)
  reresolveImagesIfResolverChanged(db)
}

/**
 * Re-queue image resolution when the resolver's rules change in a way that
 * could have accepted wrong images. v2: museum records carry scans of
 * catalogue ledgers / accession registers (seen live: NHM London's "Zoology
 * Accessions Register … page 37" shown as the Bonin wood pigeon), which v1
 * accepted as "specimen" photos. Only specimen/fossil picks are reset; photos
 * and Commons picks are unaffected. Runs once per version per install.
 */
function reresolveImagesIfResolverChanged(db: Database.Database): void {
  const IMAGE_RESOLVER_VERSION = '2'
  const row = db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('image_resolver_version') as
    | { value: string }
    | undefined
  if (row?.value === IMAGE_RESOLVER_VERSION) return
  const reset = db
    .prepare(
      `UPDATE species SET image_url = NULL, image_kind = NULL, image_credit = NULL, image_license = NULL,
       image_source = NULL, image_source_url = NULL, image_checked_at = NULL
       WHERE image_kind IN ('specimen', 'fossil')`
    )
    .run()
  db.prepare(
    `INSERT INTO sync_metadata (key, value, updated_at) VALUES ('image_resolver_version', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(IMAGE_RESOLVER_VERSION)
  if (reset.changes > 0) console.log(`[db] Re-queued ${reset.changes} specimen/fossil images for the stricter resolver.`)
}

/**
 * One-time search-index bust, keyed on a version in sync_metadata so it runs
 * once per install. v3: the index had been filled from bundled snapshot files
 * that predated the animals-only filter (plants such as Agave lurida listed as
 * Extinct in the Wild); the Red List source is now IUCN's checklist on GBIF,
 * which is animal-only, so start the index clean.
 */
function invalidateStaleRedListCache(db: Database.Database): void {
  const CACHE_SCHEMA_VERSION = '3' // bump again if the source's semantics change enough to need another bust
  const row = db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get('redlist_cache_schema_version') as
    | { value: string }
    | undefined
  if (row?.value === CACHE_SCHEMA_VERSION) return

  db.exec('DELETE FROM redlist_cache; DELETE FROM redlist_cache_meta;')
  db.prepare(
    `INSERT INTO sync_metadata (key, value, updated_at) VALUES ('redlist_cache_schema_version', ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(CACHE_SCHEMA_VERSION)
  console.log('[db] Cleared Red List search index (source moved to IUCN checklist on GBIF).')
}

/**
 * CREATE TABLE IF NOT EXISTS only helps for brand-new databases — an
 * existing user's species table was already created without a column added
 * in a later version of the app. This adds it once, safely, on any DB that
 * doesn't have it yet (checked via PRAGMA table_info rather than a
 * try/catch-and-ignore, so a real ALTER TABLE failure isn't swallowed).
 */
/** Returns true if the column was added just now (i.e. this is the migration run). */
function migrateAddColumn(db: Database.Database, table: string, column: string, definition: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some((c) => c.name === column)) return false
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  return true
}
