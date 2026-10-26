import dns from 'node:dns'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { getDb } from './database/init'
import { initHttpCache } from './net/http'
import { registerIpcHandlers } from './ipc/handlers'
import { startWeeklySchedule } from './services/dataSync'
import { registerGlobeTextureProtocol, registerTextureScheme } from './services/globeTextures'
import { initialWindowOptions, trackWindowState } from './windowState'
// ?asset: electron-vite copies the file into the build and gives its path at runtime.
import appIcon from '../../build/icon.png?asset'

// Node's http/https/fetch stack — unlike browsers, which implement Happy
// Eyeballs (RFC 8305) — can stall for tens of seconds on a broken or slow
// IPv6 route before ever falling back to IPv4, even when IPv4 to the same
// host is instant. Confirmed as the real cause of what looked like a
// Wikidata SPARQL query timeout: every one of our query shapes (including
// after removing ORDER BY and restructuring into a subquery) timed out from
// axios in this app, but the exact same query returned 500 rows in well
// under a second when pasted into Wikidata's own browser-based query GUI —
// i.e. the query was never the problem. Forcing IPv4-first DNS resolution
// process-wide fixes this class of issue without touching any individual
// request. Safe with no IPv6 downside: any host reachable over IPv6 alone is
// still resolved and used, this only changes which address family is tried
// first when both are available.
dns.setDefaultResultOrder('ipv4first')

// Without these, a bug anywhere in the main process (a bad DB write, a
// rejected promise nobody awaited) silently kills the process with nothing
// but a line in a terminal the user isn't looking at — the app just
// vanishes with no explanation. A visible dialog beats a silent exit, even
// though the underlying bug still needs fixing; this is a last-resort net,
// not a substitute for the try/catch blocks throughout the codebase.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception:', err)
  dialog.showErrorBox('Biodiversity Explorer — unexpected error', err.message || String(err))
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled promise rejection:', reason)
})

// globe-texture:// serves the 8K/16K globe imagery (downloaded on demand or
// bundled); custom schemes must be declared before the app is ready.
registerTextureScheme()

// electron-vite sets this env var automatically when running `electron-vite dev`
const isDev = !app.isPackaged
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL']

function createWindow(): BrowserWindow {
  const { options: size, maximize } = initialWindowOptions()
  const win = new BrowserWindow({
    ...size,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    // Title bar / taskbar icon while running (the "BE" monogram, build/icon.png).
    icon: appIcon,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: isDev
    }
  })

  win.once('ready-to-show', () => {
    if (maximize) win.maximize()
    win.show()
  })
  trackWindowState(win)

  // Open external links (Wikipedia, IUCN, GitHub) in the OS browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (rendererDevUrl) {
    win.loadURL(rendererDevUrl)
    if (isDev) win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  try {
    const db = getDb()
    initHttpCache(db)
    registerGlobeTextureProtocol()
    const mainWindow = createWindow()

    registerIpcHandlers(db)
    startWeeklySchedule(db, mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  } catch (err) {
    // Most likely cause: the local SQLite file is corrupt, or the app-data
    // folder isn't writable (permissions, a full disk, a locked file from
    // another running instance). Without this catch, `getDb()` throwing
    // here would fail silently — no window, no error, the app just never
    // appears — which is exactly the kind of unexplained failure this pass
    // is meant to close out before the next phase.
    console.error('[main] failed to start:', err)
    dialog.showErrorBox(
      'Biodiversity Explorer — failed to start',
      `${(err as Error).message}\n\nIf this persists, the local database file may be corrupted. ` +
        `It's safe to delete and let the app recreate it (your species library will reseed, but any ` +
        `custom data — favorites, search history, an added IUCN token — will be lost).`
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
