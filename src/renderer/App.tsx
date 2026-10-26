import { useEffect, useRef, useState, type ReactNode } from 'react'
import TopBar from './components/TopBar'
import Globe from './components/Globe'
import ExploreSheet from './components/ExploreSheet'
import SpeciesPanel from './components/SpeciesPanel'
import SettingsPanel from './components/SettingsPanel'
import { IconButton, SheetHeader } from './components/ui'
import { IconLoaderCircle, IconX } from './components/icons'
import { useUiStore } from './stores/uiStore'
import { useSpeciesStore } from './stores/speciesStore'
import { useGlobeStore } from './stores/globeStore'
import type { SpeciesData } from './types'

export default function App(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Dismissed for the rest of the session once a species is picked — a
  // launch moment, not a gate to click through on every return to the
  // empty-selection resting state.
  const [heroDismissed, setHeroDismissed] = useState(false)

  // Theme / accessibility / font-size attributes on <html> are applied by
  // uiStore itself (before first paint), not here.
  const exploreOpen = useUiStore((s) => s.exploreOpen)

  const selectedSpecies = useSpeciesStore((s) => s.selectedSpecies)
  const setSelectedSpecies = useSpeciesStore((s) => s.setSelectedSpecies)
  const upsertSpecies = useSpeciesStore((s) => s.upsertSpecies)
  const loadAllSpecies = useSpeciesStore((s) => s.loadAllSpecies)
  const loadingAllSpecies = useSpeciesStore((s) => s.loadingAll)
  const speciesCount = useSpeciesStore((s) => s.allSpecies.length)
  const fetchFavorites = useSpeciesStore((s) => s.fetchFavorites)
  const fetchSearchHistory = useSpeciesStore((s) => s.fetchSearchHistory)
  const loadOccurrences = useGlobeStore((s) => s.loadOccurrences)
  const clearOccurrences = useGlobeStore((s) => s.clearOccurrences)
  const setSyncingSpecies = useGlobeStore((s) => s.setSyncingSpecies)
  const setSyncMessage = useGlobeStore((s) => s.setSyncMessage)
  const setDetailsLoading = useGlobeStore((s) => s.setDetailsLoading)

  // Species IDs we've already tried to auto-sync this session. Prevents a
  // retry loop for a species GBIF genuinely has no records for.
  const syncAttemptedRef = useRef<Set<string>>(new Set())
  // Same, for the lightweight detail/image fetch.
  const detailsAttemptedRef = useRef<Set<string>>(new Set())

  // Initial data load.
  useEffect(() => {
    loadAllSpecies()
    fetchFavorites()
    fetchSearchHistory()

    const unsubscribe = window.api.onSyncComplete((status) => {
      console.log('[sync] background sync complete:', status)
      // Re-pull species (descriptions/images may have been backfilled).
      loadAllSpecies()
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Whenever the selected species changes, fetch its occurrence points for
  // the globe. Gated on whether there's actually anything cached locally —
  // NOT on gbif_key, which gets set the moment a taxon lookup succeeds,
  // regardless of whether any occurrences came back. (Species synced before
  // the /species/match fix in dataSync.ts have a gbif_key pointing at the
  // wrong taxon and zero real occurrences; gating on gbif_key alone would
  // permanently skip re-syncing exactly the species that need it.)
  // Keyed on the ID, not the object: this effect itself replaces the selected
  // object with fresher data, which must not re-trigger it.
  const selectedId = selectedSpecies?.id ?? null
  useEffect(() => {
    if (!selectedId) {
      clearOccurrences()
      setSyncMessage(null)
      return
    }
    const species = useSpeciesStore.getState().selectedSpecies
    if (!species) return
    let cancelled = false
    let startedSync = false
    let startedDetails = false
    setSyncMessage(null)

    function applyUpdate(updated: SpeciesData | null): void {
      if (cancelled || !updated) return
      upsertSpecies(updated) // so list thumbnails update too
      setSelectedSpecies(updated)
    }

    async function ensureData(species: SpeciesData): Promise<void> {
      await loadOccurrences(species.id)
      if (cancelled) return
      const hasPoints = useGlobeStore.getState().occurrencePoints.length > 0

      // Full sync (occurrences + details + status) when this species has
      // never had a complete sync, or has no points and its last sync is
      // over a week old. Keyed on the recorded sync time, not on "continents
      // is empty" — open-ocean species often have no continent at all and
      // would otherwise re-download everything every session.
      const syncedAt = species.occurrences_synced_at
        ? Date.parse(`${species.occurrences_synced_at.replace(' ', 'T')}Z`)
        : NaN
      const syncStale = Number.isNaN(syncedAt) || Date.now() - syncedAt > 7 * 24 * 60 * 60 * 1000
      const needsFullSync = !species.occurrences_synced_at || (!hasPoints && syncStale)

      if (needsFullSync && !syncAttemptedRef.current.has(species.id)) {
        syncAttemptedRef.current.add(species.id)
        startedSync = true
        setSyncingSpecies(true)
        try {
          const result = await window.api.refreshSpeciesData(species.id)
          if (cancelled) return
          await loadOccurrences(species.id)
          applyUpdate(await window.api.getSpeciesDetails(species.id))
          if (cancelled) return
          if (result.status === 'error') {
            setSyncMessage(`${result.message} — showing any saved data for ${species.common_name}`)
          } else if (useGlobeStore.getState().occurrencePoints.length === 0) {
            setSyncMessage(`GBIF has no mapped occurrence records for ${species.common_name}`)
          }
        } catch (err) {
          console.error('Auto-sync failed for', species.scientific_name, err)
          if (!cancelled) setSyncMessage(`Couldn't fetch live data for ${species.common_name} — check your connection`)
        } finally {
          if (!cancelled) setSyncingSpecies(false)
        }
        return
      }

      // Points already cached but no verified image yet: fetch details only
      // (a few cached requests) instead of re-downloading every occurrence.
      if (!species.image_checked_at && !detailsAttemptedRef.current.has(species.id)) {
        detailsAttemptedRef.current.add(species.id)
        try {
          applyUpdate(await window.api.ensureSpeciesDetails(species.id))
        } catch (err) {
          console.error('Detail fetch failed for', species.scientific_name, err)
        }
      }
    }

    // Mark the image lookup as in progress from the start (not just once the
    // request begins), so the panel says "Finding…" rather than briefly
    // flashing "couldn't check" while local occurrences load.
    const willLookUp =
      !species.image_checked_at &&
      (!syncAttemptedRef.current.has(species.id) || !detailsAttemptedRef.current.has(species.id))
    if (willLookUp) {
      startedDetails = true
      setDetailsLoading(true)
    }
    ensureData(species).finally(() => {
      if (!cancelled && startedDetails) setDetailsLoading(false)
    })
    return () => {
      cancelled = true
      // Switching species mid-sync must not leave the spinner stuck on.
      if (startedSync) setSyncingSpecies(false)
      if (startedDetails) setDetailsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  useEffect(() => {
    if (selectedSpecies) setHeroDismissed(true)
  }, [selectedSpecies])

  /*
   * Layout (Phase 2c): three real columns — Explore | Globe | Species — so the
   * sheets never overlap each other or the globe; the globe canvas resizes
   * between them (Globe.tsx watches its own size via ResizeObserver).
   *
   * Layer order is fixed and documented here so nothing can stack
   * unpredictably again (the Phase 2a floating panels could):
   *   z-0   globe canvas
   *   z-10  globe overlays (legend, tooltips, hero) — inside the globe column
   *   z-20  first-launch loading cover — inside the globe column only
   *   z-50  Settings modal — the only thing that ever covers the whole app
   */
  return (
    <div className="h-full w-full flex flex-col bg-[rgb(var(--bg-primary))] text-[rgb(var(--text-primary))] text-body">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />

      <div className="flex-1 min-h-0 flex">
        <DockedSheet side="left" open={exploreOpen} width="clamp(17rem, 26vw, 22.5rem)" label="Explore">
          <ExploreSheet />
        </DockedSheet>

        <main className="flex-1 min-w-0 relative">
          <Globe />

          {/* Launch moment: a quiet hero over the globe until a species is picked. */}
          <div
            className={`absolute inset-x-0 top-10 z-10 flex flex-col items-center pointer-events-none transition-all duration-500 ease-out ${
              !heroDismissed && !loadingAllSpecies ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
            }`}
          >
            <h1 className="text-2xl font-semibold tracking-tight text-[rgb(var(--text-primary))]">
              Biodiversity Explorer
            </h1>
            <p className="mt-1.5 text-sm text-[rgb(var(--text-secondary))]">
              {speciesCount.toLocaleString()} species ready to explore
            </p>
          </div>

          {/* First-launch only — later background syncs also set
              loadingAllSpecies, but allSpecies is populated by then. */}
          {loadingAllSpecies && speciesCount === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[rgb(var(--bg-primary))]">
              <div className="flex items-center gap-2.5 text-sm text-[rgb(var(--text-secondary))]">
                <IconLoaderCircle size={16} className="animate-spin" />
                Loading species library…
              </div>
            </div>
          )}
        </main>

        <DockedSheet side="right" open={!!selectedSpecies} width="clamp(18rem, 28vw, 25rem)" label="Species">
          <div className="flex flex-col h-full min-h-0">
            <SheetHeader>
              <span className="flex-1 px-1 text-xs font-medium text-[rgb(var(--text-secondary))]">Species</span>
              <IconButton label="Close species panel" onClick={() => setSelectedSpecies(null)}>
                <IconX size={16} />
              </IconButton>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
              <SpeciesPanel />
            </div>
          </div>
        </DockedSheet>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/**
 * A docked column that slides open/closed by animating its width. The inner
 * content keeps a fixed width so it never reflows mid-animation — it's
 * clipped, not squeezed. `inert` while closed keeps hidden controls out of
 * the tab order.
 */
function DockedSheet({
  side,
  open,
  width,
  label,
  children
}: {
  side: 'left' | 'right'
  open: boolean
  /**
   * CSS width. rem-based so it scales with Settings → Font size, and
   * clamp()ed to the window width so at the 1024 px minimum both sheets
   * still leave the globe a usable column.
   */
  width: string
  label: string
  children: ReactNode
}): JSX.Element {
  return (
    <aside
      aria-label={label}
      aria-hidden={!open}
      {...(!open ? { inert: '' } : {})}
      style={{ width: open ? width : 0 }}
      className={`shrink-0 overflow-hidden bg-[rgb(var(--bg-secondary))] transition-[width] duration-200 ease-out ${
        open ? (side === 'left' ? 'border-r' : 'border-l') : ''
      } border-[rgb(var(--border))]`}
    >
      <div style={{ width }} className="h-full">
        {children}
      </div>
    </aside>
  )
}
