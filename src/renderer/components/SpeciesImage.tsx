import { useState } from 'react'
import { useGlobeStore } from '../stores/globeStore'
import ImageLightbox from './ImageLightbox'
import { IconMaximize2, IconImageOff, IconLoaderCircle, IconExternalLink, taxonIcon } from './icons'
import type { SpeciesData } from '../types'

const KIND_BADGE: Record<NonNullable<SpeciesData['image_kind']>, string | null> = {
  photo: null, // the default — no badge needed
  specimen: 'Museum specimen',
  fossil: 'Fossil',
  illustration: 'Illustration',
  image: 'Historical image'
}

function Credit({ species, linkClass }: { species: SpeciesData; linkClass: string }): JSX.Element {
  return (
    <>
      {species.image_credit ? `${species.image_credit} · ` : ''}
      {species.image_license}
      {species.image_source && (
        <>
          {' · '}
          {species.image_source_url ? (
            <a href={species.image_source_url} target="_blank" rel="noreferrer" className={linkClass}>
              {species.image_source}
            </a>
          ) : (
            species.image_source
          )}
        </>
      )}
    </>
  )
}

/**
 * Species header image, always with its provenance. Images are chosen in the
 * main process (src/main/services/speciesImage.ts) from trusted sources —
 * research-grade iNaturalist photos via GBIF first, then museum specimens,
 * then a vetted Wikimedia Commons file — and anything that isn't a
 * photograph of the living animal is badged as what it is. An expand control
 * (shown on hover or keyboard focus) opens the full-resolution original.
 * When nothing trustworthy exists, a themed taxon-group card says so instead.
 */
export default function SpeciesImage({ species }: { species: SpeciesData }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const lookupRunning = useGlobeStore((s) => s.syncingSpecies || s.detailsLoading)
  const pending = !species.image_checked_at

  if (species.image_url && !failed) {
    const badge = species.image_kind ? KIND_BADGE[species.image_kind] : null
    const alt = badge ? `${badge}: ${species.common_name}` : species.common_name
    return (
      <figure>
        <div className="group relative h-48 w-full bg-[rgb(var(--bg-elevated))]">
          <img
            key={species.image_url}
            src={species.image_url}
            alt={alt}
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
          {badge && (
            <span className="absolute bottom-2 left-2 rounded-md px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide bg-black/60 text-white">
              {badge}
            </span>
          )}
          <button
            onClick={() => setExpanded(true)}
            title="View full image"
            aria-label="View full image"
            className="absolute bottom-2 right-2 h-control w-control flex items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/75"
          >
            <IconMaximize2 size={15} />
          </button>
        </div>
        <figcaption className="px-4 pt-1.5 text-3xs leading-snug text-[rgb(var(--text-secondary))]">
          <Credit species={species} linkClass="underline" />
        </figcaption>

        {expanded && (
          <ImageLightbox
            previewUrl={species.image_url}
            alt={alt}
            onClose={() => setExpanded(false)}
            caption={
              <>
                <div className="text-sm text-white/90">
                  {species.common_name} <i className="text-white/60">{species.scientific_name}</i>
                  {badge ? ` · ${badge}` : ''}
                </div>
                <div className="mt-1">
                  <Credit species={species} linkClass="underline text-white/90" />
                </div>
              </>
            }
          />
        )}
      </figure>
    )
  }

  // No photo (yet): a themed taxon-group card — the group's icon and name on a
  // muted surface with an accent tint — rather than a gray placeholder.
  const GroupIcon = taxonIcon(species.animal_group)
  return (
    <div className="h-48 w-full flex flex-col items-center justify-center gap-2 px-6 text-center bg-[rgb(var(--bg-elevated))] text-[rgb(var(--text-secondary))]">
      <span className="h-14 w-14 rounded-full flex items-center justify-center border border-[rgb(var(--accent))]/25 bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))]">
        {pending && lookupRunning ? (
          <IconLoaderCircle size={22} className="animate-spin" />
        ) : (
          <GroupIcon size={26} strokeWidth={1.75} />
        )}
      </span>
      <span className="text-sm font-medium text-[rgb(var(--text-primary))]">{species.animal_group || 'Animal'}</span>
      {pending && lookupRunning ? (
        <span className="text-xs">Finding a verified image…</span>
      ) : pending ? (
        <span className="text-2xs">Couldn't check image sources right now — this will be retried next time.</span>
      ) : (
        <>
          <span className="inline-flex items-center gap-1 text-2xs">
            <IconImageOff size={12} /> No openly licensed photo, specimen or illustration found
          </span>
          <a
            href={`https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(species.scientific_name)}&title=Special:MediaSearch&type=image`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-2xs underline text-[rgb(var(--accent))]"
          >
            Search Wikimedia Commons <IconExternalLink size={11} />
          </a>
        </>
      )}
    </div>
  )
}
