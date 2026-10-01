/** Design system barrel — spec §2. Import tokens from "@/design". */
export { colors } from './colors';
export type { ColorToken } from './colors';
export { fonts, type } from './typography';
export { enamel, cuisineEnamel } from './enamel';
export { InkProvider, useInk, useColors, palette } from './ink';
export type { Ink } from './ink';
export type { EnamelName } from './enamel';
export type { TypeToken } from './typography';
export { glyph, mealMarker } from './glyphs';
export type { GlyphName } from './glyphs';

/** Layout grammar constants (DESIGN.md). */
export const layout = {
  screenPadding: 20, // 16–22px horizontal screen padding
  cardRadius: 8, // Enamel: tighter corners, cards are rare (rules divide instead)
  cardGap: 12,
} as const;
