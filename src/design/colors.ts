/**
 * Stock palette — "Enamel" (DESIGN.md, 2026-09-30).
 * Single source of truth for color. The same values are mirrored into the
 * Tailwind theme (tailwind.config.js) so NativeWind class names stay in sync.
 *
 * Token NAMES are kept from the parchment era so every screen picked up the
 * new look without a rename; the values and roles below are what changed.
 *
 *  - Ground is a warm white, not parchment. Ink is Le Creuset Matte Navy.
 *  - Flame is the ONE action colour. Nothing decorative may use it.
 *  - Enamel colours (./enamel.ts) mark cuisine and nothing else.
 */
export const colors = {
  bg: '#FBF9F4', // warm white, primary ground
  bg2: '#F2EEE5', // recessed: search field, segment track, sheets
  bg3: '#E8E2D5', // deeper recess: tag fills, empty thumbs
  bgCook: '#122131', // cook mode ground — Matte Navy, read at arm's length

  accent: '#CE3A07', // Flame — actions only
  accentDeep: '#A82F05', // pressed
  accentSoft: '#E8714A', // light highlight

  text: '#122131', // Matte Navy ink
  textMuted: '#4A5563', // secondary prose
  textFaint: '#79818B', // data/chrome tier: meta lines, placeholders

  line: '#E3DDD0', // hairlines
  lineSoft: '#ECE7DC', // rules inside a group

  ok: '#2F6B4F', // Artichaut-leaning green, success
  warn: '#B86F00', // Nectar, darkened for text contrast

  // Cook-mode ink (on bgCook). Separate tokens so cook screens never have to
  // hardcode a light colour.
  cookText: '#F4F1EA',
  cookMuted: '#A9B1BC',
  cookLine: '#2C3B4C',
  onAccent: '#FFFFFF', // text/glyphs on a Flame or enamel fill
} as const;

export type ColorToken = keyof typeof colors;
