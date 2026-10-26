import { useMemo, type ReactNode } from 'react'
import { useFilterStore } from '../stores/filterStore'
import { useSpeciesStore } from '../stores/speciesStore'
import { filterSpeciesList } from '../utils/filterSpecies'
import SpeciesThumb from './SpeciesThumb'
import { IconX } from './icons'
import {
  ANIMAL_GROUPS,
  CONSERVATION_STATUS_COLORS,
  CONSERVATION_STATUS_LABELS,
  CONSERVATION_STATUS_ORDER,
  CONTINENTS,
  DEFAULT_SIZE_RANGE,
  HABITATS
} from '../constants'
import type { SpeciesData } from '../types'

// The local library isn't a fixed curated set anymore — every species opened
// from the floating search bar is added permanently (see ensureSpecies.ts),
// so a session that's opened a few hundred results could match on thousands
// of rows here. Rendering all of them (each with its own <img>) rather than
// a bounded slice is the kind of thing that's fine at 96 and janky at 3,000 —
// capping it keeps this scalable regardless of how large the library grows.
const MAX_RENDERED_MATCHES = 200

export default function FilterPanel(): JSX.Element {
  const filters = useFilterStore((s) => s.filters)
  const toggleContinent = useFilterStore((s) => s.toggleContinent)
  const toggleGroup = useFilterStore((s) => s.toggleAnimalGroup)
  const toggleStatus = useFilterStore((s) => s.toggleConservationStatus)
  const toggleHabitat = useFilterStore((s) => s.toggleHabitat)
  const setSizeRange = useFilterStore((s) => s.setSizeRange)
  const toggleEndangeredOnly = useFilterStore((s) => s.toggleEndangeredOnly)
  const clearAllFilters = useFilterStore((s) => s.clearAllFilters)
  const activeCount = useFilterStore((s) => s.activeFilterCount())

  const allSpecies = useSpeciesStore((s) => s.allSpecies)
  const setSelectedSpecies = useSpeciesStore((s) => s.setSelectedSpecies)
  const addToSearchHistory = useSpeciesStore((s) => s.addToSearchHistory)

  // Recomputed live as filters change — this is what actually makes the
  // checkboxes above do anything. (Previously they only edited a "draft"
  // that nothing read until a separate "Apply filters" click, and even then
  // nothing on screen consumed the result — the panel had no visible effect
  // at all.)
  const results = useMemo(
    () => (activeCount > 0 ? filterSpeciesList(allSpecies, filters) : []),
    [allSpecies, filters, activeCount]
  )

  function pick(species: SpeciesData): void {
    setSelectedSpecies(species)
    addToSearchHistory(species.id, species.common_name)
  }

  // Active filters as removable chips — filters over what's currently known
  // locally (which grows the moment you open anything from search, not a
  // fixed curated set — see SearchBrowsePanel).
  const chips: { key: string; label: string; onRemove: () => void }[] = [
    ...filters.continents.map((c) => ({ key: `c:${c}`, label: c, onRemove: () => toggleContinent(c) })),
    ...filters.animalGroups.map((g) => ({ key: `g:${g}`, label: g, onRemove: () => toggleGroup(g) })),
    ...filters.conservationStatus.map((st) => ({
      key: `s:${st}`,
      label: CONSERVATION_STATUS_LABELS[st],
      onRemove: () => toggleStatus(st)
    })),
    ...filters.habitatTypes.map((h) => ({ key: `h:${h}`, label: h, onRemove: () => toggleHabitat(h) })),
    ...(filters.endangeredOnly
      ? [{ key: 'endangered', label: 'Endangered / at-risk only', onRemove: toggleEndangeredOnly }]
      : [])
  ]

  return (
    <div>
      {chips.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.onRemove}
              className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--accent))] px-2.5 py-1 text-2xs text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10 transition-colors"
            >
              {chip.label}
              <IconX size={11} />
            </button>
          ))}
        </div>
      )}

      <div>
        <div className="p-4 space-y-4 text-sm">
          <FilterGroup label="Continent">
            {CONTINENTS.map((c) => (
              <Checkbox key={c} checked={filters.continents.includes(c)} onChange={() => toggleContinent(c)} label={c} />
            ))}
          </FilterGroup>

          <FilterGroup label="Animal group">
            {ANIMAL_GROUPS.map((g) => (
              <Checkbox key={g} checked={filters.animalGroups.includes(g)} onChange={() => toggleGroup(g)} label={g} />
            ))}
          </FilterGroup>

          <FilterGroup label="Conservation status">
            {CONSERVATION_STATUS_ORDER.map((st) => (
              <Checkbox
                key={st}
                checked={filters.conservationStatus.includes(st)}
                onChange={() => toggleStatus(st)}
                label={CONSERVATION_STATUS_LABELS[st]}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Habitat">
            {HABITATS.map((h) => (
              <Checkbox key={h} checked={filters.habitatTypes.includes(h)} onChange={() => toggleHabitat(h)} label={h} />
            ))}
          </FilterGroup>

          <div>
            <div className="text-xs uppercase tracking-wide text-[rgb(var(--text-secondary))] mb-2">
              Size: {filters.sizeRange[0]}–{filters.sizeRange[1]} cm
            </div>
            <input
              type="range"
              min={DEFAULT_SIZE_RANGE[0]}
              max={DEFAULT_SIZE_RANGE[1]}
              value={filters.sizeRange[1]}
              onChange={(e) => setSizeRange(filters.sizeRange[0], Number(e.target.value))}
              className="w-full accent-[rgb(var(--accent))]"
            />
          </div>

          <Checkbox checked={filters.endangeredOnly} onChange={toggleEndangeredOnly} label="Endangered / at-risk only" />

          {activeCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="w-full h-control rounded-md border border-[rgb(var(--border))] text-xs hover:bg-[rgb(var(--bg-elevated))]"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {activeCount > 0 && (
        <div className="px-4 pb-4 border-t border-[rgb(var(--border))] pt-3">
          <div className="text-xs uppercase tracking-wide text-[rgb(var(--text-secondary))] mb-2">
            {results.length} match{results.length === 1 ? '' : 'es'}
          </div>
          {results.length === 0 ? (
            <p className="text-xs text-[rgb(var(--text-secondary))]">No species match these filters.</p>
          ) : (
            <>
              <ul className="space-y-1">
                {results.slice(0, MAX_RENDERED_MATCHES).map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => pick(s)}
                      className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left hover:bg-[rgb(var(--bg-elevated))]"
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
                        title={s.conservation_status}
                      />
                    </button>
                  </li>
                ))}
              </ul>
              {results.length > MAX_RENDERED_MATCHES && (
                <p className="mt-1.5 text-3xs text-[rgb(var(--text-secondary))]">
                  Showing the first {MAX_RENDERED_MATCHES} of {results.length} — narrow the filters above to see
                  more precisely.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[rgb(var(--text-secondary))] mb-1.5">{label}</div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">{children}</div>
    </div>
  )
}

function Checkbox({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: () => void
  label: string
}): JSX.Element {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-[rgb(var(--accent))]" />
      <span className="truncate">{label}</span>
    </label>
  )
}
