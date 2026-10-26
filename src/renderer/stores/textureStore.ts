import { create } from 'zustand'
import type { TextureStatus, TextureTier } from '../../main/services/globeTextures'
import { useUiStore } from './uiStore'

/*
 * Globe imagery availability and the on-demand 8K/16K download (main process:
 * src/main/services/globeTextures.ts). `revision` bumps whenever a download
 * finishes, so the globe and the view switcher re-check what's on disk
 * without a restart.
 */
interface TextureState {
  status: TextureStatus | null
  revision: number
  download: (tiers: TextureTier[]) => void
}

export const useTextureStore = create<TextureState>((set) => ({
  status: null,
  revision: 0,
  download: (tiers) => {
    window.api.downloadTextures(tiers).catch((err) => console.error('[textures] download failed:', err))
  }
}))

function apply(status: TextureStatus): void {
  const prev = useTextureStore.getState().status
  const finished = prev?.job?.state === 'running' && status.job?.state !== 'running'
  useTextureStore.setState((s) => ({ status, revision: finished ? s.revision + 1 : s.revision }))
}

/**
 * Tiers the user has asked for (Settings toggles) that aren't on disk yet.
 * 16K is only wanted with 8K imagery on — it replaces the 8K satellite view.
 */
function wantedMissing(status: TextureStatus): TextureTier[] {
  const ui = useUiStore.getState()
  const tiers: TextureTier[] = []
  if (ui.globeHiRes && !status.have['8k']) tiers.push('8k')
  if (ui.globeHiRes && ui.globeUltraDetail && !status.have['16k']) tiers.push('16k')
  return tiers
}

/** Start a download for anything requested but missing (toggle pressed, or an interrupted run). */
function ensureWanted(): void {
  const status = useTextureStore.getState().status
  if (!status || status.job?.state === 'running') return
  const tiers = wantedMissing(status)
  if (tiers.length) useTextureStore.getState().download(tiers)
}

window.api.onTextureStatus(apply)
window.api
  .getTextureStatus()
  .then((status) => {
    apply(status)
    ensureWanted() // resumes a download the app was closed during
  })
  .catch((err) => console.error('[textures] status check failed:', err))

useUiStore.subscribe((s, prev) => {
  if (s.globeHiRes !== prev.globeHiRes || s.globeUltraDetail !== prev.globeUltraDetail) ensureWanted()
})
