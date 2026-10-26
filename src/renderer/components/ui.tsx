import type { ButtonHTMLAttributes, ReactNode } from 'react'

/*
 * Shared UI primitives (Phase 2c polish). One definition per control type so
 * sizes, radii, borders and focus/hover states stay consistent across the app
 * instead of each component re-typing its own Tailwind string.
 *
 * Scale: controls are h-control (--control-h) with rounded-md; everything is rem-based, so
 * the Settings font-size option scales these too.
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

/** Square icon-only button. `label` is required: it's the accessible name and the tooltip. */
export function IconButton({
  label,
  active = false,
  variant = 'ghost',
  className = '',
  children,
  ...rest
}: ButtonProps & { label: string; active?: boolean; variant?: 'ghost' | 'outline'; children: ReactNode }): JSX.Element {
  const base =
    'h-control w-control shrink-0 inline-flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none'
  const tone = active
    ? 'text-[rgb(var(--accent))] bg-[rgb(var(--accent))]/10'
    : 'text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--bg-elevated))]'
  const border = variant === 'outline' ? 'border border-[rgb(var(--border))]' : ''
  return (
    <button type="button" title={label} aria-label={label} className={`${base} ${tone} ${border} ${className}`} {...rest}>
      {children}
    </button>
  )
}

/** Standard text button (optionally with a leading icon). */
export function Button({
  variant = 'outline',
  className = '',
  children,
  ...rest
}: ButtonProps & { variant?: 'outline' | 'ghost' | 'accent'; children: ReactNode }): JSX.Element {
  const base =
    'h-control px-3 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none'
  const tone =
    variant === 'accent'
      ? 'bg-[rgb(var(--accent))] text-[rgb(var(--accent-contrast))] hover:opacity-90'
      : variant === 'ghost'
        ? 'text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--bg-elevated))]'
        : 'border border-[rgb(var(--border))] text-[rgb(var(--text-primary))] hover:bg-[rgb(var(--bg-elevated))]'
  return (
    <button type="button" className={`${base} ${tone} ${className}`} {...rest}>
      {children}
    </button>
  )
}

/** Small uppercase section heading used inside sheets and Settings. */
export function SectionHeading({ children, className = '' }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <h3 className={`text-3xs font-semibold uppercase tracking-wider text-[rgb(var(--text-secondary))] ${className}`}>
      {children}
    </h3>
  )
}

/** Header strip at the top of a docked sheet — same height and border everywhere. */
export function SheetHeader({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="h-11 shrink-0 flex items-center gap-2 px-2 border-b border-[rgb(var(--border))]">{children}</div>
  )
}
