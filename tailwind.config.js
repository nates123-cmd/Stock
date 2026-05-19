/**
 * Tailwind theme mirrors the design tokens in src/design (spec §2).
 * Keep this in sync with src/design/colors.ts — that file is the source of
 * truth; this exists so NativeWind className utilities resolve the palette.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#F5EDDD',
        bg2: '#EDE2CC',
        bg3: '#E4D7BB',
        'bg-cook': '#F8F1E2',
        accent: '#CC3D2E',
        'accent-deep': '#A52E22',
        'accent-soft': '#E16252',
        text: '#3D2B1F',
        'text-muted': '#8A6F5C',
        'text-faint': '#B19981',
        line: '#DCC9A8',
        'line-soft': '#E4D5B8',
        ok: '#5C7A3E',
        warn: '#C28B2B',
      },
      fontFamily: {
        serif: ['Iowan Old Style', 'Palatino', 'Georgia', 'serif'],
        sans: ['-apple-system', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [],
};
