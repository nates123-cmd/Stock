import { View, type ViewProps, StyleSheet } from 'react-native';
import { colors, layout, type ColorToken } from '@/design';

export type CardProps = ViewProps & {
  /** Surface tone. Default bg2 (standard card). bg3 for recessed/tag fills. */
  tone?: Extract<ColorToken, 'bg2' | 'bg3' | 'bgCook'>;
  bordered?: boolean;
};

/**
 * Card-stacked surface primitive (spec §2 "Layout grammar"). Most screens are
 * vertical stacks of these.
 */
export function Card({ tone = 'bg2', bordered = false, style, ...rest }: CardProps) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors[tone] },
        bordered && styles.bordered,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.cardRadius,
    padding: 16,
  },
  bordered: {
    borderWidth: 1,
    borderColor: colors.line,
  },
});

export default Card;
