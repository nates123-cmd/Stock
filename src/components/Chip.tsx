import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors } from '@/design';

/** Selectable filter chip (spec §6 library filter row). */
export function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active ? styles.active : styles.idle,
        pressed && styles.pressed,
      ]}>
      <Text variant="bodyStrong" color={active ? 'bg' : 'textMuted'}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Horizontal scroller for a chip row. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  idle: { backgroundColor: colors.bg3, borderColor: colors.line },
  active: { backgroundColor: colors.accent, borderColor: colors.accent },
  pressed: { opacity: 0.7 },
});

export default FilterChip;
