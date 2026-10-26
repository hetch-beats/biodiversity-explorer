/**
 * Maps a GBIF Backbone Taxonomy classification (kingdom/phylum/class) to one
 * of this app's fixed ANIMAL_GROUPS buckets (src/renderer/constants.ts) —
 * needed when creating a species record on demand from a bare scientific
 * name (see src/main/services/ensureSpecies.ts), since GBIF's /species/match
 * doesn't know about this app's specific 9-bucket model.
 *
 * Real animal diversity has far more phyla than the app's 9 buckets cover
 * (Cnidaria, Echinodermata, Annelida, Porifera, ...), so anything outside
 * the well-known buckets below falls back to the closest existing bucket
 * rather than inventing a 10th one the rest of the UI (filters, icons)
 * doesn't know about. This is a real, documented approximation, not a bug —
 * see the fallback comment below.
 */
export function mapGbifClassificationToAnimalGroup(
  kingdom: string | null | undefined,
  phylum: string | null | undefined,
  className: string | null | undefined
): string | null {
  if (!kingdom || kingdom !== 'Animalia') return null // this app is animal-only, by design

  switch (className) {
    case 'Mammalia':
      return 'Mammals'
    case 'Aves':
      return 'Birds'
    case 'Reptilia':
      return 'Reptiles'
    case 'Amphibia':
      return 'Amphibians'
    case 'Actinopterygii':
    case 'Chondrichthyes':
    case 'Sarcopterygii':
    case 'Myxini':
    case 'Petromyzonti':
    case 'Cephalaspidomorphi':
      return 'Fish'
    case 'Insecta':
      return 'Insects'
    case 'Arachnida':
      return 'Arachnids'
    case 'Malacostraca':
    case 'Branchiopoda':
    case 'Maxillopoda':
      return 'Crustaceans'
  }

  if (phylum === 'Mollusca') return 'Mollusks'

  // Fallback for phyla the app has no dedicated bucket for (Cnidaria,
  // Echinodermata, Annelida, Porifera, etc.) — matches the existing seed
  // data's own precedent (Moon Jellyfish, phylum Cnidaria, is filed under
  // 'Mollusks' there too) rather than introducing an unfiltered "Other".
  if (phylum === 'Arthropoda') return 'Crustaceans'
  if (phylum === 'Chordata') return 'Fish'
  return 'Mollusks'
}
