import { useState } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useSpeciesStore } from '../stores/speciesStore'
import { useGlobeStore } from '../stores/globeStore'
import { Button, IconButton } from './ui'
import { IconPanelLeftClose, IconPanelLeftOpen, IconRefreshCw, IconSettings } from './icons'

interface TopBarProps {
  onOpenSettings: () => void
}

export default function TopBar({ onOpenSettings }: TopBarProps): JSX.Element {
  const exploreOpen = useUiStore((s) => s.exploreOpen)
  const toggleExplore = useUiStore((s) => s.toggleExplore)
  const selectedSpecies = useSpeciesStore((s) => s.selectedSpecies)
  const setSelectedSpecies = useSpeciesStore((s) => s.setSelectedSpecies)
  const loadAllSpecies = useSpeciesStore((s) => s.loadAllSpecies)
  const loadOccurrences = useGlobeStore((s) => s.loadOccurrences)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)

  async function handleRefresh(): Promise<void> {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      // Refresh whichever species is currently open (if any) so GBIF
      // occurrences + the Wikipedia summary come back up to date for it,
      // instead of only ever touching the fixed default sync batch.
      const result = await window.api.refreshSpeciesData(selectedSpecies?.id)
      console.log('[refresh]', result.message)
      setRefreshMsg(
        result.status === 'success' ? (result.count > 0 ? `${result.count} pts found` : 'No GBIF data found') : 'Refresh failed'
      )

      await loadAllSpecies()
      if (selectedSpecies) {
        const updated = await window.api.getSpeciesDetails(selectedSpecies.id)
        if (updated) setSelectedSpecies(updated)
        await loadOccurrences(selectedSpecies.id)
      }
    } catch {
      setRefreshMsg('Refresh failed')
    } finally {
      setRefreshing(false)
      setTimeout(() => setRefreshMsg(null), 3000)
    }
  }

  return (
    <header className="h-12 shrink-0 flex items-center gap-2 px-2 border-b border-[rgb(var(--border))] bg-[rgb(var(--bg-secondary))]">
      <IconButton
        label={exploreOpen ? 'Hide explore panel' : 'Show explore panel'}
        onClick={toggleExplore}
        aria-pressed={exploreOpen}
      >
        {exploreOpen ? <IconPanelLeftClose size={18} /> : <IconPanelLeftOpen size={18} />}
      </IconButton>

      <button
        onClick={() => setSelectedSpecies(null)}
        className="px-1 text-sm font-semibold tracking-tight shrink-0 hover:opacity-80 transition-opacity"
        title="Back to home"
      >
        Biodiversity Explorer
      </button>

      {/* Search / Browse / Filters live in the docked Explore sheet
          (ExploreSheet.tsx), so this stays a minimal strip. */}
      <div className="flex-1" />

      <Button
        variant="ghost"
        onClick={handleRefresh}
        disabled={refreshing}
        title={selectedSpecies ? `Refresh ${selectedSpecies.common_name} from GBIF` : 'Refresh species data from GBIF'}
      >
        <IconRefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Refreshing…' : refreshMsg ?? 'Refresh'}
      </Button>

      <IconButton label="Settings" onClick={onOpenSettings}>
        <IconSettings size={18} />
      </IconButton>
    </header>
  )
}
