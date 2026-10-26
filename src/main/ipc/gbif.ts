import { getJson, TTL } from '../net/http'

const GBIF_BASE = 'https://api.gbif.org/v1'
const MAX_OCCURRENCES = 5000 // performance guard so the globe stays smooth on modest hardware
const PAGE_SIZE = 300 // GBIF's maximum page size for occurrence search

// All calls go through src/main/net/http.ts: per-host limiting (4 concurrent
// to api.gbif.org), in-flight de-duplication, retry/backoff on 429/5xx,
// keep-alive, and a response cache where the data is slow-changing.

export interface GbifOccurrence {
  latitude: number
  longitude: number
  country: string | null
  year: number | null
  /** GBIF's own interpreted continent enum (AFRICA, NORTH_AMERICA, ...), when present. */
  continent: string | null
}

export interface GbifTaxonMatch {
  taxonKey: number
  name: string
  rank: string
  kingdom: string | null
  phylum: string | null
  className: string | null
  order: string | null
  family: string | null
  genus: string | null
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

const SPECIES_LEVEL_RANKS = new Set(['SPECIES', 'SUBSPECIES', 'VARIETY', 'FORM', 'INFRASPECIFIC_NAME'])

/**
 * Resolves a scientific name to a GBIF Backbone Taxonomy key via
 * /v1/species/match (not /species/search, whose top "relevance" hit is often
 * a subspecies from an obscure checklist with zero occurrences — confirmed
 * with Loxodonta africana). Cached a month: backbone matches rarely change.
 *
 * Returns null when there's no trustworthy species-level match — including
 * HIGHERRANK matches, where GBIF falls back to the genus: accepting those
 * would plot the whole genus's records and show another species' photo.
 * THROWS on network failure, so callers can tell "offline" from "no match".
 */
export async function searchGBIFTaxon(scientificName: string): Promise<GbifTaxonMatch | null> {
  const data = await getJson<any>(`${GBIF_BASE}/species/match`, {
    params: { name: scientificName, strict: false },
    ttlMs: TTL.MONTH
  })
  const matchType: string | undefined = data?.matchType
  const rank: string = data?.rank ?? ''
  const trustworthy =
    !!data?.usageKey &&
    (matchType === 'EXACT' || (matchType === 'FUZZY' && (data.confidence ?? 0) >= 90)) &&
    SPECIES_LEVEL_RANKS.has(rank)
  if (!trustworthy) {
    console.warn(
      `[gbif] species/match: no trustworthy species-level match for "${scientificName}" (matchType=${matchType}, rank=${rank})`
    )
    return null
  }
  return {
    taxonKey: data.usageKey,
    name: data.canonicalName ?? data.scientificName ?? scientificName,
    rank,
    kingdom: data.kingdom ?? null,
    phylum: data.phylum ?? null,
    className: data.class ?? null,
    order: data.order ?? null,
    family: data.family ?? null,
    genus: data.genus ?? null
  }
}

/**
 * Backbone taxon by key — used when the key is already known (Red List
 * results carry it, and synced species store it), so no name matching is
 * needed. Cached a month. Returns null if the key doesn't exist; THROWS on
 * network failure.
 */
export async function getGBIFTaxonByKey(taxonKey: number): Promise<GbifTaxonMatch | null> {
  const data = await getJson<any>(`${GBIF_BASE}/species/${taxonKey}`, { ttlMs: TTL.MONTH })
  if (!data?.key) return null
  return {
    taxonKey: data.key,
    name: data.canonicalName ?? data.scientificName,
    rank: data.rank ?? 'SPECIES',
    kingdom: data.kingdom ?? null,
    phylum: data.phylum ?? null,
    className: data.class ?? null,
    order: data.order ?? null,
    family: data.family ?? null,
    genus: data.genus ?? null
  }
}

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

const OCCURRENCE_FILTER = { hasCoordinate: true, hasGeospatialIssue: false } as const

/**
 * Number of geo-referenced records GBIF holds for a taxon — a single cheap
 * request (limit=0). Lets the weekly sync skip re-downloading species whose
 * record count hasn't changed. Returns null on failure.
 */
export async function countGBIFOccurrences(taxonKey: number): Promise<number | null> {
  try {
    const data = await getJson<any>(`${GBIF_BASE}/occurrence/search`, {
      params: { taxonKey, limit: 0, ...OCCURRENCE_FILTER }
    })
    return typeof data?.count === 'number' ? data.count : null
  } catch {
    return null
  }
}

function toOccurrence(rec: any): GbifOccurrence | null {
  if (typeof rec.decimalLatitude !== 'number' || typeof rec.decimalLongitude !== 'number') return null
  return {
    latitude: rec.decimalLatitude,
    longitude: rec.decimalLongitude,
    country: rec.country ?? rec.countryCode ?? null,
    year: rec.year ?? null,
    continent: typeof rec.continent === 'string' ? rec.continent : null
  }
}

export interface OccurrenceFetch {
  records: GbifOccurrence[]
  /** Total geo-referenced records GBIF holds (may exceed MAX_OCCURRENCES). */
  remoteCount: number
  /** False if any page failed — callers must not replace a stored set with a partial one. */
  complete: boolean
}

/**
 * Up to MAX_OCCURRENCES geo-referenced records for a taxon. The first page
 * tells us the total, then the remaining pages are requested together —
 * the per-host limiter runs them 4 at a time — instead of strictly one after
 * another. Not HTTP-cached: results are stored in the occurrences table.
 * Returns null if the first page fails (e.g. offline), so callers never
 * mistake "couldn't fetch" for "no records".
 */
export async function fetchGBIFOccurrences(taxonKey: number): Promise<OccurrenceFetch | null> {
  const url = `${GBIF_BASE}/occurrence/search`
  try {
    const first = await getJson<any>(url, { params: { taxonKey, limit: PAGE_SIZE, offset: 0, ...OCCURRENCE_FILTER } })
    if (typeof first?.count !== 'number') return null
    const occurrences: GbifOccurrence[] = []
    for (const r of first.results ?? []) {
      const o = toOccurrence(r)
      if (o) occurrences.push(o)
    }

    const total = Math.min(first.count, MAX_OCCURRENCES)
    const offsets: number[] = []
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset)

    const pages = await Promise.allSettled(
      offsets.map((offset) =>
        getJson<any>(url, {
          params: { taxonKey, limit: Math.min(PAGE_SIZE, total - offset), offset, ...OCCURRENCE_FILTER }
        })
      )
    )
    let failed = 0
    for (const p of pages) {
      if (p.status === 'rejected') {
        failed++
        continue
      }
      for (const r of p.value?.results ?? []) {
        const o = toOccurrence(r)
        if (o) occurrences.push(o)
      }
    }

    console.log(
      `[gbif] occurrences taxonKey ${taxonKey}: ${occurrences.length} of ${first.count} ` +
        `(${offsets.length + 1} pages${failed ? `, ${failed} failed` : ''})`
    )
    return { records: occurrences.slice(0, MAX_OCCURRENCES), remoteCount: first.count, complete: failed === 0 }
  } catch (err) {
    console.error(`[gbif] fetchGBIFOccurrences failed for taxonKey ${taxonKey}:`, (err as Error).message)
    return null
  }
}

// GBIF's Continent enum -> the display names used everywhere in the app
// (src/renderer/constants.ts CONTINENTS), so enriched species also match the
// Continent filter.
const GBIF_CONTINENT_NAMES: Record<string, string> = {
  AFRICA: 'Africa',
  ANTARCTICA: 'Antarctica',
  ASIA: 'Asia',
  EUROPE: 'Europe',
  NORTH_AMERICA: 'North America',
  OCEANIA: 'Oceania',
  SOUTH_AMERICA: 'South America'
}

/**
 * Continents a species has been recorded on, from occurrences already
 * fetched — no extra request. A continent counts only if it holds at least
 * max(2, 1%) of records, so one stray/mis-georeferenced record doesn't add a
 * continent. This is where it has been OBSERVED (including introduced
 * populations), not a curated native range.
 */
export function continentsFromOccurrences(occurrences: GbifOccurrence[]): string[] {
  const counts = new Map<string, number>()
  for (const o of occurrences) {
    const name = o.continent ? GBIF_CONTINENT_NAMES[o.continent] : undefined
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const threshold = Math.max(2, Math.ceil(occurrences.length * 0.01))
  return Object.values(GBIF_CONTINENT_NAMES).filter((name) => (counts.get(name) ?? 0) >= threshold)
}

/**
 * Habitat classification from GBIF species profiles (/species/{key}/speciesProfiles),
 * contributed by checklists such as GRIIS and the Paleobiology Database —
 * e.g. "Terrestrial", "Marine", "Freshwater". Coverage is inconsistent; []
 * when nothing is profiled. Cached a month. Never throws.
 */
export async function fetchGBIFHabitats(taxonKey: number): Promise<string[]> {
  try {
    const data = await getJson<any>(`${GBIF_BASE}/species/${taxonKey}/speciesProfiles`, {
      params: { limit: 100 },
      ttlMs: TTL.MONTH
    })
    const found = new Set<string>()
    for (const p of data?.results ?? []) {
      if (typeof p?.habitat === 'string' && p.habitat.trim()) {
        for (const part of p.habitat.split(/[,;/]/)) {
          const t = part.trim().toLowerCase()
          if (t) found.add(t.charAt(0).toUpperCase() + t.slice(1))
        }
      }
      if (p?.marine === true) found.add('Marine')
      if (p?.freshwater === true) found.add('Freshwater')
      if (p?.terrestrial === true) found.add('Terrestrial')
    }
    return [...found].sort()
  } catch (err) {
    console.error(`[gbif] speciesProfiles failed for taxonKey ${taxonKey}:`, (err as Error).message)
    return []
  }
}

// ---------------------------------------------------------------------------
// Media (see src/main/services/speciesImage.ts for how these are ranked)
// ---------------------------------------------------------------------------

export interface GbifMediaCandidate {
  url: string
  /** Publisher's own title/description — how a catalogue-ledger scan is told apart from a specimen photo. */
  title: string | null
  description: string | null
  license: string | null
  creator: string | null
  rightsHolder: string | null
  references: string | null
  basisOfRecord: string
  /** GBIF occurrence key — the record page is a stable provenance link when the publisher gives none. */
  occurrenceKey: number | null
  datasetKey: string | null
  datasetName: string | null
  institutionCode: string | null
}

/** iNaturalist Research-grade Observations (published to GBIF by iNaturalist.org). */
export const INAT_RESEARCH_GRADE_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7'

/**
 * Still images attached to occurrence records of a taxon. `extra` narrows the
 * search (e.g. to iNaturalist research-grade, or to preserved specimens).
 * Cached a month. Returns [] when there genuinely are none, and null when the
 * request failed — so an offline lookup is never recorded as "no image".
 */
export async function fetchGBIFMedia(
  taxonKey: number,
  extra: Record<string, string>,
  limit = 20
): Promise<GbifMediaCandidate[] | null> {
  try {
    const data = await getJson<any>(`${GBIF_BASE}/occurrence/search`, {
      params: { taxonKey, mediaType: 'StillImage', limit, ...extra },
      ttlMs: TTL.MONTH
    })
    const out: GbifMediaCandidate[] = []
    for (const rec of data?.results ?? []) {
      for (const m of rec?.media ?? []) {
        if (m?.type !== 'StillImage' || typeof m?.identifier !== 'string') continue
        out.push({
          url: m.identifier,
          title: typeof m.title === 'string' ? m.title : null,
          description: typeof m.description === 'string' ? m.description : null,
          license: m.license ?? rec.license ?? null,
          creator: m.creator ?? rec.recordedBy ?? null,
          rightsHolder: m.rightsHolder ?? null,
          references: m.references ?? rec.references ?? null,
          basisOfRecord: rec.basisOfRecord ?? 'UNKNOWN',
          occurrenceKey: typeof rec.key === 'number' ? rec.key : null,
          datasetKey: rec.datasetKey ?? null,
          datasetName: rec.datasetName ?? null,
          institutionCode: rec.institutionCode ?? null
        })
      }
    }
    return out
  } catch (err) {
    console.error(`[gbif] media search failed for taxonKey ${taxonKey}:`, (err as Error).message)
    return null
  }
}
