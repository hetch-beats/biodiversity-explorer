import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconX } from './icons'

/**
 * Largest available version of an image URL, derived from the known URL
 * schemes of the sources the app uses (never guessed for anything else):
 *  - iNaturalist open data: …/photos/<id>/large.jpg  -> …/original.jpg
 *  - Wikimedia Commons thumbs: …/thumb/a/ab/File.jpg/1024px-File.jpg -> …/a/ab/File.jpg
 */
export function fullSizeUrl(url: string): string {
  if (/inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org/.test(url)) {
    return url.replace(/\/(square|small|medium|large)\.(jpe?g|png)$/i, '/original.$2')
  }
  const commons = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([^/]+)\/[^/]+$/i)
  if (commons) return `${commons[1]}/${commons[2]}/${commons[3]}/${commons[4]}`
  return url
}

/**
 * Full-screen image viewer. Shows the already-loaded preview immediately and
 * swaps in the full-resolution original once it arrives (falling back to the
 * preview if the original fails). Esc or a click outside the image closes it;
 * focus moves to the close button and back to the opener on close.
 * z-50: same layer as the Settings modal — the only layer that may cover the app.
 */
export default function ImageLightbox({
  previewUrl,
  alt,
  caption,
  onClose
}: {
  previewUrl: string
  alt: string
  caption?: ReactNode
  onClose: () => void
}): JSX.Element {
  const fullUrl = fullSizeUrl(previewUrl)
  const [fullLoaded, setFullLoaded] = useState(fullUrl === previewUrl)
  const [fullFailed, setFullFailed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.()
    }
  }, [])

  const showFull = fullLoaded && !fullFailed

  // Portaled to <body> so no ancestor (the docked sheet's scroll/overflow
  // container, a future transform) can clip or trap the fixed overlay.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-6 bg-black/85 animate-[fadein_150ms_ease-out]"
    >
      <button
        ref={closeRef}
        onClick={onClose}
        aria-label="Close image"
        className="absolute top-4 right-4 h-10 w-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <IconX size={20} />
      </button>

      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <img
          src={showFull ? fullUrl : previewUrl}
          alt={alt}
          className="max-h-[82vh] max-w-[92vw] object-contain rounded-md shadow-2xl"
        />
        {/* Loads the original off-screen, then it replaces the preview. */}
        {!fullLoaded && !fullFailed && (
          <img
            src={fullUrl}
            alt=""
            aria-hidden
            className="hidden"
            onLoad={() => setFullLoaded(true)}
            onError={() => setFullFailed(true)}
          />
        )}
        {!showFull && !fullFailed && (
          <span className="absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-3xs bg-black/60 text-white">
            Loading full resolution…
          </span>
        )}
      </div>

      {caption && (
        <div onClick={(e) => e.stopPropagation()} className="max-w-[92vw] text-center text-xs text-white/75">
          {caption}
        </div>
      )}
    </div>,
    document.body
  )
}
