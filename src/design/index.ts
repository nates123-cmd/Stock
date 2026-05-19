/** Design system barrel — spec §2. Import tokens from "@/design". */
export { colors } from './colors';
export type { ColorToken } from './colors';
export { fonts, type } from './typography';
export type { TypeToken } from './typography';
export { glyph, mealMarker } from './glyphs';
export type { GlyphName } from './glyphs';

/** Layout grammar constants (spec §2 "Layout grammar"). */
export const layout = {
  screenPadding: 20, // 16–22px horizontal screen padding
  cardRadius: 14, // 12–16px card border-radius
  cardGap: 12,
} as const;
