import {
  fetchGBIFMedia,
  INAT_RESEARCH_GRADE_DATASET,
  type GbifMediaCandidate
} from '../ipc/gbif'
import { getJson, TTL } from '../net/http'

export type ImageKind = 'photo' | 'specimen' | 'fossil' | 'illustration' | 'image'

export interface SpeciesImage {
  url: string
  kind: ImageKind
  credit: string | null
  license: string
  source: string
  sourceUrl: string | null
}

/**
 * Picks one image for a species from trusted, attributable sources — never
 * whatever happens to be a Wikipedia article's lead image (which is often a
 * range map, an old plate, or a fossil, with no credit shown). Tiers, first
 * hit wins:
 *
 *  1. Photo — iNaturalist Research-grade observation, via GBIF. Research
 *     grade = community-confirmed ID of a wild organism; iNaturalist has an
 *     "Artificially Generated Content" flag that replaces flagged media and
 *     drops the observation out of research grade
 *     (inaturalist.org/blog/118284).
 *  2. Photo — any other human-observation dataset on GBIF (institutional
 *     and citizen-science publishers registered with GBIF).
 *  3. Museum specimen / fossil — preserved-specimen or fossil records on
 *     GBIF (natural-history collections). The honest image for most extinct
 *     species.
 *  4. Wikimedia Commons file used as the Wikipedia lead image — only after
 *     checking its Commons metadata: maps/diagrams and anything categorised
 *     as AI-generated are rejected, and the rest is labeled by what it is
 *     (illustration, specimen, fossil, photo).
 *  5. Nothing → the UI shows a themed taxon-group card instead.
 *
 * Every accepted image must carry a recognisable open license; "all rights
 * reserved" or unlabeled media are skipped.
 *
 * `complete` is false if any lookup FAILED (as opposed to finding nothing).
 * The resolver then stops rather than settling for a lower tier — a failed
 * photo lookup must not be mistaken for "no photo exists" — and the caller
 * leaves the species unresolved so it's retried later.
 */
export interface ImageResolution {
  image: SpeciesImage | null
  complete: boolean
}

const GBIF_TIERS: { params: Record<string, string>; kind: ImageKind; limit: number }[] = [
  { params: { datasetKey: INAT_RESEARCH_GRADE_DATASET }, kind: 'photo', limit: 10 },
  { params: { basisOfRecord: 'HUMAN_OBSERVATION' }, kind: 'photo', limit: 10 },
  // Collections attach many non-specimen images (ledger scans, labels), so look further.
  { params: { basisOfRecord: 'PRESERVED_SPECIMEN' }, kind: 'specimen', limit: 30 },
  { params: { basisOfRecord: 'FOSSIL_SPECIMEN' }, kind: 'fossil', limit: 30 }
]

/**
 * Media that document a specimen rather than depict the animal. Natural-
 * history collections attach these to occurrence records alongside (or
 * instead of) specimen photos. Patterns taken from real GBIF media titles,
 * e.g. NHM London "Zoology Accessions Register: Aves (Skins): 1892-1896:
 * page 37" and Smithsonian "Catalog vol.086_…" / "Page scan of Main Catalog
 * Series…". Also excludes labels, field notes, correspondence and imaging
 * that isn't a picture of the animal (X-ray, CT).
 */
const DOCUMENT_MEDIA =
  /\b(registers?|ledgers?|accessions?|catalog(ue)?s?\s+(vol|page|series|card)|page\s*scans?|page\s+\d+|notebooks?|field\s*notes?|field\s*books?|journals?|diar(y|ies)|index\s*cards?|catalog(ue)?\s*cards?|labels?|correspondence|letters?|manuscripts?|archives?|x-?rays?|radiographs?|ct[\s-]*scans?|micro-?ct|maps?)\b/i

const DEPICTS_ANIMAL = /\b(specimens?|skins?|mounts?|mounted|taxiderm\w*|skeletons?|skulls?|holotype|paratype|syntype|habitus|dorsal|ventral|lateral)\b/i

/**
 * 0 = reject (a document, not the animal); otherwise higher is better:
 * 3 = title/description names the species or says it's a specimen view,
 * 2 = untitled (typical of camera uploads; most real specimen photos too),
 * 1 = titled, no signal either way.
 */
function mediaScore(c: GbifMediaCandidate, scientificName: string): number {
  const text = `${c.title ?? ''} ${c.description ?? ''}`.trim()
  if (!text) return 2
  if (DOCUMENT_MEDIA.test(text)) return 0
  const [genus, epithet] = scientificName.toLowerCase().split(/\s+/)
  const lower = text.toLowerCase()
  if ((genus && epithet && lower.includes(genus) && lower.includes(epithet)) || DEPICTS_ANIMAL.test(text)) return 3
  return 1
}

export async function resolveSpeciesImage(
  taxonKey: number | null,
  scientificName: string,
  wikipediaPageImageFile: string | null
): Promise<ImageResolution> {
  if (taxonKey) {
    for (const tier of GBIF_TIERS) {
      const candidates = await fetchGBIFMedia(taxonKey, tier.params, tier.limit)
      if (candidates === null) return { image: null, complete: false }
      const usable = candidates
        .map((c) => ({ c, license: normalizeLicense(c.license), score: mediaScore(c, scientificName) }))
        .filter((x) => x.license && x.score > 0 && isHttpUrl(x.c.url))
        .sort((a, b) => b.score - a.score) // stable: ties keep GBIF's order
      const best = usable[0]
      if (!best) continue
      const c = best.c
      return {
        image: {
          url: preferredSize(c.url),
          kind: tier.kind,
          credit: cleanText(c.creator) ?? cleanText(c.rightsHolder),
          license: best.license!,
          source: gbifSourceLabel(c),
          sourceUrl: isHttpUrl(c.references)
            ? c.references
            : c.occurrenceKey
              ? `https://www.gbif.org/occurrence/${c.occurrenceKey}`
              : null
        },
        complete: true
      }
    }
  }

  if (wikipediaPageImageFile) {
    const commons = await commonsImage(wikipediaPageImageFile)
    if (commons === 'error') return { image: null, complete: false }
    if (commons) return { image: commons, complete: true }
  }
  return { image: null, complete: true }
}

// ---------------------------------------------------------------------------

function isHttpUrl(u: string | null | undefined): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u)
}

function cleanText(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return t || null
}

/**
 * iNaturalist's open-data bucket serves square/small/medium/large/original
 * variants of each photo; GBIF links the original (often several MB). The
 * species header is ~400px wide, so "large" (1024px) is plenty on HiDPI.
 */
function preferredSize(url: string): string {
  if (/inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org/.test(url)) {
    return url.replace(/\/original\.(jpe?g|png)(\?.*)?$/i, '/large.$1')
  }
  return url
}

function gbifSourceLabel(c: GbifMediaCandidate): string {
  if (c.datasetKey === INAT_RESEARCH_GRADE_DATASET) return 'iNaturalist (research grade) via GBIF'
  const who = c.datasetName ?? c.institutionCode
  return who ? `${who} via GBIF` : 'GBIF'
}

/**
 * Turns the many ways datasets spell licenses ("http://creativecommons.org/
 * licenses/by-nc/4.0/legalcode", "CC_BY_NC_4_0", "cc-by-nc", "CC0 1.0") into
 * a short label, or null if it isn't a recognisable open license.
 */
export function normalizeLicense(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.toLowerCase()
  if (/all rights reserved|copyright|non-?free|fair use/.test(s) && !/creativecommons|cc[-_ ]?by|cc0/.test(s)) return null
  if (/publicdomain\/zero|cc0|cc[-_ ]?zero/.test(s)) return 'CC0'
  if (/publicdomain\/mark|public domain|\bpd\b/.test(s)) return 'Public domain'
  // Spelled-out form: "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International"
  if (/creative commons attribution/.test(s)) {
    const parts = ['BY']
    if (/non[- ]?commercial/.test(s)) parts.push('NC')
    if (/no[- ]?deriv/.test(s)) parts.push('ND')
    if (/share[- ]?alike/.test(s)) parts.push('SA')
    const v = s.match(/\b(\d\.\d)\b/)
    return `CC ${parts.join('-')}${v ? ` ${v[1]}` : ''}`
  }
  const m = s.match(/(?:licenses\/|cc[-_ ]?)(by(?:[-_ ]?(?:nc|sa|nd))*)(?:[\/_ -]?(\d(?:[._]\d)?))?/)
  if (!m) return null
  const parts = m[1]
    .split(/[-_ ]/)
    .filter(Boolean)
    .map((p) => p.toUpperCase())
  const version = m[2] ? ` ${m[2].replace('_', '.')}` : ''
  return `CC ${parts.join('-')}${version}`
}

// --- Wikimedia Commons (last resort, labeled) -------------------------------

const REJECT_AS_NOT_A_PICTURE_OF_THE_ANIMAL = /\b(maps?|range|distribution|locator|occurrence|diagram|chart|cladogram|phylogen\w*)\b/i
const REJECT_AS_AI = /\b(ai[- ]generated|generated (by|with) ai|artificial[- ]intelligence|midjourney|stable diffusion|dall[- ]?e|generative ai)\b/i

function classifyCommons(text: string): ImageKind {
  if (/\b(fossils?|subfossil|petrified)\b/i.test(text)) return 'fossil'
  if (/\b(specimens?|museum|holotype|paratype|taxiderm\w*|mounted|skeletons?|skulls?|preserved|natural history collection)\b/i.test(text)) return 'specimen'
  if (/\b(illustrations?|drawings?|paintings?|plates?|lithographs?|engravings?|watercolou?rs?|sketch(es)?|artwork|chromolithographs?)\b/i.test(text)) return 'illustration'
  if (/\b(photographs?|photos?)\b/i.test(text)) return 'photo'
  return 'image'
}

// Licenses Commons accepts that aren't Creative Commons (normalizeLicense handles CC/PD).
const OTHER_FREE_LICENSES = /^(gfdl|fal|free art license|attribution|copyrighted free use|no restrictions)\b/i

/** A vetted Commons image, null if the file is rejected/absent, or 'error' if the lookup failed. */
async function commonsImage(fileName: string): Promise<SpeciesImage | null | 'error'> {
  try {
    const data = await getJson<any>('https://commons.wikimedia.org/w/api.php', {
      params: {
        action: 'query',
        format: 'json',
        formatversion: 2,
        titles: `File:${fileName}`,
        prop: 'imageinfo',
        iiprop: 'url|extmetadata|mime',
        iiurlwidth: 1024
      },
      ttlMs: TTL.MONTH,
      timeoutMs: 8000,
      validate: (d: any) => !!d && typeof d === 'object' && !d.error
    })
    const info = data?.query?.pages?.[0]?.imageinfo?.[0]
    if (!info) return null
    const meta = info.extmetadata ?? {}
    const categories: string = meta.Categories?.value ?? ''
    const description = cleanText(meta.ImageDescription?.value) ?? ''
    const haystack = `${fileName} ${categories} ${description}`

    if (info.mime === 'image/svg+xml') return null // vector files here are almost always maps/diagrams
    if (REJECT_AS_AI.test(haystack)) return null
    if (REJECT_AS_NOT_A_PICTURE_OF_THE_ANIMAL.test(`${fileName} ${categories}`)) return null

    const rawLicense = cleanText(meta.LicenseShortName?.value)
    const license =
      normalizeLicense(rawLicense) ?? (rawLicense && OTHER_FREE_LICENSES.test(rawLicense) ? rawLicense : null)
    if (!license) return null

    const url = info.thumburl ?? info.url
    if (!isHttpUrl(url)) return null

    return {
      url,
      kind: classifyCommons(haystack),
      credit: cleanText(meta.Artist?.value) ?? cleanText(meta.Credit?.value),
      license,
      source: 'Wikimedia Commons',
      sourceUrl: isHttpUrl(info.descriptionurl) ? info.descriptionurl : null
    }
  } catch (err) {
    console.error(`[speciesImage] Commons lookup failed for "${fileName}":`, (err as Error).message)
    return 'error'
  }
}
