/*
 * Main-window sizing. The window is freely resizable and maximizable; the
 * React layout is fluid (flex columns + a ResizeObserver-driven globe
 * canvas), so it fills whatever size the window is, maximized included.
 *
 * - Minimum 1024×640: the common desktop-app floor (1024 px wide is the
 *   classic minimum supported width; 640 tall fits 1366×768 laptops with a
 *   taskbar), clamped to the screen on anything smaller.
 * - First launch: 1440×900 or 90% of the screen's work area, whichever is
 *   smaller, centred.
 * - Later launches restore the last size, position and maximized state, as
 *   long as that position is still on a connected display.
 */
import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MIN_WIDTH = 1024
export const MIN_HEIGHT = 640

interface SavedState {
  bounds: Rectangle
  maximized: boolean
}

const stateFile = (): string => join(app.getPath('userData'), 'window-state.json')

function readSaved(): SavedState | null {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as SavedState
    const b = s?.bounds
    if (![b?.x, b?.y, b?.width, b?.height].every((n) => Number.isFinite(n))) return null
    // Only restore onto a display that still exists (monitor unplugged, etc.).
    const area = screen.getDisplayMatching(b).workArea
    const visible =
      b.x < area.x + area.width - 64 && b.x + b.width > area.x + 64 && b.y >= area.y - 8 && b.y < area.y + area.height - 64
    return visible ? s : null
  } catch {
    return null
  }
}

/** BrowserWindow size options for the next window, plus whether to maximize it once shown. */
export function initialWindowOptions(): {
  options: { x?: number; y?: number; width: number; height: number; minWidth: number; minHeight: number }
  maximize: boolean
} {
  const area = screen.getPrimaryDisplay().workArea
  const minWidth = Math.min(MIN_WIDTH, area.width)
  const minHeight = Math.min(MIN_HEIGHT, area.height)
  const saved = readSaved()
  if (saved) {
    const { x, y, width, height } = saved.bounds
    return {
      options: { x, y, width: Math.max(width, minWidth), height: Math.max(height, minHeight), minWidth, minHeight },
      maximize: saved.maximized
    }
  }
  const width = Math.max(minWidth, Math.min(1440, Math.round(area.width * 0.9)))
  const height = Math.max(minHeight, Math.min(900, Math.round(area.height * 0.9)))
  return { options: { width, height, minWidth, minHeight }, maximize: false }
}

/** Save size/position/maximized on close. Uses the normal (un-maximized) bounds so restore-down works. */
export function trackWindowState(win: BrowserWindow): void {
  win.on('close', () => {
    try {
      const state: SavedState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
      writeFileSync(stateFile(), JSON.stringify(state))
    } catch (err) {
      console.warn('[window] could not save window state:', err)
    }
  })
}
