import type { ConservationStatus } from '../utils/conservationStatus'
import { getJson, getJsonDetailed, TTL } from '../net/http'

/**
 * Red List data via GBIF's copy of "The IUCN Red List of Threatened Species"
 * checklist — published to GBIF by IUCN itself
 * (dataset 19491596-35ae-4a91-9a98-85cf505f1bd3, api.gbif.org/v1/dataset/...).
 *
 * Replaces the earlier Wikidata SPARQL source for browsing and for
 * per-species status, which in practice:
 *  - timed out server-side (WDQS's 60 s limit) for large statuses —
 *    Least Concern never loaded at all;
 *  - returned 429 for per-species lookups under normal use;
 *  - is a secondary copy of IUCN data; this is IUCN's own export.
 *
 * Verified against the live API (2026-09-30): filtering by this dataset +
 * threat + the dataset's own Animalia kingdom key returns animals only
 * (Extinct in the Wild: 36; Least Concern: 54,433), with true totals,
 * English vernacular names, and each taxon's GBIF backbone key (`nubKey`) —
 * which saves the separate name-matching request when a species is opened.
 *
 * Important: threat must be scoped to THIS dataset. GBIF's unscoped
 * `threat=` filter merges statuses from every checklist it holds, including
 * national/regional red lists — so "EXTINCT" would include species that are
 * only regionally extinct (seen live: Arhopalus ferus listed EN, CR, LC and
 * EXTINCT at once).
 */

export const IUCN_DATASET_KEY = '19491596-35ae-4a91-9a98-85cf505f1bd3'
const GBIF_SPECIES_SEARCH = 'https://api.gbif.org/v1/species/search'
// The Animalia record's key inside the IUCN dataset, as of 2026-09-30. Used
// only if the live lookup below fails; dataset-internal keys can change when
// a checklist is re-indexed, so it's looked up rather than trusted blindly.
const FALLBACK_ANIMALIA_KEY = 338349302

export interface RedListTaxon {
  scientificName: string
  commonName: string | null
  /** GBIF backbone taxon key, when known — lets ensureSpecies skip /species/match. */
  gbifKey?: number | null
}

const STATUS_TO_THREAT: Record<ConservationStatus, string> = {
  EXTINCT: 'EXTINCT',
  EXTINCT_IN_WILD: 'EXTINCT_IN_THE_WILD',
  CRITICALLY_ENDANGERED: 'CRITICALLY_ENDANGERED',
  ENDANGERED: 'ENDANGERED',
  VULNERABLE: 'VULNERABLE',
  NEAR_THREATENED: 'NEAR_THREATENED',
  LEAST_CONCERN: 'LEAST_CONCERN',
  DATA_DEFICIENT: 'DATA_DEFICIENT'
}

const THREAT_TO_STATUS: Record<string, ConservationStatus> = Object.fromEntries(
  Object.entries(STATUS_TO_THREAT).map(([status, threat]) => [threat, status as ConservationStatus])
)

interface GbifVernacular {
  vernacularName?: string
  language?: string
}

interface GbifSearchResult {
  key: number
  nubKey?: number
  scientificName?: string
  canonicalName?: string
  rank?: string
  threatStatuses?: string[]
  vernacularNames?: GbifVernacular[]
}

interface GbifSearchResponse {
  offset: number
  limit: number
  endOfRecords: boolean
  count: number
  results: GbifSearchResult[]
}

let animaliaKeyPromise: Promise<number> | null = null

function animaliaKey(): Promise<number> {
  if (!animaliaKeyPromise) {
    animaliaKeyPromise = getJson<GbifSearchResponse>(GBIF_SPECIES_SEARCH, {
      params: { datasetKey: IUCN_DATASET_KEY, rank: 'KINGDOM', limit: 20 },
      ttlMs: TTL.MONTH
    })
      .then((r) => {
        const hit = r.results.find((k) => (k.canonicalName ?? k.scientificName ?? '').toUpperCase() === 'ANIMALIA')
        return hit?.key ?? FALLBACK_ANIMALIA_KEY
      })
      .catch(() => {
        animaliaKeyPromise = null // allow a retry later
        return FALLBACK_ANIMALIA_KEY
      })
  }
  return animaliaKeyPromise
}

function englishName(names: GbifVernacular[] | undefined): string | null {
  const eng = names?.find((n) => n.language === 'eng' && n.vernacularName?.trim())
  return eng?.vernacularName?.trim() ?? null
}

function toTaxon(r: GbifSearchResult): RedListTaxon | null {
  const name = (r.canonicalName ?? r.scientificName ?? '').trim()
  if (!name) return null
  return { scientificName: name, commonName: englishName(r.vernacularNames), gbifKey: r.nubKey ?? null }
}

export interface IucnPage {
  taxa: RedListTaxon[]
  totalCount: number
  endOfRecords: boolean
  /** offset + raw rows returned (before dropping nameless rows), so paging never drifts. */
  nextOffset: number
  /** Where the page came from — surfaced in the UI so "instant" isn't mistaken for "live". */
  from: 'network' | 'cache' | 'stale'
}

/**
 * One page of animal species IUCN lists under `status`. Cached for a week
 * (Red List updates are published a couple of times a year); `forceRefresh`
 * bypasses that for an explicit Refresh. Throws if the network fails and
 * nothing is cached.
 */
export async function fetchIucnPage(
  status: ConservationStatus,
  offset: number,
  limit: number,
  forceRefresh = false
): Promise<IucnPage> {
  const kingdom = await animaliaKey()
  const res = await getJsonDetailed<GbifSearchResponse>(GBIF_SPECIES_SEARCH, {
    params: {
      datasetKey: IUCN_DATASET_KEY,
      threat: STATUS_TO_THREAT[status],
      highertaxonKey: kingdom,
      rank: 'SPECIES',
      limit,
      offset
    },
    ttlMs: TTL.WEEK,
    forceRefresh,
    validate: (d: any) => !!d && Array.isArray(d.results) && typeof d.count === 'number'
  })
  return {
    taxa: res.data.results.map(toTaxon).filter((t): t is RedListTaxon => t !== null),
    totalCount: res.data.count,
    endOfRecords: res.data.endOfRecords,
    nextOffset: offset + res.data.results.length,
    from: res.from
  }
}

/**
 * IUCN status for one species, from the same checklist. Returns null (never
 * throws) if the species isn't in the Red List or the lookup fails — callers
 * keep whatever status they already had.
 */
export async function lookupIucnStatus(scientificName: string): Promise<ConservationStatus | null> {
  const wanted = scientificName.trim().toLowerCase()
  if (!wanted) return null
  try {
    const res = await getJson<GbifSearchResponse>(GBIF_SPECIES_SEARCH, {
      params: { datasetKey: IUCN_DATASET_KEY, q: scientificName, rank: 'SPECIES', limit: 10 },
      ttlMs: TTL.WEEK,
      validate: (d: any) => !!d && Array.isArray(d.results)
    })
    const exact = res.results.find((r) => (r.canonicalName ?? '').toLowerCase() === wanted)
    for (const threat of exact?.threatStatuses ?? []) {
      const status = THREAT_TO_STATUS[threat]
      if (status) return status
    }
    return null
  } catch (err) {
    console.warn(`[iucnChecklist] status lookup failed for "${scientificName}":`, (err as Error).message)
    return null
  }
}
