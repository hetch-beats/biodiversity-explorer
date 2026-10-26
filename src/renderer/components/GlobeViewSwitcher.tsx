import { useEffect, useState } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useGlobeStore } from '../stores/globeStore'
import { useTextureStore } from '../stores/textureStore'
import { VIEWS, VIEW_ORDER, textureUrl, type GlobeView } from '../globe/views'
import { IconLoaderCircle } from './icons'

const FETCH_HINT = 'Not downloaded yet: turn on Settings → Globe → 8K globe imagery'

/**
 * Base-map picker over the globe. Each button's thumbnail doubles as the
 * download check: a view whose preview image is missing hasn't been
 * downloaded yet (Settings → Globe → 8K globe imagery, or the dev script
 * scripts/fetch-globe-textures.mjs), so it's disabled with a hint instead of
 * failing silently. Satellite always works (bundled 4K fallback).
 */
export default function GlobeViewSwitcher({ overlayClass }: { overlayClass: string }): JSX.Element {
  const view = useUiStore((s) => s.globeView)
  const setView = useUiStore((s) => s.setGlobeView)
  const imagery = useGlobeStore((s) => s.imagery)
  const [missing, setMissing] = useState<Partial<Record<GlobeView, boolean>>>({})
  const revision = useTextureStore((s) => s.revision)
  const job = useTextureStore((s) => s.status?.job)
  // A finished download may have added previews: re-check them all.
  useEffect(() => setMissing({}), [revision])

  const shown = imagery.view ? VIEWS[imagery.view] : null
  let note: string | null = null
  if (job?.state === 'running') note = `Downloading 8K imagery… ${job.percent === null ? '' : `${job.percent}%`}`
  else if (job?.state === 'error') note = `8K imagery download failed — retry in Settings → Globe.`
  else if (imagery.loaded === 'legacy-4k') note = 'Standard 4K imagery. Turn on 8K globe imagery in Settings.'
  else if (imagery.loaded === 'none') note = 'No Earth imagery yet. Turn on 8K globe imagery in Settings.'

  return (
    // Positioned by Globe.tsx's bottom overlay row.
    <div className={`p-1.5 flex flex-col gap-1.5 max-w-[248px] ${overlayClass}`}>
      <div role="group" aria-label="Map view" className="flex gap-1">
        {VIEW_ORDER.map((id) => {
          const spec = VIEWS[id]
          const active = view === id
          const unavailable = !!missing[id] && id !== 'satellite'
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              disabled={unavailable}
              aria-pressed={active}
              title={unavailable ? FETCH_HINT : spec.label}
              className={`w-14 flex flex-col items-center gap-0.5 rounded-md p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                active
                  ? 'bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))]'
                  : 'text-[rgb(var(--text-secondary))] enabled:hover:bg-[rgb(var(--bg-elevated))] enabled:hover:text-[rgb(var(--text-primary))]'
              }`}
            >
              <span
                className={`relative block h-6 w-12 overflow-hidden rounded-sm border bg-[rgb(var(--bg-elevated))] ${
                  active ? 'border-[rgb(var(--accent))]' : 'border-[rgb(var(--border))]'
                }`}
              >
                {!missing[id] && (
                  <img
                    src={textureUrl(spec.preview, revision)}
                    alt=""
                    draggable={false}
                    className="h-full w-full object-cover"
                    onError={() => setMissing((m) => ({ ...m, [id]: true }))}
                  />
                )}
                {active && imagery.loading && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                    <IconLoaderCircle size={12} className="animate-spin text-white" />
                  </span>
                )}
              </span>
              <span className="text-3xs leading-tight whitespace-nowrap">{spec.label}</span>
            </button>
          )
        })}
      </div>
      {note ? (
        <p className="px-1 text-3xs leading-snug text-[rgb(var(--text-secondary))]">{note}</p>
      ) : (
        shown && (
          <p className="px-1 text-3xs leading-snug text-[rgb(var(--text-secondary))]">
            <a
              href={shown.creditUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:underline"
              title={shown.credit}
            >
              {shown.credit}
            </a>
            {imagery.loaded === '16k' && ' · 16K'}
            {imagery.tilesActive && shown.tiles && ` · ${shown.tiles.credit}`}
          </p>
        )
      )}
    </div>
  )
}
