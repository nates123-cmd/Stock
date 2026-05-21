import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors } from '@/design';

/**
 * Selectable filter chip (spec §6 library filter row).
 * - `variant: 'canned'` (default) — primary filters; active state in accent.
 * - `variant: 'tag'` — user-tag filters; muted resting state, dotted line on active so they read as ANDed with the canned filter.
 */
export function FilterChip({
  label,
  active,
  onPress,
  variant = 'canned',
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  variant?: 'canned' | 'tag';
}) {
  const isTag = variant === 'tag';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        isTag
          ? active
            ? styles.tagActive
            : styles.tagIdle
          : active
            ? styles.active
            : styles.idle,
        pressed && styles.pressed,
      ]}>
      <Text
        variant="bodyStrong"
        color={
          isTag
            ? active
              ? 'text'
              : 'textMuted'
            : active
              ? 'bg'
              : 'textMuted'
        }>
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
  tagIdle: { backgroundColor: colors.bg2, borderColor: colors.lineSoft },
  tagActive: { backgroundColor: colors.bg3, borderColor: colors.accent, borderStyle: 'dashed' },
  pressed: { opacity: 0.7 },
});

export default FilterChip;
