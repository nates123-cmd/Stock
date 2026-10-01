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
        bg: '#FBF9F4',
        bg2: '#F2EEE5',
        bg3: '#E8E2D5',
        'bg-cook': '#122131',
        accent: '#CE3A07',
        'accent-deep': '#A82F05',
        'accent-soft': '#E8714A',
        text: '#122131',
        'text-muted': '#4A5563',
        'text-faint': '#79818B',
        line: '#E3DDD0',
        'line-soft': '#ECE7DC',
        ok: '#2F6B4F',
        warn: '#B86F00',
      },
      fontFamily: {
        serif: ['Figtree', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'system-ui', 'sans-serif'],
        mono: ['Figtree', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '8px',
      },
    },
  },
  plugins: [],
};
