import { useEffect, useState } from 'react'
import { useUiStore, type ExploreTab } from '../stores/uiStore'
import { useFilterStore } from '../stores/filterStore'
import { SearchTab, BrowseTab } from './SearchBrowsePanel'
import FilterPanel from './FilterPanel'
import { SheetHeader } from './ui'
import { IconList, IconSearch, IconSlidersHorizontal, type IconComponent } from './icons'

const TABS: { id: ExploreTab; label: string; icon: IconComponent }[] = [
  { id: 'search', label: 'Search', icon: IconSearch },
  { id: 'browse', label: 'Browse', icon: IconList },
  { id: 'filters', label: 'Filters', icon: IconSlidersHorizontal }
]

/**
 * Left docked sheet (Phase 2c — replaces the draggable floating panels, which
 * collided with Settings and the species panel). It's a real layout column,
 * so the globe resizes around it instead of being covered.
 *
 * Each tab mounts the first time it's opened and then stays mounted (only
 * hidden when inactive): switching is instant, Browse keeps its loaded page +
 * scroll position instead of re-querying on every visit, and nothing fires a
 * query for a tab that was never opened.
 */
export default function ExploreSheet(): JSX.Element {
  const tab = useUiStore((s) => s.exploreTab)
  const setTab = useUiStore((s) => s.setExploreTab)
  const activeFilters = useFilterStore((s) => s.activeFilterCount())
  const [visited, setVisited] = useState<Set<ExploreTab>>(() => new Set([tab]))

  useEffect(() => {
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)))
  }, [tab])

  return (
    <div className="flex flex-col h-full min-h-0">
      <SheetHeader>
        {/* The sheet is shown/hidden from the top bar's panel toggle — one control, not two. */}
        <div role="tablist" aria-label="Explore" className="flex flex-1 gap-1">
          {TABS.map((t) => {
            const active = tab === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`h-control px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[rgb(var(--bg-elevated))] text-[rgb(var(--text-primary))]'
                    : 'text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]'
                }`}
              >
                <Icon size={14} />
                {t.label}
                {t.id === 'filters' && activeFilters > 0 && (
                  <span className="min-w-4 h-4 px-1 inline-flex items-center justify-center rounded-full bg-[rgb(var(--accent))] text-[rgb(var(--accent-contrast))] text-3xs">
                    {activeFilters}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </SheetHeader>

      <div className="flex-1 min-h-0 relative">
        {visited.has('search') && (
          <div className={tab === 'search' ? 'h-full' : 'hidden'} role="tabpanel">
            <SearchTab />
          </div>
        )}
        {visited.has('browse') && (
          <div className={tab === 'browse' ? 'h-full' : 'hidden'} role="tabpanel">
            <BrowseTab />
          </div>
        )}
        {visited.has('filters') && (
          <div className={tab === 'filters' ? 'h-full overflow-y-auto scrollbar-thin' : 'hidden'} role="tabpanel">
            <FilterPanel />
          </div>
        )}
      </div>
    </div>
  )
}
