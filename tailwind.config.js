/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'Cascadia Code', 'Consolas', 'SFMono-Regular', 'monospace']
      },
      // Design tokens (Phase 2c polish). Every size is rem-based so the
      // Settings "Font size" option — which sets the root font-size (see
      // globals.css) — scales the whole interface consistently. Use these
      // instead of arbitrary text-[Npx] values.
      fontSize: {
        '3xs': ['0.625rem', { lineHeight: '0.875rem' }], // 10px at medium — badges, fine print
        '2xs': ['0.6875rem', { lineHeight: '1rem' }], // 11px — secondary labels, credits
        body: ['0.9375rem', { lineHeight: '1.4rem' }] // 15px — app body text
      },
      // Radius scale — CSS variables in globals.css. rounded-md = controls,
      // rounded-lg = cards, rounded-xl = modal, rounded-full = pills/chips &
      // round buttons. Overriding the stock keys means every existing
      // rounded-* class picks up the shared scale.
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)'
      },
      spacing: {
        control: 'var(--control-h)',
        inset: 'var(--space-inset)',
        gutter: 'var(--space-gutter)'
      },
      boxShadow: {
        overlay: 'var(--shadow-overlay)'
      }
    }
  },
  plugins: []
}
