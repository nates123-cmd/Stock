import { Platform } from 'react-native';

/**
 * Typography — spec §2.
 *
 * - Serif (Iowan Old Style → Palatino → Georgia) for titles, recipe names,
 *   step titles, day numbers.
 * - System sans for body, UI controls, navigation.
 * - Mono for ALL numerics — amounts, times, temperatures, gram weights,
 *   baker's %.
 *
 * Real font files (Iowan fallbacks, JetBrains Mono) live in /assets/fonts and
 * are loaded via expo-font in the root layout when added. Until then we map to
 * the closest platform system faces so the hierarchy is already correct.
 */
export const fonts = {
  serif: Platform.select({
    ios: 'Iowan Old Style',
    android: 'serif',
    default: 'Iowan Old Style, Palatino, Georgia, serif',
  }),
  sans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: '"SF Mono", "JetBrains Mono", Menlo, monospace',
  }),
} as const;

/**
 * Type scale from spec §2. `family` selects which font stack; numeric uses
 * mono, headings use serif, everything else sans.
 */
export const type = {
  wordmark: { fontFamily: fonts.serif, fontSize: 31, fontWeight: '600' },
  screenTitle: { fontFamily: fonts.serif, fontSize: 25, fontWeight: '600' },
  recipeTitle: { fontFamily: fonts.serif, fontSize: 19, fontWeight: '600' },
  sectionLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  body: { fontFamily: fonts.sans, fontSize: 14, fontWeight: '400' },
  bodyStrong: { fontFamily: fonts.sans, fontSize: 14, fontWeight: '500' },
  cookBody: { fontFamily: fonts.sans, fontSize: 20, fontWeight: '400' },
  cookStepTitle: { fontFamily: fonts.serif, fontSize: 28, fontWeight: '600' },
  numeric: { fontFamily: fonts.mono, fontSize: 12.5, fontWeight: '700' },
} as const;

export type TypeToken = keyof typeof type;
