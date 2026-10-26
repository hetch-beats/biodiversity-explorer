import { contextBridge, ipcRenderer } from 'electron'
import type { TextureStatus, TextureTier } from '../main/services/globeTextures'

/**
 * The only surface the renderer ever touches. contextIsolation is on and
 * nodeIntegration is off in the BrowserWindow (see src/main/index.ts), so
 * this is the sole bridge between untrusted renderer code and Node/Electron
 * main-process APIs. Every call is a named, whitelisted IPC round trip —
 * the renderer can never reach ipcRenderer, fs, or require() directly.
 */
const api = {
  // Species data
  getAllSpecies: () => ipcRenderer.invoke('db:getAllSpecies'),
  getSpeciesDetails: (speciesId: string) => ipcRenderer.invoke('db:getSpeciesDetails', speciesId),
  getOccurrences: (speciesId: string) => ipcRenderer.invoke('db:getOccurrences', speciesId),

  // Favorites
  addFavorite: (speciesId: string) => ipcRenderer.invoke('db:addFavorite', speciesId),
  removeFavorite: (speciesId: string) => ipcRenderer.invoke('db:removeFavorite', speciesId),
  getFavorites: () => ipcRenderer.invoke('db:getFavorites'),

  // Search history
  getSearchHistory: (limit?: number) => ipcRenderer.invoke('db:getSearchHistory', limit),
  addSearchHistory: (speciesId: string | null, term: string) =>
    ipcRenderer.invoke('db:addSearchHistory', speciesId, term),
  clearSearchHistory: () => ipcRenderer.invoke('db:clearSearchHistory'),

  // Data sync
  refreshSpeciesData: (speciesId?: string) => ipcRenderer.invoke('sync:refreshData', speciesId),
  getLastSync: () => ipcRenderer.invoke('sync:getLastSync'),
  onSyncComplete: (callback: (status: { status: string; message: string; count?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: any) => callback(data)
    ipcRenderer.on('sync:complete', listener)
    // Braced body, not an implicit return: ipcRenderer.removeListener()
    // itself returns Electron.IpcRenderer (for chaining), which would
    // otherwise make this a `() => IpcRenderer` closure instead of the
    // `() => void` cleanup function React's useEffect requires.
    return () => {
      ipcRenderer.removeListener('sync:complete', listener)
    }
  },

  // Lightweight detail fill (image with credit, description, habitat) — no occurrence download.
  ensureSpeciesDetails: (speciesId: string) => ipcRenderer.invoke('species:ensureDetails', speciesId),

  // Settings: IUCN API token (optional; IUCN's checklist on GBIF is the
  // keyless default — see src/main/services/conservationStatus.ts)
  getIucnToken: () => ipcRenderer.invoke('settings:getIucnToken'),
  setIucnToken: (token: string | null) => ipcRenderer.invoke('settings:setIucnToken', token),

  // Browse the IUCN Red List (animals), paged, from IUCN's checklist on GBIF.
  browseRedList: (status: string, offset = 0, limit = 100, forceRefresh = false, fromBundled = false) =>
    ipcRenderer.invoke('browse:redList', status, offset, limit, forceRefresh, fromBundled),
  ensureSpecies: (scientificName: string, status: string, commonName?: string | null, gbifKey?: number | null) =>
    ipcRenderer.invoke('browse:ensureSpecies', scientificName, status, commonName, gbifKey),
  // Instant, local, cross-status search over every Red List taxon this
  // install has cached/bundled — see src/main/services/redListSearch.ts.
  // This is what the main search bar uses so there's one search surface
  // instead of a separate curated-library search and Red List browser.
  searchRedListTaxa: (query: string, limit?: number) => ipcRenderer.invoke('search:redListTaxa', query, limit),

  // Globe imagery (8K/16K textures, downloaded on demand into app data).
  getTextureStatus: (): Promise<TextureStatus> => ipcRenderer.invoke('textures:getStatus'),
  downloadTextures: (tiers: TextureTier[]): Promise<TextureStatus> => ipcRenderer.invoke('textures:download', tiers),
  onTextureStatus: (callback: (status: TextureStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: TextureStatus) => callback(data)
    ipcRenderer.on('textures:status', listener)
    return () => {
      ipcRenderer.removeListener('textures:status', listener)
    }
  },

  // App info
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates')
}

contextBridge.exposeInMainWorld('api', api)

export type BiodiversityAPI = typeof api
