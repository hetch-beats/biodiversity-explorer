import type Database from 'better-sqlite3'

/**
 * Small key/value helper over the existing sync_metadata table (see
 * schema.ts) — the same table already used for last_gbif_sync. Kept here
 * rather than duplicated per-caller since it's now used by both dataSync.ts
 * (reading the token) and ipc/handlers.ts (writing it from Settings).
 */
function getMetadata(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM sync_metadata WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setMetadata(db: Database.Database, key: string, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM sync_metadata WHERE key = ?').run(key)
    return
  }
  db.prepare(
    `INSERT INTO sync_metadata (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value)
}

const IUCN_TOKEN_KEY = 'iucn_api_token'

/**
 * The user's own IUCN Red List API token (see src/main/ipc/iucn.ts for why
 * this can't be a token bundled with the app). Stored in the local SQLite
 * database only — never sent anywhere except directly to api.iucnredlist.org
 * as the Authorization header on a lookup request.
 */
export function getIucnToken(db: Database.Database): string | null {
  return getMetadata(db, IUCN_TOKEN_KEY)
}

export function setIucnToken(db: Database.Database, token: string | null): void {
  setMetadata(db, IUCN_TOKEN_KEY, token && token.trim() ? token.trim() : null)
}
