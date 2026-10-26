/**
 * Shared IUCN Red List category model + mappers, used by both conservation
 * status sources (src/main/ipc/iucnChecklist.ts and src/main/ipc/iucn.ts) so the
 * two agree on exactly the same output shape and the same category codes.
 * Mirrors src/renderer/types/index.ts's ConservationStatus — duplicated
 * (not imported) because main and renderer are separate build targets with
 * no cross-process type sharing set up in this project.
 */
export type ConservationStatus =
  | 'EXTINCT'
  | 'EXTINCT_IN_WILD'
  | 'CRITICALLY_ENDANGERED'
  | 'ENDANGERED'
  | 'VULNERABLE'
  | 'NEAR_THREATENED'
  | 'LEAST_CONCERN'
  | 'DATA_DEFICIENT'

/**
 * Maps an official IUCN Red List category code (as returned by the IUCN API,
 * e.g. "CR", "LR/nt") to our internal ConservationStatus. Source: IUCN's
 * published category list (https://www.iucnredlist.org/resources/categories-and-criteria),
 * including the pre-2001 "Lower Risk" subcategories some older assessments
 * still carry.
 */
export function mapIucnCategoryCode(code: string | null | undefined): ConservationStatus | null {
  if (!code) return null
  switch (code.trim().toUpperCase()) {
    case 'EX':
      return 'EXTINCT'
    case 'EW':
      return 'EXTINCT_IN_WILD'
    case 'CR':
    case 'CR(PE)':
    case 'CR(PEW)':
      return 'CRITICALLY_ENDANGERED'
    case 'EN':
      return 'ENDANGERED'
    case 'VU':
      return 'VULNERABLE'
    case 'NT':
    case 'LR/NT':
    case 'LR/CD': // legacy "Conservation Dependent" — closest modern analogue
      return 'NEAR_THREATENED'
    case 'LC':
    case 'LR/LC':
      return 'LEAST_CONCERN'
    case 'DD':
      return 'DATA_DEFICIENT'
    case 'NE':
      return null // "Not Evaluated" isn't a real status — let the caller fall back
    default:
      return null
  }
}

/**
 * Maps a Wikidata "conservation status" (P141) item's English label (fetched
 * via wikibase:label) to our internal ConservationStatus. Wikidata's P141
 * values are themselves sourced from the IUCN Red List (see P645, "source
 * for conservation status (P141)"), so this is describing the same taxonomy
 * as mapIucnCategoryCode above, just via item labels instead of codes.
 * Longer/more specific labels are checked first so "critically endangered
 * species" doesn't get caught by a bare "endangered" match, etc.
 */
export function mapWikidataStatusLabel(label: string | null | undefined): ConservationStatus | null {
  if (!label) return null
  const l = label.trim().toLowerCase()
  if (l.includes('extinct in the wild')) return 'EXTINCT_IN_WILD'
  if (l.includes('possibly extinct')) return null
  if (l === 'extinct' || l.includes('extinct species')) return 'EXTINCT'
  if (l.includes('critically endangered')) return 'CRITICALLY_ENDANGERED'
  if (l.includes('endangered')) return 'ENDANGERED'
  if (l.includes('vulnerable')) return 'VULNERABLE'
  if (l.includes('near threatened')) return 'NEAR_THREATENED'
  if (l.includes('least concern')) return 'LEAST_CONCERN'
  if (l.includes('data deficient')) return 'DATA_DEFICIENT'
  return null
}
