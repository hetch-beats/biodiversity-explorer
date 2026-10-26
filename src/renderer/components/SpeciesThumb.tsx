import { useState } from 'react'
import { taxonIcon } from './icons'
import type { SpeciesData } from '../types'

/**
 * Small list thumbnail. Shows the species' attributed image when one has been
 * resolved; otherwise (or if the image fails to load) a themed tile with the
 * species' taxon-group icon — never a gray placeholder graphic or an
 * unverified image.
 */
export default function SpeciesThumb({
  species,
  size = 32
}: {
  species: Pick<SpeciesData, 'image_url' | 'common_name'> & { animal_group?: string | null }
  size?: number
}): JSX.Element {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size }

  if (species.image_url && !failed) {
    return (
      <img
        src={species.image_url}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        style={style}
        className="rounded-md object-cover shrink-0 bg-[rgb(var(--bg-elevated))]"
      />
    )
  }
  const Icon = taxonIcon(species.animal_group)
  return (
    <span
      aria-hidden
      title={species.animal_group ?? undefined}
      style={style}
      className="rounded-md shrink-0 flex items-center justify-center border border-[rgb(var(--border))] bg-[rgb(var(--accent))]/10 text-[rgb(var(--accent))]"
    >
      <Icon size={Math.round(size * 0.55)} strokeWidth={1.75} />
    </span>
  )
}
