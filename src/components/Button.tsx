import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { Glyph } from './Glyph';
import { colors, type GlyphName } from '@/design';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  glyph?: GlyphName;
  /** fill available width (action bars use this) */
  flex?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Primary action color is tomato (spec §2). */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  glyph,
  flex,
  style,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        flex && styles.flex,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}>
      <View style={styles.row}>
        {glyph ? (
          <Glyph
            name={glyph}
            size={15}
            color={variant === 'primary' ? 'bg' : 'text'}
          />
        ) : null}
        <Text
          variant="bodyStrong"
          color={variant === 'primary' ? 'bg' : 'text'}
          style={styles.label}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** Floating `+` action button, bottom-right (spec §6 library FAB). */
export function Fab({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add"
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}>
      <Glyph name="add" size={26} color="bg" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { textAlign: 'center' },
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ghost: { backgroundColor: 'transparent' },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.text,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
});

export default Button;
