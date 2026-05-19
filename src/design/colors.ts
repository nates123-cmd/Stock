/**
 * Stock palette — spec §2 "Identity & design system".
 * Single source of truth for color. The same values are mirrored into the
 * Tailwind theme (tailwind.config.js) so NativeWind class names stay in sync.
 *
 * Light mode only for v1 (spec §12).
 */
export const colors = {
  bg: '#F5EDDD', // parchment, primary background
  bg2: '#EDE2CC', // card background, one shade deeper
  bg3: '#E4D7BB', // recessed surfaces, tag fills
  bgCook: '#F8F1E2', // cook-mode background, slightly warmer

  accent: '#CC3D2E', // tomato, primary action color
  accentDeep: '#A52E22', // hover/pressed states
  accentSoft: '#E16252', // light highlights when needed

  text: '#3D2B1F', // espresso, primary text
  textMuted: '#8A6F5C', // secondary text, labels
  textFaint: '#B19981', // tertiary, placeholders

  line: '#DCC9A8', // borders, dividers
  lineSoft: '#E4D5B8', // lighter dividers within cards

  ok: '#5C7A3E', // olive, success states
  warn: '#C28B2B', // amber, attention/experimental
} as const;

export type ColorToken = keyof typeof colors;
