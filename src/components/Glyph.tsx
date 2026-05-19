import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { colors, glyph, type ColorToken, type GlyphName } from '@/design';

export type GlyphProps = {
  name: GlyphName;
  size?: number;
  color?: ColorToken;
  style?: StyleProp<TextStyle>;
};

/**
 * Renders a single glyph from the spec §2 vocabulary as text.
 * This is the ONLY sanctioned icon mechanism — no emoji, no icon fonts.
 */
export function Glyph({ name, size = 18, color = 'text', style }: GlyphProps) {
  return (
    <RNText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[{ fontSize: size, lineHeight: size * 1.1, color: colors[color] }, style]}>
      {glyph[name]}
    </RNText>
  );
}

export default Glyph;
