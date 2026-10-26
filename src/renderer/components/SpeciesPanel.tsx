import { useState } from 'react'
import { useSpeciesStore } from '../stores/speciesStore'
import { useGlobeStore } from '../stores/globeStore'
import { useSpeciesSearch } from '../hooks/useSpeciesSearch'
import SpeciesThumb from './SpeciesThumb'
import SpeciesImage from './SpeciesImage'
import { IconExternalLink, IconStar } from './icons'
import { CONSERVATION_STATUS_COLORS, CONSERVATION_STATUS_LABELS } from '../constants'
import type { SpeciesData } from '../types'

type Tab = 'overview' | 'geography' | 'behavior' | 'conservation' | 'sources'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'geography', label: 'Geography' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'conservation', label: 'Conservation' },
  { id: 'sources', label: 'Sources' }
]

export default function SpeciesPanel(): JSX.Element | null {
  const [tab, setTab] = useState<Tab>('overview')
  const [comparePickerOpen, setComparePickerOpen] = useState(false)
  const [compareQuery, setCompareQuery] = useState('')
  const species = useSpeciesStore((s) => s.selectedSpecies)
  const allSpecies = useSpeciesStore((s) => s.allSpecies)
  const isFavorite = useSpeciesStore((s) => s.isFavorite)
  const toggleFavorite = useSpeciesStore((s) => s.toggleFavorite)
  const comparisonSpecies = useSpeciesStore((s) => s.comparisonSpecies)
  const setComparisonSpecies = useSpeciesStore((s) => s.setComparisonSpecies)
  const requestScreenshot = useGlobeStore((s) => s.requestScreenshot)
  const occurrenceCount = useGlobeStore((s) => s.occurrencePoints.length)
  const search = useSpeciesSearch(allSpecies)

  if (!species) return null
  const fav = isFavorite(species.id)
  const statusColor = CONSERVATION_STATUS_COLORS[species.conservation_status]

  // Compare needs a SECOND, different species — not a toggle on the one
  // already open. Exclude the current species from its own picker results.
  const compareResults = comparePickerOpen
    ? (compareQuery.trim() ? search(compareQuery, 20) : allSpecies.slice(0, 20)).filter((s) => s.id !== species.id)
    : []

  function pickComparison(picked: SpeciesData): void {
    setComparisonSpecies(picked)
    setComparePickerOpen(false)
    setCompareQuery('')
  }

  return (
    <div className="flex flex-col">
      <div className="relative shrink-0">
        <SpeciesImage key={`${species.id}:${species.image_url ?? ''}`} species={species} />
        <button
          onClick={() => toggleFavorite(species)}
          title={fav ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={fav}
          className={`absolute top-2 right-2 h-control w-control rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))]/85 backdrop-blur-sm shadow-sm flex items-center justify-center hover:bg-[rgb(var(--bg-elevated))] transition-colors ${
            fav ? 'text-[rgb(var(--accent))]' : 'text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]'
          }`}
        >
          <IconStar size={16} fill={fav ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="p-4 border-b border-[rgb(var(--border))]">
        <h2 className="text-lg font-semibold leading-tight">{species.common_name}</h2>
        <p className="text-sm italic text-[rgb(var(--text-secondary))]">{species.scientific_name}</p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}` }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
            {CONSERVATION_STATUS_LABELS[species.conservation_status]}
          </span>
          <span className="text-xs text-[rgb(var(--text-secondary))]">{species.animal_group}</span>
        </div>
      </div>

      <nav className="flex border-b border-[rgb(var(--border))] overflow-x-auto scrollbar-thin">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs whitespace-nowrap border-b-2 ${
              tab === t.id
                ? 'border-[rgb(var(--accent))] text-[rgb(var(--text-primary))]'
                : 'border-transparent text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="p-4 text-sm space-y-3">
        {tab === 'overview' && (
          <>
            <p className="leading-relaxed">
              {species.description ||
                'No description yet — this species was opened from the live Red List browser rather than ' +
                  'the curated library. Use Refresh in the top bar to pull one from Wikipedia.'}
            </p>
            <dl className="grid grid-cols-2 gap-3 pt-2">
              <Fact label="Size" value={species.size_cm ? `${species.size_cm} cm` : null} />
              <Fact label="Lifespan" value={species.lifespan_years ? `${species.lifespan_years} yrs` : null} />
              <Fact label="Diet" value={species.diet || null} />
              <Fact label="Habitat" value={species.habitat || null} />
            </dl>
          </>
        )}

        {tab === 'geography' && (
          <>
            <Fact label="Continents (observed)" value={species.continents.join(', ') || null} />
            <Fact label="Habitat" value={species.habitat || null} />
            <Fact label="Occurrence points on globe" value={String(occurrenceCount)} />
            <p className="text-xs text-[rgb(var(--text-secondary))]">
              Occurrence points come from GBIF observation records, fetched automatically the first time you
              view a species. Use Refresh in the top bar any time to pull the latest.
            </p>
          </>
        )}

        {tab === 'behavior' && (
          <>
            <Fact label="Behavior" value={species.behavior || null} />
            <Fact label="Diet" value={species.diet || null} />
            {/* Uncurated species are inserted with migratory = 0, which used to
                render as a confident "No". With no curated behavior/diet copy
                there's no real migratory data either, so don't assert one. */}
            <Fact
              label="Migratory"
              value={species.behavior || species.diet ? (species.migratory ? 'Yes' : 'No') : null}
            />
          </>
        )}

        {tab === 'conservation' && (
          <>
            <Fact label="IUCN Red List status" value={CONSERVATION_STATUS_LABELS[species.conservation_status]} />
            <Fact
              label="Source"
              value={
                species.conservation_status_source === 'iucn'
                  ? 'IUCN Red List API (your token)'
                  : species.conservation_status_source === 'gbif-iucn'
                    ? 'IUCN Red List checklist, via GBIF'
                    : species.conservation_status_source === 'wikidata'
                      ? 'Wikidata (older lookup — refresh to update)'
                      : 'Seed estimate (not yet refreshed)'
              }
            />
            <p className="text-xs text-[rgb(var(--text-secondary))] leading-relaxed">
              {species.conservation_status_source
                ? 'Re-checked each time this species is refreshed. With your own IUCN API token (Settings), ' +
                  'the IUCN API is asked first for the very latest assessment.'
                : 'Hand-written placeholder from initial setup — it is replaced with the IUCN status the first ' +
                  'time this species is refreshed.'}
            </p>
          </>
        )}

        {tab === 'sources' && (
          <div className="flex flex-col items-start gap-2">
            {species.wikipedia_url ? (
              <a
                href={species.wikipedia_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline text-[rgb(var(--accent))]"
              >
                Wikipedia <IconExternalLink size={12} />
              </a>
            ) : (
              <p className="text-[rgb(var(--text-secondary))]">
                No Wikipedia link cached yet — use Refresh in the top bar to fetch one.
              </p>
            )}
            <a
              href={`https://www.iucnredlist.org/search?query=${encodeURIComponent(species.scientific_name)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline text-[rgb(var(--accent))]"
            >
              IUCN Red List <IconExternalLink size={12} />
            </a>
            <a
              href={`https://www.gbif.org/species/search?q=${encodeURIComponent(species.scientific_name)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline text-[rgb(var(--accent))]"
            >
              GBIF occurrence data <IconExternalLink size={12} />
            </a>
          </div>
        )}
      </div>

      <div className="relative p-4 pt-0">
        <div className="flex gap-2">
          {comparisonSpecies ? (
            <button
              onClick={() => setComparisonSpecies(null)}
              className="flex-1 h-control rounded-md border border-[rgb(var(--accent))] text-[rgb(var(--accent))] text-xs truncate px-2"
              title="Click to clear comparison"
            >
              Comparing with {comparisonSpecies.common_name} — clear
            </button>
          ) : (
            <button
              onClick={() => setComparePickerOpen((o) => !o)}
              className="flex-1 h-control rounded-md border border-[rgb(var(--border))] text-xs hover:bg-[rgb(var(--bg-elevated))]"
            >
              Compare on globe
            </button>
          )}
          <button
            onClick={requestScreenshot}
            className="flex-1 h-control rounded-md border border-[rgb(var(--border))] text-xs hover:bg-[rgb(var(--bg-elevated))]"
          >
            Export globe as image
          </button>
        </div>

        {comparePickerOpen && (
          // Inline (not an absolute popover): the species sheet is a scroll
          // container, so an upward popover could be clipped out of view.
          // The autofocused input scrolls it into view on open.
          <div className="mt-2 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--bg-elevated))] max-h-72 overflow-y-auto scrollbar-thin">
            <input
              autoFocus
              value={compareQuery}
              onChange={(e) => setCompareQuery(e.target.value)}
              placeholder="Search a species to compare…"
              className="w-full h-control px-3 text-sm bg-transparent border-b border-[rgb(var(--border))] focus:outline-none sticky top-0 bg-[rgb(var(--bg-elevated))]"
            />
            {compareResults.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[rgb(var(--text-secondary))]">No matches</p>
            ) : (
              compareResults.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pickComparison(s)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--bg-secondary))]"
                >
                  <SpeciesThumb species={s} size={24} />
                  <span className="truncate">{s.common_name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Shown instead of "Unknown" for fields that genuinely have no source for
// this species. Diet/behavior/size/lifespan only exist for the hand-curated
// library — no free structured source (GBIF, Wikidata) covers them at scale —
// so "Unknown" read like a bug; this states what's actually true.
const NOT_AVAILABLE = 'Not available for this species'

function Fact({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div>
      <dt className="text-3xs uppercase tracking-wide text-[rgb(var(--text-secondary))]">{label}</dt>
      {value ? (
        <dd className="text-sm">{value}</dd>
      ) : (
        <dd className="text-sm italic text-[rgb(var(--text-secondary))]">{NOT_AVAILABLE}</dd>
      )}
    </div>
  )
}
