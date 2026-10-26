import type { ConservationStatus } from '../../utils/conservationStatus'
import type { RedListTaxon } from '../../ipc/iucnChecklist'

/**
 * Static snapshot of the first page(s) of each Red List status, committed to
 * the repo so a fresh install has something to show and search before its
 * first network request, and while offline. Produced by `npm run
 * fetch-redlist` (scripts/fetch-redlist-data.mjs) from IUCN's checklist on
 * GBIF. At runtime the live source always wins (src/main/services/redListBrowse.ts);
 * this is only the offline fallback and a seed for instant search.
 */
import extinct from './EXTINCT.json'
import extinctInWild from './EXTINCT_IN_WILD.json'
import criticallyEndangered from './CRITICALLY_ENDANGERED.json'
import endangered from './ENDANGERED.json'
import vulnerable from './VULNERABLE.json'
import nearThreatened from './NEAR_THREATENED.json'
import leastConcern from './LEAST_CONCERN.json'
import dataDeficient from './DATA_DEFICIENT.json'

export interface BundledRedListData {
  status: ConservationStatus
  totalCount: number | null
  fetchedAt: string | null
  taxa: RedListTaxon[]
}

export const BUNDLED_REDLIST_DATA: Record<ConservationStatus, BundledRedListData> = {
  EXTINCT: extinct as BundledRedListData,
  EXTINCT_IN_WILD: extinctInWild as BundledRedListData,
  CRITICALLY_ENDANGERED: criticallyEndangered as BundledRedListData,
  ENDANGERED: endangered as BundledRedListData,
  VULNERABLE: vulnerable as BundledRedListData,
  NEAR_THREATENED: nearThreatened as BundledRedListData,
  LEAST_CONCERN: leastConcern as BundledRedListData,
  DATA_DEFICIENT: dataDeficient as BundledRedListData
}
