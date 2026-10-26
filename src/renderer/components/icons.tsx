/*
 * App icon set — Lucide (https://lucide.dev, ISC License) via the lucide-react
 * package. Bundled into the renderer by Vite, so it works fully offline.
 *
 * Re-exported under Icon* names so call sites read the same everywhere and
 * the icon library stays swappable in one place. Never use text glyphs
 * (☰ ⚙ ✕ ↻ ▾ …) for controls — they render inconsistently across fonts.
 */
import {
  Bird,
  Bug,
  Droplets,
  PawPrint,
  Shrimp,
  Snail,
  Turtle,
  Fish,
  type LucideIcon,
  type LucideProps
} from 'lucide-react'

export {
  X as IconX,
  Check as IconCheck,
  Settings as IconSettings,
  PanelLeftClose as IconPanelLeftClose,
  PanelLeftOpen as IconPanelLeftOpen,
  RefreshCw as IconRefreshCw,
  Star as IconStar,
  Maximize2 as IconMaximize2,
  Search as IconSearch,
  SlidersHorizontal as IconSlidersHorizontal,
  ExternalLink as IconExternalLink,
  ImageOff as IconImageOff,
  LoaderCircle as IconLoaderCircle,
  ChevronLeft as IconChevronLeft,
  ChevronRight as IconChevronRight,
  CircleAlert as IconCircleAlert,
  Eye as IconEye,
  EyeOff as IconEyeOff,
  List as IconList,
  MapPin as IconMapPin,
  Flame as IconFlame
} from 'lucide-react'

export type IconProps = LucideProps
export type IconComponent = LucideIcon

/*
 * One icon per ANIMAL_GROUPS bucket (src/renderer/constants.ts), used by the
 * no-photo taxon card and list thumbnails. Lucide has no frog or spider, so
 * Amphibians use Droplets (moist-skinned, water-bound) and Arachnids share
 * Bug — the group name is always shown next to the icon, never icon alone.
 */
const TAXON_ICONS: Record<string, LucideIcon> = {
  Mammals: PawPrint,
  Birds: Bird,
  Reptiles: Turtle,
  Amphibians: Droplets,
  Fish: Fish,
  Insects: Bug,
  Arachnids: Bug,
  Mollusks: Snail,
  Crustaceans: Shrimp
}

/** Icon for a taxon group; unknown/legacy groups fall back to a neutral shape. */
export function taxonIcon(group: string | null | undefined): LucideIcon {
  return (group && TAXON_ICONS[group]) || PawPrint
}
