import axios, { type AxiosError } from 'axios'
import https from 'node:https'
import type Database from 'better-sqlite3'

/**
 * The one way the main process talks to external APIs.
 *
 * Built from the patterns established API clients use rather than invented
 * ad hoc:
 *  - Per-host concurrency + minimum spacing between request starts
 *    (Bottleneck's maxConcurrent/minTime model; p-queue's concurrency/interval),
 *    so a burst of work never hammers one service. iNaturalist, for example,
 *    asks for ~1 request/second (inaturalist.org/pages/api+recommended+practices);
 *    GBIF may answer rapid queries with HTTP 429 (techdocs.gbif.org).
 *  - In-flight de-duplication: identical concurrent GETs share one promise
 *    (the request-coalescing axios-cache-interceptor and TanStack Query do).
 *  - A persistent response cache with a per-endpoint TTL (pyinaturalist's
 *    approach via requests-cache: short TTLs for volatile data, days for
 *    slow-changing reference data like taxa). Stored in the app's SQLite DB.
 *  - Stale-if-error: when the network fails, an expired cached response is
 *    returned instead of nothing, so the app keeps working offline.
 *  - Retries with exponential backoff + jitter on 429/5xx/network errors,
 *    honouring Retry-After, and pausing the whole host on a 429 so queued
 *    requests don't immediately trip it again.
 *  - HTTP keep-alive, so paging through GBIF reuses one TLS connection
 *    instead of a fresh handshake per page.
 *
 * Implemented in-house (~200 lines) rather than as dependencies: p-queue is
 * ESM-only and can't be required from this CommonJS main-process bundle, and
 * Bottleneck, while CommonJS, hasn't had a release in years.
 */

const USER_AGENT = 'BiodiversityExplorer/0.1 (https://github.com/your-username/biodiversity-explorer)'

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 8 })

const client = axios.create({
  httpsAgent: keepAliveAgent,
  headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
})

// ---------------------------------------------------------------------------
// Per-host limiter
// ---------------------------------------------------------------------------

interface HostPolicy {
  maxConcurrent: number
  minTimeMs: number
}

const HOST_POLICIES: Record<string, HostPolicy> = {
  'api.gbif.org': { maxConcurrent: 4, minTimeMs: 50 },
  'en.wikipedia.org': { maxConcurrent: 2, minTimeMs: 100 },
  'commons.wikimedia.org': { maxConcurrent: 2, minTimeMs: 100 },
  'api.iucnredlist.org': { maxConcurrent: 1, minTimeMs: 500 },
  'query.wikidata.org': { maxConcurrent: 1, minTimeMs: 1000 }
}
const DEFAULT_POLICY: HostPolicy = { maxConcurrent: 2, minTimeMs: 200 }

class HostLimiter {
  private running = 0
  private lastStart = 0
  private pausedUntil = 0
  private timer: NodeJS.Timeout | null = null
  private readonly queue: (() => void)[] = []

  constructor(private readonly policy: HostPolicy) {}

  async schedule<T>(task: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      this.queue.push(resolve)
      this.pump()
    })
    try {
      return await task()
    } finally {
      this.running--
      this.pump()
    }
  }

  /** Stop starting new requests to this host for `ms` (used on HTTP 429). */
  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms)
  }

  private pump(): void {
    if (this.timer || this.queue.length === 0 || this.running >= this.policy.maxConcurrent) return
    const now = Date.now()
    const readyAt = Math.max(this.lastStart + this.policy.minTimeMs, this.pausedUntil)
    if (readyAt > now) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.pump()
      }, readyAt - now)
      return
    }
    this.running++
    this.lastStart = now
    this.queue.shift()!()
    this.pump()
  }
}

const limiters = new Map<string, HostLimiter>()
function limiterFor(url: string): HostLimiter {
  const host = new URL(url).host
  let limiter = limiters.get(host)
  if (!limiter) {
    limiter = new HostLimiter(HOST_POLICIES[host] ?? DEFAULT_POLICY)
    limiters.set(host, limiter)
  }
  return limiter
}

// ---------------------------------------------------------------------------
// Response cache (SQLite)
// ---------------------------------------------------------------------------

let cacheDb: Database.Database | null = null
const MAX_CACHE_AGE_MS = 60 * 24 * 60 * 60 * 1000 // hard prune after 60 days

/** Call once at startup, after the DB is open. Creates the table and prunes old rows. */
export function initHttpCache(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS http_cache (
      key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `)
  db.prepare('DELETE FROM http_cache WHERE fetched_at < ?').run(Date.now() - MAX_CACHE_AGE_MS)
  cacheDb = db
}

function readCache(key: string): { body: string; fetchedAt: number } | null {
  if (!cacheDb) return null
  try {
    const row = cacheDb.prepare('SELECT body, fetched_at FROM http_cache WHERE key = ?').get(key) as
      | { body: string; fetched_at: number }
      | undefined
    return row ? { body: row.body, fetchedAt: row.fetched_at } : null
  } catch {
    return null
  }
}

function writeCache(key: string, body: unknown): void {
  if (!cacheDb) return
  try {
    cacheDb
      .prepare(
        `INSERT INTO http_cache (key, body, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at`
      )
      .run(key, JSON.stringify(body), Date.now())
  } catch (err) {
    console.warn('[http] cache write failed (continuing without it):', (err as Error).message)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const TTL = {
  NONE: 0,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000
} as const

export interface GetJsonOptions {
  params?: Record<string, string | number | boolean | undefined>
  /** Cache lifetime. 0 (default) = never cached. */
  ttlMs?: number
  /** Skip a fresh cache hit and go to the network (still writes the result back). */
  forceRefresh?: boolean
  /** On network failure, fall back to an expired cached copy if one exists. Default true when ttlMs > 0. */
  staleIfError?: boolean
  timeoutMs?: number
  headers?: Record<string, string>
  /** Retries after the first attempt, for retryable failures only. Default 3. */
  retries?: number
  /**
   * Shape check for a 200 response. Returning false treats it as a failure:
   * not cached, not retried. Stops error payloads served with HTTP 200 (e.g.
   * MediaWiki's `{ error: ... }`) from being cached for the full TTL.
   */
  validate?: (data: unknown) => boolean
}

export interface JsonResult<T> {
  data: T
  /** 'network' = fetched now; 'cache' = fresh cache hit; 'stale' = expired cache used because the network failed. */
  from: 'network' | 'cache' | 'stale'
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string
  ) {
    super(message)
  }
}

const inflight = new Map<string, Promise<unknown>>()

function cacheKey(url: string, params?: GetJsonOptions['params'], headers?: Record<string, string>): string {
  const p = params
    ? Object.keys(params)
        .filter((k) => params[k] !== undefined)
        .sort()
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
        .join('&')
    : ''
  // Credentialed requests never share a key with anonymous ones.
  const auth = headers?.Authorization ? '|auth' : ''
  return `${url}?${p}${auth}`
}

function isRetryable(err: AxiosError): boolean {
  if (!err.response) return true // timeout, DNS, reset, offline
  const s = err.response.status
  return s === 429 || s >= 500
}

const MAX_BACKOFF_MS = 60_000 // never let one Retry-After stall a whole host for longer than this

function retryAfterMs(err: AxiosError): number | null {
  const header = err.response?.headers?.['retry-after']
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.min(MAX_BACKOFF_MS, seconds * 1000)
  const date = Date.parse(String(header))
  return Number.isFinite(date) ? Math.min(MAX_BACKOFF_MS, Math.max(0, date - Date.now())) : null
}

function backoffFor(err: AxiosError, attempt: number): number {
  return retryAfterMs(err) ?? Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt + Math.random() * 500)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function fetchWithRetry<T>(url: string, opts: GetJsonOptions): Promise<T> {
  const limiter = limiterFor(url)
  const retries = opts.retries ?? 3
  let lastErr: unknown = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    let pausedMs: number | null = null
    try {
      const res = await limiter.schedule(async () => {
        try {
          return await client.get<T>(url, {
            params: opts.params,
            headers: opts.headers,
            timeout: opts.timeoutMs ?? 15000
          })
        } catch (err) {
          // Pause the host BEFORE this slot is released, so the next queued
          // request doesn't start (and trip the limit again) in between.
          if (axios.isAxiosError(err) && err.response?.status === 429) {
            pausedMs = backoffFor(err, attempt)
            limiter.pauseFor(pausedMs)
          }
          throw err
        }
      })
      if (opts.validate && !opts.validate(res.data)) {
        throw new HttpError('unexpected response body', res.status, url)
      }
      return res.data
    } catch (err) {
      lastErr = err
      if (err instanceof HttpError) throw err // invalid body: not retryable
      const axErr = err as AxiosError
      if (!axios.isAxiosError(err) || !isRetryable(axErr) || attempt === retries) break
      const backoff = pausedMs ?? backoffFor(axErr, attempt) // same wait as the host pause, if there was one
      console.warn(
        `[http] ${new URL(url).host} ${axErr.response?.status ?? axErr.code ?? 'error'} — retry ${attempt + 1}/${retries} in ${Math.round(backoff)}ms`
      )
      await sleep(backoff)
    }
  }

  const status = axios.isAxiosError(lastErr) ? (lastErr.response?.status ?? null) : null
  throw new HttpError((lastErr as Error)?.message ?? 'request failed', status, url)
}

/**
 * GET a JSON endpoint through the limiter, de-duplication, cache and retry
 * layers. Throws HttpError on final failure (unless a stale cached copy can
 * be served instead).
 */
export async function getJsonDetailed<T>(url: string, opts: GetJsonOptions = {}): Promise<JsonResult<T>> {
  const ttl = opts.ttlMs ?? 0
  const key = cacheKey(url, opts.params, opts.headers)
  const cachedRow = ttl > 0 ? readCache(key) : null
  let cached: { data: T; fetchedAt: number } | null = null
  if (cachedRow) {
    try {
      const data = JSON.parse(cachedRow.body) as T
      // Rows cached before a validator existed (or by a looser one) must pass it too.
      if (!opts.validate || opts.validate(data)) cached = { data, fetchedAt: cachedRow.fetchedAt }
    } catch {
      cached = null // corrupt entry: ignore it and fetch fresh
    }
  }

  if (cached && !opts.forceRefresh && Date.now() - cached.fetchedAt < ttl) {
    return { data: cached.data, from: 'cache' }
  }

  let pending = inflight.get(key) as Promise<T> | undefined
  if (!pending) {
    pending = fetchWithRetry<T>(url, opts)
      .then((data) => {
        if (ttl > 0) writeCache(key, data) // once per network fetch, not once per waiting caller
        return data
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }

  try {
    const data = await pending
    return { data, from: 'network' }
  } catch (err) {
    const allowStale = opts.staleIfError ?? ttl > 0
    if (allowStale && cached) {
      console.warn(`[http] network failed for ${new URL(url).host}, serving cached copy from ${new Date(cached.fetchedAt).toISOString()}`)
      return { data: cached.data, from: 'stale' }
    }
    throw err
  }
}

export async function getJson<T>(url: string, opts: GetJsonOptions = {}): Promise<T> {
  return (await getJsonDetailed<T>(url, opts)).data
}
