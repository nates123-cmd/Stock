import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { type, useColors, type ColorToken, type TypeToken } from '@/design';

export type AppTextProps = RNTextProps & {
  /** Type-scale token from spec §2. Defaults to body. */
  variant?: TypeToken;
  /** Palette token. Defaults to primary text (espresso). */
  color?: ColorToken;
};

/**
 * The single text primitive. All on-screen text should go through this so the
 * type scale stays enforced (DESIGN.md — one face, Figtree).
 *
 * Numerics (amounts, times, temps, gram weights, baker's %) MUST use
 * variant="numeric" so they render with tabular figures and line up.
 */
export function Text({ variant = 'body', color = 'text', style, ...rest }: AppTextProps) {
  // Resolved against the surface's ink, so `text` is cream inside cook mode.
  const c = useColors();
  return <RNText style={[type[variant], { color: c[color] }, style]} {...rest} />;
}

/** Display heading shorthand. */
export function Heading({ variant = 'screenTitle', ...rest }: AppTextProps) {
  return <Text variant={variant} {...rest} />;
}

/** Numeric shorthand (tabular figures) — use for any number. */
export function Numeric({ color = 'text', style, ...rest }: AppTextProps) {
  return <Text variant="numeric" color={color} style={style} {...rest} />;
}

/** Uppercase section label (spec §2). */
export function SectionLabel({ color = 'textMuted', ...rest }: AppTextProps) {
  return <Text variant="sectionLabel" color={color} {...rest} />;
}

export default Text;
