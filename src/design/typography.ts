import { Platform, type TextStyle } from 'react-native';

/**
 * Typography — "Enamel" (DESIGN.md).
 *
 * ONE face: Figtree, a geometric sans standing in for ChefSteps' Circular.
 * Stock is read with wet hands at arm's length, so hierarchy comes from SIZE
 * and WEIGHT (11 → 40px, 400 → 800), never from switching to a serif.
 *
 * Self-hosted from /public/fonts (global.css @font-face) so it works offline.
 *
 * The old keys survive as aliases so nothing had to be renamed:
 *   serif → display face (Figtree, heavy)
 *   mono  → Figtree with tabular numerals. Numbers still get their own
 *           variant so columns of grams line up; they just no longer change
 *           typeface to do it.
 */
const FIGTREE = Platform.select({
  web: 'Figtree, -apple-system, system-ui, sans-serif',
  default: 'System',
}) as string;

export const fonts = {
  display: FIGTREE,
  sans: FIGTREE,
  serif: FIGTREE,
  mono: FIGTREE,
} as const;

/** Lines up digits in a column — the ChefSteps gram column depends on it. */
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  wordmark: { fontFamily: fonts.display, fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  screenTitle: {
    fontFamily: fonts.display,
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '800',
    letterSpacing: -0.9,
  },
  recipeTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sectionLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  body: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  cookBody: { fontFamily: fonts.sans, fontSize: 21, lineHeight: 30, fontWeight: '400' },
  cookStepTitle: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  numeric: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '700', ...tabular },
} as const satisfies Record<string, TextStyle>;

export type TypeToken = keyof typeof type;
