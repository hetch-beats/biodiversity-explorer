import type Database from 'better-sqlite3'
import type { ConservationStatus } from '../utils/conservationStatus'
import { fetchIucnPage, type RedListTaxon } from '../ipc/iucnChecklist'
import { rememberTaxa } from './redListCache'
import { BUNDLED_REDLIST_DATA } from '../data/redlist'

const KNOWN_STATUSES = new Set(Object.keys(BUNDLED_REDLIST_DATA))
const MAX_PAGE = 200

export interface RedListBrowseResult {
  taxa: RedListTaxon[]
  totalCount: number | null
  offset: number
  nextOffset: number
  endOfRecords: boolean
  /** live = fetched now; cache = local copy < 1 week old; stale/bundled = offline fallbacks. */
  source: 'live' | 'cache' | 'stale' | 'bundled'
  /** Set when this page couldn't be loaded, so the UI can say why instead of "no species". */
  error: string | null
}

function bundledPage(status: ConservationStatus, offset: number, limit: number): RedListBrowseResult {
  const bundled = BUNDLED_REDLIST_DATA[status]
  const slice = bundled.taxa.slice(offset, offset + limit)
  return {
    taxa: slice,
    totalCount: bundled.totalCount,
    offset,
    nextOffset: offset + slice.length,
    endOfRecords: offset + slice.length >= bundled.taxa.length,
    source: 'bundled',
    error: null
  }
}

/**
 * One page of IUCN Red List animal species for `status`, from IUCN's own
 * checklist on GBIF (src/main/ipc/iucnChecklist.ts).
 *
 * Order of preference:
 *  1. The network (or the week-long HTTP cache in front of it).
 *  2. An expired cached copy, if the network is down (net/http.ts).
 *  3. The bundled snapshot committed to the repo — only for a fresh first
 *     page, or when the caller is already paging through the bundled list
 *     (`fromBundled`). Never mixed into a live list mid-way: the two are
 *     ordered differently, so rows would be skipped or repeated.
 */
export async function browseRedList(
  db: Database.Database,
  status: ConservationStatus,
  offset: number,
  limit: number,
  forceRefresh = false,
  fromBundled = false
): Promise<RedListBrowseResult> {
  const pageSize = Math.min(Math.max(limit, 1), MAX_PAGE)
  const safeOffset = Math.max(0, offset)
  if (!KNOWN_STATUSES.has(status)) {
    console.error(`[redListBrowse] unknown conservation status "${status}"`)
    return { taxa: [], totalCount: null, offset: safeOffset, nextOffset: safeOffset, endOfRecords: true, source: 'live', error: 'Unknown status.' }
  }
  if (fromBundled) return bundledPage(status, safeOffset, pageSize)

  try {
    const page = await fetchIucnPage(status, safeOffset, pageSize, forceRefresh)
    rememberTaxa(db, status, page.taxa)
    return {
      taxa: page.taxa,
      totalCount: page.totalCount,
      offset: safeOffset,
      nextOffset: page.nextOffset,
      endOfRecords: page.endOfRecords,
      source: page.from === 'network' ? 'live' : page.from,
      error: null
    }
  } catch (err) {
    console.error(`[redListBrowse] ${status} offset ${safeOffset} failed:`, (err as Error).message)
    if (safeOffset === 0) {
      const fallback = bundledPage(status, 0, pageSize)
      if (fallback.taxa.length > 0) return fallback
    }
    return {
      taxa: [],
      totalCount: null,
      offset: safeOffset,
      nextOffset: safeOffset,
      endOfRecords: false,
      source: 'live',
      error:
        safeOffset === 0
          ? "Couldn't reach GBIF, and there's no saved copy of this list yet. Check your connection and try again."
          : "Couldn't load more — check your connection and try again."
    }
  }
}
