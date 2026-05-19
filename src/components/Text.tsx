import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { colors, type, type ColorToken, type TypeToken } from '@/design';

export type AppTextProps = RNTextProps & {
  /** Type-scale token from spec §2. Defaults to body. */
  variant?: TypeToken;
  /** Palette token. Defaults to primary text (espresso). */
  color?: ColorToken;
};

/**
 * The single text primitive. All on-screen text should go through this so the
 * serif/sans/mono split and the type scale stay enforced (spec §2).
 *
 * Numerics (amounts, times, temps, gram weights, baker's %) MUST use
 * variant="numeric" so they render in mono.
 */
export function Text({ variant = 'body', color = 'text', style, ...rest }: AppTextProps) {
  return <RNText style={[type[variant], { color: colors[color] }, style]} {...rest} />;
}

/** Serif heading shorthand. */
export function Heading({ variant = 'screenTitle', ...rest }: AppTextProps) {
  return <Text variant={variant} {...rest} />;
}

/** Mono numeric shorthand — use for any number per spec §2. */
export function Numeric({ color = 'text', style, ...rest }: AppTextProps) {
  return <Text variant="numeric" color={color} style={style} {...rest} />;
}

/** Uppercase section label (spec §2). */
export function SectionLabel({ color = 'textMuted', ...rest }: AppTextProps) {
  return <Text variant="sectionLabel" color={color} {...rest} />;
}

export default Text;
