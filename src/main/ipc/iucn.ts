import axios from 'axios'
import { mapIucnCategoryCode, type ConservationStatus } from '../utils/conservationStatus'

const IUCN_API_BASE = 'https://api.iucnredlist.org/api/v4'
const REQUEST_TIMEOUT_MS = 8000

// Same placeholder pattern as gbif.ts / wikipedia.ts.
const USER_AGENT = 'BiodiversityExplorer/0.1 (https://github.com/your-username/biodiversity-explorer)'

export type IucnLookupResult =
  | { ok: true; status: ConservationStatus | null; categoryCode: string | null }
  | { ok: false; reason: 'no-token' | 'invalid-token' | 'not-found' | 'error'; message: string }

/**
 * Optional, authoritative conservation-status source: the real IUCN Red
 * List API (v4), gated on a token the user registers and pastes into
 * Settings themselves (see SettingsPanel.tsx). This can't ship with a
 * built-in shared token — the IUCN API's terms of use are non-commercial
 * and tied to the registrant, and a token committed to this open-source
 * repo would be both publicly extractable and rate-limited across every
 * install at once. Bring-your-own-token is the only pattern that works for
 * a published, multi-user app; IUCN's checklist on GBIF
 * (src/main/ipc/iucnChecklist.ts) is the keyless default everyone gets.
 *
 * Endpoint/response shape confirmed against IUCN's own OpenAPI spec
 * (https://api.iucnredlist.org/api-docs/v4/openapi.yaml) and cross-checked
 * against two independent third-party clients built on the same v4 API
 * (the Python `iucn-redlist-api` CLI's docs, and ToolUniverse's IUCN tool
 * source) — both agree on GET /api/v4/taxa/scientific_name with
 * genus_name/species_name params, an `Authorization: Bearer <token>`
 * header, and a response `assessments[]` array where each entry carries
 * `latest` (boolean) and `red_list_category_code`.
 */
export async function fetchIucnConservationStatus(
  scientificName: string,
  token: string | null | undefined
): Promise<IucnLookupResult> {
  if (!token) return { ok: false, reason: 'no-token', message: 'No IUCN API token configured.' }

  const parts = scientificName.trim().split(/\s+/)
  const genusName = parts[0]
  const speciesName = parts[1]
  if (!genusName || !speciesName) {
    return {
      ok: false,
      reason: 'error',
      message: `"${scientificName}" isn't a binomial name (genus + species) — can't query the IUCN API.`
    }
  }

  try {
    const { data } = await axios.get(`${IUCN_API_BASE}/taxa/scientific_name`, {
      params: { genus_name: genusName, species_name: speciesName },
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      },
      timeout: REQUEST_TIMEOUT_MS
    })

    const assessments: any[] = data?.assessments ?? []
    if (assessments.length === 0) {
      return { ok: false, reason: 'not-found', message: `No IUCN assessment found for "${scientificName}".` }
    }

    const assessment =
      assessments.find((a) => a?.latest === true) ??
      [...assessments].sort((a, b) => (b?.year_published ?? 0) - (a?.year_published ?? 0))[0]

    const categoryCode: string | null = assessment?.red_list_category_code ?? assessment?.category ?? null
    return { ok: true, status: mapIucnCategoryCode(categoryCode), categoryCode }
  } catch (err) {
    const status = (err as any)?.response?.status
    if (status === 401 || status === 403) {
      return { ok: false, reason: 'invalid-token', message: 'IUCN API rejected the token — check it in Settings.' }
    }
    if (status === 404) {
      return { ok: false, reason: 'not-found', message: `No IUCN record found for "${scientificName}".` }
    }
    console.error(`[iucn] lookup failed for "${scientificName}":`, (err as Error).message)
    return { ok: false, reason: 'error', message: (err as Error).message }
  }
}
