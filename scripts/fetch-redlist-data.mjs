// Refreshes the bundled Red List snapshot in src/main/data/redlist/*.json —
// the first LIMIT_PER_STATUS animal species per IUCN category, committed to
// the repo so a fresh install can show and search something before (or
// without) network access. At runtime the app always prefers live data
// (src/main/services/redListBrowse.ts); this is only the offline seed.
//
//   npm run fetch-redlist
//
// Source: "The IUCN Red List of Threatened Species" checklist, published to
// GBIF by IUCN (dataset 19491596-35ae-4a91-9a98-85cf505f1bd3), filtered to
// that dataset's Animalia kingdom — the same query src/main/ipc/iucnChecklist.ts
// makes. Replaces the old Wikidata SPARQL version of this script, which timed
// out for most categories and (in older snapshots) let plants through.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dns from 'node:dns'

// See src/main/index.ts: avoid Node stalling on a broken IPv6 route.
dns.setDefaultResultOrder('ipv4first')

const __dirname = dirname(fileURLToPath(import.meta.url))
const destDir = join(__dirname, '..', 'src', 'main', 'data', 'redlist')

const GBIF_SPECIES_SEARCH = 'https://api.gbif.org/v1/species/search'
const IUCN_DATASET_KEY = '19491596-35ae-4a91-9a98-85cf505f1bd3'
const FALLBACK_ANIMALIA_KEY = 338349302
const USER_AGENT = 'BiodiversityExplorer/0.1 (https://github.com/your-username/biodiversity-explorer)'
const LIMIT_PER_STATUS = 500
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 20000
const MAX_RETRIES = 3

// App status id -> GBIF threat enum. Keep in sync with iucnChecklist.ts.
const STATUS_TO_THREAT = {
  EXTINCT: 'EXTINCT',
  EXTINCT_IN_WILD: 'EXTINCT_IN_THE_WILD',
  CRITICALLY_ENDANGERED: 'CRITICALLY_ENDANGERED',
  ENDANGERED: 'ENDANGERED',
  VULNERABLE: 'VULNERABLE',
  NEAR_THREATENED: 'NEAR_THREATENED',
  LEAST_CONCERN: 'LEAST_CONCERN',
  DATA_DEFICIENT: 'DATA_DEFICIENT'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(params) {
  const url = `${GBIF_SPECIES_SEARCH}?${new URLSearchParams(params)}`
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal })
      if (res.ok) return await res.json()
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt >= MAX_RETRIES) throw new Error(`HTTP ${res.status}`)
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt)
    } catch (err) {
      if (attempt >= MAX_RETRIES || (err instanceof Error && /^HTTP 4/.test(err.message))) throw err
      await sleep(1000 * 2 ** attempt)
    } finally {
      clearTimeout(timer)
    }
  }
}

async function animaliaKey() {
  try {
    const r = await getJson({ datasetKey: IUCN_DATASET_KEY, rank: 'KINGDOM', limit: 20 })
    const hit = r.results.find((k) => (k.canonicalName ?? k.scientificName ?? '').toUpperCase() === 'ANIMALIA')
    return hit?.key ?? FALLBACK_ANIMALIA_KEY
  } catch {
    return FALLBACK_ANIMALIA_KEY
  }
}

function toTaxon(r) {
  const scientificName = (r.canonicalName ?? r.scientificName ?? '').trim()
  if (!scientificName) return null
  const eng = (r.vernacularNames ?? []).find((n) => n.language === 'eng' && n.vernacularName?.trim())
  return { scientificName, commonName: eng?.vernacularName.trim() ?? null, gbifKey: r.nubKey ?? null }
}

async function fetchStatus(status, kingdom) {
  const taxa = []
  let totalCount = null
  for (let offset = 0; offset < LIMIT_PER_STATUS; offset += PAGE_SIZE) {
    const page = await getJson({
      datasetKey: IUCN_DATASET_KEY,
      threat: STATUS_TO_THREAT[status],
      highertaxonKey: kingdom,
      rank: 'SPECIES',
      limit: Math.min(PAGE_SIZE, LIMIT_PER_STATUS - offset),
      offset
    })
    totalCount = page.count
    for (const r of page.results) {
      const t = toTaxon(r)
      if (t) taxa.push(t)
    }
    if (page.endOfRecords) break
  }
  return { status, totalCount, fetchedAt: new Date().toISOString(), source: 'IUCN Red List via GBIF', taxa }
}

async function main() {
  const kingdom = await animaliaKey()
  const statuses = Object.keys(STATUS_TO_THREAT)
  console.log(`[fetch-redlist] IUCN Red List via GBIF — ${statuses.length} categories (Animalia key ${kingdom})`)
  let failures = 0
  for (const [i, status] of statuses.entries()) {
    process.stdout.write(`[fetch-redlist] (${i + 1}/${statuses.length}) ${status}… `)
    try {
      const result = await fetchStatus(status, kingdom)
      writeFileSync(join(destDir, `${status}.json`), JSON.stringify(result, null, 2) + '\n')
      console.log(`${result.taxa.length} of ${result.totalCount ?? '?'} animal species`)
    } catch (err) {
      failures++
      console.log(`FAILED (${err instanceof Error ? err.message : err}) — existing file left untouched`)
    }
  }
  console.log(failures ? `[fetch-redlist] done with ${failures} failure(s).` : '[fetch-redlist] done — review the diff under src/main/data/redlist/.')
}

main()
