import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUiStore } from '../stores/uiStore'
import { useGlobeStore } from '../stores/globeStore'
import { useTextureStore } from '../stores/textureStore'
import { THEME_LABELS, THEME_ORDER, THEME_SWATCHES } from '../constants'
import { IconCheck, IconCircleAlert, IconExternalLink, IconEye, IconEyeOff, IconLoaderCircle, IconX } from './icons'
import type { FontSize } from '../types'
import type { TextureStatus } from '../../main/services/globeTextures'

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const colorblindMode = useUiStore((s) => s.colorblindMode)
  const toggleColorblindMode = useUiStore((s) => s.toggleColorblindMode)
  const highContrastMode = useUiStore((s) => s.highContrastMode)
  const toggleHighContrastMode = useUiStore((s) => s.toggleHighContrastMode)
  const fontSize = useUiStore((s) => s.fontSize)
  const setFontSize = useUiStore((s) => s.setFontSize)
  const streamDetail = useUiStore((s) => s.globeStreamDetail)
  const setStreamDetail = useUiStore((s) => s.setGlobeStreamDetail)
  const ultraDetail = useUiStore((s) => s.globeUltraDetail)
  const setUltraDetail = useUiStore((s) => s.setGlobeUltraDetail)
  const hiRes = useUiStore((s) => s.globeHiRes)
  const setHiRes = useUiStore((s) => s.setGlobeHiRes)
  const textureStatus = useTextureStore((s) => s.status)
  const downloadTextures = useTextureStore((s) => s.download)
  const gpu = useGlobeStore((s) => s.gpu)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  // App passes an inline arrow, so onClose's identity changes every render;
  // reading it through a ref keeps the effect below mount-only.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Modal behavior: Esc closes, focus moves into the dialog on open and back
  // to whatever opened it on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [])

  const [version, setVersion] = useState('–')
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)

  const [iucnToken, setIucnTokenInput] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)
  const [tokenStatus, setTokenStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [savingToken, setSavingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    window.api.getAppVersion().then(setVersion).catch((err) => console.error('Failed to read app version:', err))
    window.api.getLastSync().then(setLastSync).catch((err) => console.error('Failed to read last sync time:', err))
    window.api
      .getIucnToken()
      .then((token) => {
        if (token) {
          setIucnTokenInput(token)
          setTokenSaved(true)
        }
      })
      .catch((err) => console.error('Failed to read saved IUCN token:', err))
  }, [])

  async function handleSaveToken(): Promise<void> {
    setSavingToken(true)
    setTokenStatus(null)
    try {
      const trimmed = iucnToken.trim()
      const result = await window.api.setIucnToken(trimmed || null)
      setTokenSaved(!!trimmed)
      if (trimmed) {
        setTokenStatus({ ok: result.validated, message: result.message ?? '' })
      }
    } catch (err) {
      console.error('Failed to save IUCN token:', err)
      setTokenStatus({ ok: false, message: "Couldn't save the token — try again." })
    } finally {
      setSavingToken(false)
    }
  }

  async function handleRemoveToken(): Promise<void> {
    setSavingToken(true)
    try {
      await window.api.setIucnToken(null)
      setIucnTokenInput('')
      setTokenSaved(false)
      setTokenStatus(null)
    } catch (err) {
      console.error('Failed to remove IUCN token:', err)
      setTokenStatus({ ok: false, message: "Couldn't remove the token — try again." })
    } finally {
      setSavingToken(false)
    }
  }

  async function handleCheckUpdates(): Promise<void> {
    setChecking(true)
    try {
      const result = await window.api.checkForUpdates()
      setUpdateMsg(result.updateAvailable ? 'Update available' : 'You’re up to date')
    } catch (err) {
      console.error('Failed to check for updates:', err)
      setUpdateMsg("Couldn't check for updates")
    } finally {
      setChecking(false)
    }
  }

  return (
    // z-50: the only layer allowed to cover the whole app (see App.tsx).
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 animate-[fadein_150ms_ease-out]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] max-h-[85vh] flex flex-col rounded-xl bg-[rgb(var(--bg-secondary))] border border-[rgb(var(--border))] shadow-2xl animate-[fadein_150ms_ease-out]"
      >
        <div className="flex items-center justify-between px-5 h-14 shrink-0 border-b border-[rgb(var(--border))]">
          <h2 id="settings-title" className="text-sm font-semibold">
            Settings
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close settings"
            className="h-control w-control flex items-center justify-center rounded-md text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--bg-elevated))]"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-5 space-y-6 text-sm">
          <section>
            <h3 className="text-3xs font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))] mb-2">Theme</h3>
            <div className="grid grid-cols-4 gap-2">
              {THEME_ORDER.map((t) => {
                const swatch = THEME_SWATCHES[t]
                const active = theme === t
                return (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    aria-pressed={active}
                    aria-label={`${THEME_LABELS[t]} theme`}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors ${
                      active ? 'border-[rgb(var(--accent))]' : 'border-[rgb(var(--border))] hover:border-[rgb(var(--text-secondary))]'
                    }`}
                  >
                    <span
                      className="h-7 w-full rounded-md border border-black/10 flex items-center justify-center"
                      style={{ backgroundColor: swatch.bg }}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: swatch.accent }}
                      />
                    </span>
                    <span className={`text-2xs ${active ? 'text-[rgb(var(--accent))]' : ''}`}>
                      {THEME_LABELS[t]}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <h3 className="text-3xs font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))] mb-2">Accessibility</h3>
            <label className="flex items-center justify-between py-1.5 cursor-pointer">
              <span>Colorblind-safe palette</span>
              <input type="checkbox" checked={colorblindMode} onChange={toggleColorblindMode} className="accent-[rgb(var(--accent))]" />
            </label>
            <label className="flex items-center justify-between py-1.5 cursor-pointer">
              <span>High contrast</span>
              <input type="checkbox" checked={highContrastMode} onChange={toggleHighContrastMode} className="accent-[rgb(var(--accent))]" />
            </label>
            <div className="pt-2">
              <div className="text-xs text-[rgb(var(--text-secondary))] mb-1.5">Font size</div>
              <div className="flex gap-2">
                {(['small', 'medium', 'large'] as FontSize[]).map((size) => (
                  <button
                    key={size}
                    onClick={() => setFontSize(size)}
                    aria-pressed={fontSize === size}
                    className={`flex-1 h-control rounded-md border text-xs capitalize ${
                      fontSize === size ? 'border-[rgb(var(--accent))] text-[rgb(var(--accent))]' : 'border-[rgb(var(--border))]'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-3xs font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))] mb-2">Globe</h3>
            <HiResRow
              on={hiRes || !!textureStatus?.have['8k']}
              downloaded={!!textureStatus?.have['8k']}
              job={textureStatus?.job ?? null}
              onToggle={setHiRes}
              onRetry={() => downloadTextures(ultraDetail ? ['8k', '16k'] : ['8k'])}
            />
            <label className="flex items-start justify-between gap-4 py-1.5 cursor-pointer">
              <span>
                Sharper imagery when zoomed in
                <span className="block text-xs text-[rgb(var(--text-secondary))]">
                  Streams NASA GIBS tiles for the Satellite and Night lights views. Needs internet; the downloaded
                  imagery is used offline.
                </span>
              </span>
              <input
                type="checkbox"
                checked={streamDetail}
                onChange={(e) => setStreamDetail(e.target.checked)}
                className="mt-1 accent-[rgb(var(--accent))]"
              />
            </label>
            <label
              className={`flex items-start justify-between gap-4 py-1.5 ${gpu?.supports16k ? 'cursor-pointer' : 'opacity-60'}`}
            >
              <span>
                16K satellite texture
                <span className="block text-xs text-[rgb(var(--text-secondary))]">
                  {gpu && !gpu.supports16k
                    ? gpu.software
                      ? 'Not available: graphics are running in software mode.'
                      : `Not available: this graphics card supports textures up to ${gpu.maxTextureSize.toLocaleString()} px.`
                    : !hiRes && !textureStatus?.have['16k']
                      ? 'Turn on 8K globe imagery first.'
                      : 'Sharper offline detail (one more download of the Blue Marble source). Uses about 700 MB of graphics memory, ' +
                        'so leave it off on laptops with integrated graphics.'}
                </span>
              </span>
              <input
                type="checkbox"
                checked={ultraDetail && !!gpu?.supports16k}
                disabled={!gpu?.supports16k || (!hiRes && !textureStatus?.have['16k'])}
                onChange={(e) => setUltraDetail(e.target.checked)}
                className="mt-1 accent-[rgb(var(--accent))]"
              />
            </label>
          </section>

          <section>
            <h3 className="text-3xs font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))] mb-2">Data</h3>
            <p className="text-xs text-[rgb(var(--text-secondary))]">
              Last synced: {lastSync ? new Date(lastSync).toLocaleString() : 'never'}
            </p>
            <p className="text-xs text-[rgb(var(--text-secondary))] mt-1">
              Species data refreshes automatically once a week in the background, or any time via the
              Refresh button in the top bar.
            </p>
          </section>

          <section>
            <h3 className="text-3xs font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))] mb-2">
              Conservation status data
            </h3>
            <p className="text-xs text-[rgb(var(--text-secondary))] leading-relaxed">
              By default, conservation status and the Browse lists come from{' '}
              <a
                href="https://www.gbif.org/dataset/19491596-35ae-4a91-9a98-85cf505f1bd3"
                target="_blank"
                rel="noreferrer"
                className="underline text-[rgb(var(--accent))]"
              >
                the IUCN Red List checklist
              </a>{' '}
              that IUCN publishes on GBIF — free, no account needed. For the very latest assessments, add your own
              IUCN API token below; it's asked first, with the checklist as the fallback.
            </p>

            <div className="mt-3 flex gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                value={iucnToken}
                onChange={(e) => {
                  setIucnTokenInput(e.target.value)
                  setTokenStatus(null)
                }}
                placeholder="Paste your IUCN API token"
                className="flex-1 h-control px-2 text-xs rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--bg-primary))] text-[rgb(var(--text-primary))] placeholder:text-[rgb(var(--text-secondary))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))]"
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="h-control w-control flex items-center justify-center rounded-md border border-[rgb(var(--border))] text-[rgb(var(--text-secondary))] hover:bg-[rgb(var(--bg-elevated))]"
                title={showToken ? 'Hide token' : 'Show token'}
                aria-label={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
            </div>

            <div className="mt-2 flex gap-2">
              <button
                onClick={handleSaveToken}
                disabled={savingToken || !iucnToken.trim()}
                className="h-control px-3 rounded-md border border-[rgb(var(--border))] text-xs hover:bg-[rgb(var(--bg-elevated))] disabled:opacity-50"
              >
                {savingToken ? 'Checking…' : 'Save & verify'}
              </button>
              {tokenSaved && (
                <button
                  onClick={handleRemoveToken}
                  disabled={savingToken}
                  className="h-control px-3 rounded-md border border-[rgb(var(--border))] text-xs hover:bg-[rgb(var(--bg-elevated))] disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>

            {tokenStatus && (
              <p
                className="mt-2 flex items-start gap-1.5 text-xs"
                style={{ color: tokenStatus.ok ? 'rgb(22 163 74)' : 'rgb(220 38 38)' }}
              >
                {tokenStatus.ok ? <IconCheck size={14} className="mt-px shrink-0" /> : <IconCircleAlert size={14} className="mt-px shrink-0" />}
                {tokenStatus.message}
              </p>
            )}

            <details className="mt-3 text-xs text-[rgb(var(--text-secondary))]">
              <summary className="cursor-pointer text-[rgb(var(--accent))]">How do I get a token?</summary>
              <ol className="mt-2 ml-4 list-decimal space-y-1 leading-relaxed">
                <li>
                  Go to{' '}
                  <a
                    href="https://api.iucnredlist.org/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-[rgb(var(--accent))]"
                  >
                    api.iucnredlist.org
                  </a>{' '}
                  and click through to registration.
                </li>
                <li>Create a free account and request API access (approval is typically automatic or same-day).</li>
                <li>Copy the token from your account page once it's issued.</li>
                <li>Paste it above and click "Save &amp; verify".</li>
              </ol>
              <p className="mt-2 leading-relaxed">
                This token is your own — it's stored only in this app's local database on your computer, sent
                only to api.iucnredlist.org, and never bundled with or shared by the app itself. The IUCN API's
                terms restrict use to non-commercial purposes and tie access to the person who registered it,
                which is why every user needs their own token rather than one built into the app.
              </p>
            </details>
          </section>

          <section>
            <h3 className="text-3xs font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))] mb-2">About</h3>
            <p className="text-xs">Version {version}</p>
            <button
              onClick={handleCheckUpdates}
              disabled={checking}
              className="mt-2 h-control px-3 rounded-md border border-[rgb(var(--border))] text-xs hover:bg-[rgb(var(--bg-elevated))] disabled:opacity-50"
            >
              {checking ? 'Checking…' : updateMsg ?? 'Check for updates'}
            </button>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs underline text-[rgb(var(--accent))]"
            >
              View source on GitHub <IconExternalLink size={12} />
            </a>
            <p className="mt-4 text-3xs leading-relaxed text-[rgb(var(--text-secondary))]">
              Occurrence data and species images via GBIF.org (each image credited with its creator and
              license). Red List data © IUCN, via GBIF. Descriptions from Wikipedia (CC BY-SA). Some
              historical images from Wikimedia Commons. This app is free, open source, and collects no
              personal data.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

/**
 * Settings → Globe → 8K imagery. Installed builds ship only the 4K satellite
 * texture; switching this on downloads the 8K set for every view once (about
 * 230 MB of source files, deleted once resized) and the globe picks it up live.
 */
function HiResRow({
  on,
  downloaded,
  job,
  onToggle,
  onRetry
}: {
  on: boolean
  downloaded: boolean
  job: TextureStatus['job']
  onToggle: (on: boolean) => void
  onRetry: () => void
}): JSX.Element {
  const running = job?.state === 'running'
  let detail: ReactNode
  if (running) {
    detail = (
      <span className="mt-1.5 block">
        <span className="flex items-center gap-1.5">
          <IconLoaderCircle size={12} className="animate-spin" />
          {job.step}
          {job.percent !== null && ` · ${job.percent}%`}
        </span>
        <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-[rgb(var(--border))]">
          <span
            className="block h-full rounded-full bg-[rgb(var(--accent))] transition-[width] duration-300"
            style={{ width: `${job.percent ?? 0}%` }}
          />
        </span>
      </span>
    )
  } else if (job?.state === 'error') {
    detail = (
      <span className="mt-1 flex items-start gap-1.5 text-[rgb(var(--text-primary))]">
        <IconCircleAlert size={13} className="mt-px shrink-0" />
        <span>
          {job.error}.{' '}
          <button type="button" onClick={onRetry} className="underline text-[rgb(var(--accent))]">
            Retry
          </button>
        </span>
      </span>
    )
  } else if (downloaded) {
    detail = 'Downloaded — Satellite, Relief, Simple and Night lights work offline.'
  } else {
    detail =
      'Downloads sharper offline imagery for every map view from NASA and Natural Earth (public domain). ' +
      'One-time download of about 230 MB; needs internet.'
  }
  return (
    <label className={`flex items-start justify-between gap-4 py-1.5 ${downloaded ? '' : 'cursor-pointer'}`}>
      <span className="min-w-0 flex-1">
        8K globe imagery
        <span className="block text-xs text-[rgb(var(--text-secondary))]">{detail}</span>
      </span>
      <input
        type="checkbox"
        checked={on}
        // Once downloaded the files stay; the toggle just reflects that.
        disabled={downloaded || running}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 accent-[rgb(var(--accent))]"
      />
    </label>
  )
}
