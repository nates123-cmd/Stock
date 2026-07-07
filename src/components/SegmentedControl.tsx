import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors } from '@/design';

export type Segment = {
  key: string;
  label: string;
  /** optional count badge shown after the label */
  count?: number;
};

/**
 * Reusable 2-3 way segmented control. Filled-pill active state — the promoted
 * version of the Bench Convert/Sub TabButton pair (spec redesign §nav). Token-
 * clean: active pill = accent, inactive = bg2/line.
 */
export function SegmentedControl({
  segments,
  value,
  onChange,
}: {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.row}>
      {segments.map((seg) => {
        const active = seg.key === value;
        return (
          <Pressable
            key={seg.key}
            onPress={() => onChange(seg.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.seg, active && styles.segActive]}>
            <Text variant="bodyStrong" color={active ? 'bg' : 'textMuted'}>
              {seg.label}
              {seg.count != null ? ` ${seg.count}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  seg: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
  },
  segActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});

export default SegmentedControl;
