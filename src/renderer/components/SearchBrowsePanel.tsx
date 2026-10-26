import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSpeciesStore } from '../stores/speciesStore'
import { useFilterStore } from '../stores/filterStore'
import { useSpeciesSearch } from '../hooks/useSpeciesSearch'
import { filterSpeciesList } from '../utils/filterSpecies'
import SpeciesThumb from './SpeciesThumb'
import { IconButton } from './ui'
import { IconRefreshCw, IconSearch } from './icons'
import {
  CONSERVATION_STATUS_COLORS,
  CONSERVATION_STATUS_LABELS,
  CONSERVATION_STATUS_ORDER
} from '../constants'
import type { ConservationStatus, SpeciesData } from '../types'

const SEARCH_DEBOUNCE_MS = 150
const BROWSE_PAGE_SIZE = 100

interface RedListTaxon {
  scientificName: string
  commonName: string | null
  gbifKey?: number | null
}

interface RedListHit extends RedListTaxon {
  status: ConservationStatus
}

/**
 * Opens a Red List taxon: creates/fetches its local species row (main
 * process de-duplicates concurrent calls), then selects it. Errors are keyed
 * by scientific name so each row can show its own — a message at the top of
 * a long list is invisible when the clicked row is further down.
 */
function useOpenRedListTaxon(): {
  open: (taxon: RedListTaxon, status: ConservationStatus) => Promise<void>
  openingName: string | null
  rowErrors: Record<string, string>
} {
  const setSelectedSpecies = useSpeciesStore((s) => s.setSelectedSpecies)
  const addToSearchHistory = useSpeciesStore((s) => s.addToSearchHistory)
  const upsertSpecies = useSpeciesStore((s) => s.upsertSpecies)
  const [openingName, setOpeningName] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const open = useCallback(
    async (taxon: RedListTaxon, status: ConservationStatus) => {
      setOpeningName(taxon.scientificName)
      setRowErrors((e) => {
        const { [taxon.scientificName]: _drop, ...rest } = e
        return rest
      })
      try {
        const result = await window.api.ensureSpecies(taxon.scientificName, status, taxon.commonName, taxon.gbifKey ?? null)
        if (result.status === 'error') {
          setRowErrors((e) => ({ ...e, [taxon.scientificName]: result.message }))
          return
        }
        const species = result.species as SpeciesData
        upsertSpecies(species)
        setSelectedSpecies(species)
        addToSearchHistory(species.id, species.common_name)
      } catch (err) {
        console.error('Failed to open Red List species:', err)
        setRowErrors((e) => ({
          ...e,
          [taxon.scientificName]: "Couldn't open this species — check your connection and try again."
        }))
      } finally {
        setOpeningName(null)
      }
    },
    [setSelectedSpecies, addToSearchHistory, upsertSpecies]
  )

  return { open, openingName, rowErrors }
}

function RowError({ message }: { message?: string }): JSX.Element | null {
  if (!message) return null
  return (
    <p role="alert" className="px-4 pb-2 -mt-1 text-2xs leading-snug text-[rgb(220_38_38)]">
      {message}
    </p>
  )
}

/*
 * Content for the Search and Browse tabs of the docked Explore sheet.
 *
 * - Search: instant, local, cross-status — your library plus every Red List
 *   taxon this install has seen (bundled snapshot + browsed pages). Never
 *   hits the network per keystroke.
 * - Browse: pages through IUCN's Red List (animals) for one category, from
 *   IUCN's own checklist on GBIF, with true totals.
 */
export function SearchTab(): JSX.Element {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [redListHits, setRedListHits] = useState<RedListHit[]>([])
  const [redListLoading, setRedListLoading] = useState(false)
  const searchRequestId = useRef(0)
  const { open, openingName, rowErrors } = useOpenRedListTaxon()

  const allSpecies = useSpeciesStore((s) => s.allSpecies)
  const searchHistory = useSpeciesStore((s) => s.searchHistory)
  const setSelectedSpecies = useSpeciesStore((s) => s.setSelectedSpecies)
  const addToSearchHistory = useSpeciesStore((s) => s.addToSearchHistory)
  const clearSearchHistory = useSpeciesStore((s) => s.clearSearchHistory)
  const filters = useFilterStore((s) => s.filters)
  const activeFilterCount = useFilterStore((s) => s.activeFilterCount())

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const searchPool = useMemo(
    () => (activeFilterCount > 0 ? filterSpeciesList(allSpecies, filters) : allSpecies),
    [allSpecies, filters, activeFilterCount]
  )
  const searchLocal = useSpeciesSearch(searchPool)
  const localResults = debouncedQuery.trim() ? searchLocal(debouncedQuery, 8) : []

  useEffect(() => {
    const q = debouncedQuery.trim()
    if (!q) {
      setRedListHits([])
      setRedListLoading(false)
      return
    }
    const requestId = ++searchRequestId.current
    setRedListLoading(true)
    window.api
      .searchRedListTaxa(q, 8)
      .then((hits: RedListHit[]) => {
        if (searchRequestId.current === requestId) setRedListHits(hits)
      })
      .catch((err) => {
        console.error('Red List search failed:', err)
        if (searchRequestId.current === requestId) setRedListHits([])
      })
      .finally(() => {
        if (searchRequestId.current === requestId) setRedListLoading(false)
      })
  }, [debouncedQuery])

  const localNames = useMemo(
    () => new Set(localResults.map((s) => s.scientific_name.toLowerCase())),
    [localResults]
  )
  const newRedListHits = redListHits.filter((h) => !localNames.has(h.scientificName.toLowerCase()))
  const showHistory = !query.trim() && searchHistory.length > 0
  const hasResults = localResults.length > 0 || newRedListHits.length > 0

  function selectSpecies(species: SpeciesData): void {
    setSelectedSpecies(species)
    addToSearchHistory(species.id, species.common_name)
    setQuery('')
  }

  function selectFromHistory(speciesId: string | null): void {
    if (!speciesId) return
    const species = allSpecies.find((s) => s.id === speciesId)
    if (species) selectSpecies(species)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-[rgb(var(--border))] shrink-0 relative">
        <IconSearch
          size={15}
          className="absolute left-5 top-1/2 -translate-y-1/2 text-[rgb(var(--text-secondary))] pointer-events-none"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur()
          }}
          // Short enough to fit the sheet at every font size — the long
          // "Search species by common or scientific name…" was clipped.
          placeholder="Common or scientific name…"
          aria-label="Search species by common or scientific name"
          title="Search species by common or scientific name"
          className="w-full h-control pl-8 pr-3 text-sm text-ellipsis rounded-md bg-[rgb(var(--bg-primary))] border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] placeholder:text-[rgb(var(--text-secondary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))]"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {localResults.length > 0 && (
          <div>
            <SectionLabel>Your library</SectionLabel>
            {localResults.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSpecies(s)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[rgb(var(--bg-elevated))]"
              >
                <SpeciesThumb species={s} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{s.common_name}</span>
                  <span className="block text-xs italic text-[rgb(var(--text-secondary))] truncate">
                    {s.scientific_name}
                  </span>
                </span>
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: CONSERVATION_STATUS_COLORS[s.conservation_status] }}
                  title={CONSERVATION_STATUS_LABELS[s.conservation_status]}
                />
              </button>
            ))}
          </div>
        )}

        {(newRedListHits.length > 0 || redListLoading) && (
          <div>
            <SectionLabel>IUCN Red List</SectionLabel>
            {newRedListHits.map((h) => (
              <div key={h.scientificName}>
                <button
                  onClick={() => open(h, h.status)}
                  disabled={openingName !== null}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[rgb(var(--bg-elevated))] disabled:opacity-60"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: CONSERVATION_STATUS_COLORS[h.status] }}
                    title={CONSERVATION_STATUS_LABELS[h.status]}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{h.commonName ?? <i>{h.scientificName}</i>}</span>
                    {h.commonName && (
                      <span className="block text-xs italic text-[rgb(var(--text-secondary))] truncate">
                        {h.scientificName}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-[rgb(var(--accent))] shrink-0">
                    {openingName === h.scientificName ? 'Opening…' : 'Open'}
                  </span>
                </button>
                <RowError message={rowErrors[h.scientificName]} />
              </div>
            ))}
            {redListLoading && newRedListHits.length === 0 && (
              <p className="px-4 py-2 text-xs text-[rgb(var(--text-secondary))]">Searching…</p>
            )}
          </div>
        )}

        {!hasResults && !redListLoading && debouncedQuery.trim() && (
          <p className="px-4 py-3 text-xs text-[rgb(var(--text-secondary))] leading-relaxed">
            No matches among species seen so far. Search covers your library and every Red List page you've
            browsed — open the <span className="font-medium">Browse</span> tab to page through a whole category.
          </p>
        )}

        {showHistory && (
          <div>
            <div className="flex items-center justify-between pr-4">
              <SectionLabel>Recent</SectionLabel>
              <button
                onClick={clearSearchHistory}
                className="pt-3 pb-1 text-2xs text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]"
              >
                Clear
              </button>
            </div>
            {searchHistory.slice(0, 12).map((h) => (
              <button
                key={h.id}
                onClick={() => selectFromHistory(h.species_id)}
                className="w-full text-left px-4 py-1.5 text-sm hover:bg-[rgb(var(--bg-elevated))] truncate"
              >
                {h.species_name ?? h.search_term}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface BrowseState {
  items: RedListTaxon[]
  totalCount: number | null
  nextOffset: number
  endOfRecords: boolean
  source: 'live' | 'cache' | 'stale' | 'bundled' | null
}

const EMPTY_BROWSE: BrowseState = { items: [], totalCount: null, nextOffset: 0, endOfRecords: false, source: null }

const SOURCE_NOTE: Record<NonNullable<BrowseState['source']>, string> = {
  live: 'live from GBIF',
  cache: 'saved copy, under a week old',
  stale: 'offline — older saved copy',
  bundled: 'offline — bundled snapshot'
}

export function BrowseTab(): JSX.Element {
  const [status, setStatus] = useState<ConservationStatus>('CRITICALLY_ENDANGERED')
  const [state, setState] = useState<BrowseState>(EMPTY_BROWSE)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { open, openingName, rowErrors } = useOpenRedListTaxon()
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Refs mirror the latest values so the IntersectionObserver callback and
  // async completions never act on stale closure state.
  const requestId = useRef(0)
  const statusRef = useRef(status)
  const stateRef = useRef(state)
  const loadingRef = useRef(false)
  const errorRef = useRef<string | null>(null)
  const forceRef = useRef(false) // after Refresh, bypass the cache for every page of this category
  stateRef.current = state
  errorRef.current = error

  const load = useCallback(async (offset: number) => {
    const forStatus = statusRef.current
    const fromBundled = offset > 0 && stateRef.current.source === 'bundled'
    const id = ++requestId.current
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const r = await window.api.browseRedList(forStatus, offset, BROWSE_PAGE_SIZE, forceRef.current, fromBundled)
      if (requestId.current !== id) return // superseded (status switch / Refresh)
      if (r.error) {
        // Keep whatever is already listed (and its total); just report the failure.
        if (offset === 0) setState(EMPTY_BROWSE)
        setError(r.error)
        return
      }
      setState((prev) => {
        // De-duplicate on append in case the source's ordering shifts between pages.
        const seen = new Set(offset === 0 ? [] : prev.items.map((t) => t.scientificName))
        const fresh = (r.taxa as RedListTaxon[]).filter((t) => !seen.has(t.scientificName))
        return {
          items: offset === 0 ? fresh : [...prev.items, ...fresh],
          totalCount: r.totalCount ?? prev.totalCount,
          nextOffset: r.nextOffset,
          endOfRecords: r.endOfRecords || r.nextOffset === offset,
          source: r.source
        }
      })
    } catch (err) {
      console.error('[BrowseTab] load failed:', err)
      if (requestId.current === id) setError("Couldn't load this list — check your connection and try again.")
    } finally {
      if (requestId.current === id) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [])

  function restart(force: boolean): void {
    forceRef.current = force
    setState(EMPTY_BROWSE)
    stateRef.current = EMPTY_BROWSE
    scrollRef.current?.scrollTo({ top: 0 })
    load(0)
  }

  useEffect(() => {
    statusRef.current = status
    restart(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  // Load the next page when the end of the list scrolls into view. One
  // observer for the component's lifetime; it reads everything through refs.
  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        const s = stateRef.current
        if (
          entries[0]?.isIntersecting &&
          !loadingRef.current &&
          !errorRef.current &&
          !s.endOfRecords &&
          s.items.length > 0
        ) {
          load(s.nextOffset)
        }
      },
      { root, rootMargin: '300px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [load])

  // The observer only fires when the sentinel's visibility CHANGES. If a page
  // lands and the end of the list is still within reach (short page, mostly
  // duplicates, a tall panel), nothing would fire and paging would stall —
  // so re-check after every completed load.
  useEffect(() => {
    if (loading || error || state.endOfRecords || state.items.length === 0) return
    const sentinel = sentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root || root.offsetParent === null) return // hidden tab: wait until shown
    if (sentinel.getBoundingClientRect().top <= root.getBoundingClientRect().bottom + 300) {
      load(state.nextOffset)
    }
  }, [loading, error, state.endOfRecords, state.items.length, state.nextOffset, load])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 space-y-2 border-b border-[rgb(var(--border))] shrink-0">
        <div className="flex gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ConservationStatus)}
            aria-label="IUCN Red List category"
            className="flex-1 h-control px-2 text-xs rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--bg-primary))] text-[rgb(var(--text-primary))]"
          >
            {CONSERVATION_STATUS_ORDER.map((st) => (
              <option key={st} value={st}>
                {CONSERVATION_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
          <IconButton
            variant="outline"
            label="Fetch this category again from GBIF, ignoring the saved copy"
            onClick={() => restart(true)}
            disabled={loading}
          >
            <IconRefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </IconButton>
        </div>
        <p className="text-2xs text-[rgb(var(--text-secondary))] leading-relaxed">
          {state.totalCount !== null ? (
            <>
              {state.totalCount.toLocaleString()} animal species listed as{' '}
              {CONSERVATION_STATUS_LABELS[status].toLowerCase()} by the IUCN Red List
              {state.source ? ` · ${SOURCE_NOTE[state.source]}` : ''}
            </>
          ) : loading ? (
            'Loading from the IUCN Red List…'
          ) : (
            'IUCN Red List of Threatened Species, via GBIF'
          )}
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {state.items.length === 0 && !loading && !error && (
          <p className="p-4 text-xs text-[rgb(var(--text-secondary))]">No animal species in this category.</p>
        )}

        <ul className="divide-y divide-[rgb(var(--border))]">
          {state.items.map((t) => (
            <li key={t.scientificName}>
              <button
                onClick={() => open(t, status)}
                disabled={openingName !== null}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[rgb(var(--bg-elevated))] disabled:opacity-60"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{t.commonName ?? <i>{t.scientificName}</i>}</span>
                  {t.commonName && (
                    <span className="block text-xs italic text-[rgb(var(--text-secondary))] truncate">
                      {t.scientificName}
                    </span>
                  )}
                </span>
                <span className="text-xs text-[rgb(var(--accent))] shrink-0">
                  {openingName === t.scientificName ? 'Opening…' : 'View'}
                </span>
              </button>
              <RowError message={rowErrors[t.scientificName]} />
            </li>
          ))}
        </ul>

        {error && (
          <div className="p-4 space-y-2">
            <p role="alert" className="text-xs text-[rgb(220_38_38)]">
              {error}
            </p>
            <button
              onClick={() => load(state.nextOffset)}
              className="h-control px-3 rounded-md border border-[rgb(var(--border))] text-xs hover:bg-[rgb(var(--bg-elevated))]"
            >
              Try again
            </button>
          </div>
        )}

        <div ref={sentinelRef} className="h-px" />
        {loading && (
          <p className="p-4 text-xs text-[rgb(var(--text-secondary))]">
            {state.items.length === 0 ? 'Loading…' : 'Loading more…'}
          </p>
        )}
        {state.endOfRecords && state.items.length > 0 && (
          <p className="p-4 text-2xs text-center text-[rgb(var(--text-secondary))]">
            All {state.items.length.toLocaleString()} shown
          </p>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: string }): JSX.Element {
  return (
    <div className="px-4 pt-3 pb-1 text-3xs uppercase tracking-wide text-[rgb(var(--text-secondary))]">
      {children}
    </div>
  )
}
