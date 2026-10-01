import { createContext, useContext, type ReactNode } from 'react';
import { colors, type ColorToken } from './colors';

/**
 * Ink — which surface a component is drawn on (DESIGN.md "Cook mode").
 *
 * Cook mode is Matte Navy, so a component that asks for `text` there must get
 * cream, not navy. Rather than every cook screen hand-picking light colours,
 * the cook screens wrap themselves in <InkProvider ink="cook"> and the
 * primitives (Text, Glyph, Card, Button, TimerStrip…) resolve the SAME token
 * names against this palette instead. Overlays reset to "light", because a
 * sheet is always a warm-white surface.
 *
 * Only the tokens whose meaning flips on a dark ground are remapped. Flame
 * stays Flame; `bg` stays warm white (it is used as ink ON a Flame fill).
 */
export type Ink = 'light' | 'cook';

const cook: Record<ColorToken, string> = {
  ...colors,
  text: colors.cookText,
  textMuted: colors.cookMuted,
  textFaint: '#7F8A97',
  line: colors.cookLine,
  lineSoft: '#223243',
  bg2: '#1A2B3D', // raised panel on navy
  bg3: '#24364A',
  ok: '#6FB08A',
  warn: '#E59307',
};

const PALETTES: Record<Ink, Record<ColorToken, string>> = { light: colors, cook };

const InkContext = createContext<Ink>('light');

export function InkProvider({ ink, children }: { ink: Ink; children: ReactNode }) {
  return <InkContext.Provider value={ink}>{children}</InkContext.Provider>;
}

export const useInk = (): Ink => useContext(InkContext);

/** The palette for whatever surface this component is on. */
export function useColors(): Record<ColorToken, string> {
  return PALETTES[useContext(InkContext)];
}

/** Non-hook access, for module-level StyleSheets that are cook-only. */
export const palette = (ink: Ink): Record<ColorToken, string> => PALETTES[ink];
