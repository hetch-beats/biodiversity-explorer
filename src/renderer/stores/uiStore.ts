import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FontSize, ThemeId } from '../types'
import type { GlobeView } from '../globe/views'

export type ExploreTab = 'search' | 'browse' | 'filters'
// How a species' occurrence records are drawn on the globe.
export type OccurrenceDisplay = 'points' | 'heatmap'

interface UiState {
  theme: ThemeId
  // Phase 2c: the left Explore sheet (Search / Browse / Filters) is a docked
  // column, open by default. Replaces Phase 2a's floating `filtersPanelOpen`.
  exploreOpen: boolean
  exploreTab: ExploreTab
  colorblindMode: boolean
  highContrastMode: boolean
  fontSize: FontSize
  globeView: GlobeView
  // Stream NASA GIBS tiles for extra detail when zoomed in (needs internet).
  globeStreamDetail: boolean
  // Download and use the 8K textures for every view (Settings → Globe). The
  // installer doesn't ship them; turning this on fetches them once into app
  // data (see stores/textureStore.ts).
  globeHiRes: boolean
  occurrenceDisplay: OccurrenceDisplay
  // 16K satellite texture. Opt-in: ~700 MB of graphics memory with mipmaps,
  // and GIBS tiles already give far more detail when online.
  globeUltraDetail: boolean

  setTheme: (theme: ThemeId) => void
  toggleExplore: () => void
  setExploreOpen: (open: boolean) => void
  setExploreTab: (tab: ExploreTab) => void
  toggleColorblindMode: () => void
  toggleHighContrastMode: () => void
  setFontSize: (size: FontSize) => void
  setGlobeView: (view: GlobeView) => void
  setGlobeStreamDetail: (on: boolean) => void
  setGlobeHiRes: (on: boolean) => void
  setOccurrenceDisplay: (mode: OccurrenceDisplay) => void
  setGlobeUltraDetail: (on: boolean) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      // 'daylight' (light), not a dark theme — see "Aesthetics — research
      // rationale" in biodiversity-explorer-phase2-spec.md.
      theme: 'daylight',
      exploreOpen: true,
      exploreTab: 'search',
      colorblindMode: false,
      highContrastMode: false,
      fontSize: 'medium',
      globeView: 'satellite',
      globeStreamDetail: true,
      globeHiRes: false,
      occurrenceDisplay: 'points',
      globeUltraDetail: false,

      setTheme: (theme) => set({ theme }),
      toggleExplore: () => set((s) => ({ exploreOpen: !s.exploreOpen })),
      setExploreOpen: (open) => set({ exploreOpen: open }),
      setExploreTab: (exploreTab) => set({ exploreTab, exploreOpen: true }),
      toggleColorblindMode: () => set((s) => ({ colorblindMode: !s.colorblindMode })),
      toggleHighContrastMode: () => set((s) => ({ highContrastMode: !s.highContrastMode })),
      setFontSize: (fontSize) => set({ fontSize }),
      setGlobeView: (globeView) => set({ globeView }),
      setGlobeStreamDetail: (globeStreamDetail) => set({ globeStreamDetail }),
      setGlobeHiRes: (globeHiRes) => set({ globeHiRes }),
      setOccurrenceDisplay: (occurrenceDisplay) => set({ occurrenceDisplay }),
      setGlobeUltraDetail: (globeUltraDetail) => set({ globeUltraDetail })
    }),
    {
      name: 'biodiversity-explorer-ui-settings',
      version: 6,
      migrate: (persisted, version) => {
        const state = persisted as { theme?: string } & Record<string, unknown>
        // v1 only persisted theme: 'light' | 'dark'.
        if (version < 2 && state?.theme) {
          if (state.theme === 'dark') state.theme = 'obsidian'
          else if (state.theme === 'light') state.theme = 'daylight'
        }
        // v3: floating filters panel -> docked Explore sheet (open by default).
        if (version < 3) {
          delete state.filtersPanelOpen
          delete state.sidebarOpen
          state.exploreOpen = true
          state.exploreTab = 'search'
        }
        // v4: globe imagery settings (defaults apply — nothing to carry over).
        if (version < 4) {
          state.globeView = 'satellite'
          state.globeStreamDetail = true
          state.globeUltraDetail = false
        }
        // v5: on-demand 8K imagery download (off until the user asks for it).
        if (version < 5) state.globeHiRes = false
        // v6: points / heatmap occurrence display.
        if (version < 6) state.occurrenceDisplay = 'points'
        return state as unknown as UiState
      }
    }
  )
)

/*
 * Mirror theme / accessibility settings onto <html> as data attributes, which
 * globals.css keys off (palette, contrast, colorblind accent, and the root
 * font-size that every rem-based token scales from). Done here rather than
 * in a React effect so the persisted values — read synchronously from
 * localStorage when the store is created — apply before the first paint,
 * with no flash of the default size/theme on startup.
 */
function applyDocumentSettings(s: UiState): void {
  const root = document.documentElement
  root.setAttribute('data-theme', s.theme)
  root.setAttribute('data-colorblind', String(s.colorblindMode))
  root.setAttribute('data-contrast', s.highContrastMode ? 'high' : 'normal')
  root.setAttribute('data-font-size', s.fontSize)
}
applyDocumentSettings(useUiStore.getState())
useUiStore.subscribe(applyDocumentSettings)
