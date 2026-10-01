import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors } from '@/design';

export type Segment = {
  key: string;
  label: string;
  /** optional count shown after the label */
  count?: number;
};

/**
 * Reusable 2-3 way segmented control — Enamel (DESIGN.md): text tabs on a
 * hairline with a Flame underline under the active one, NYT Cooking style.
 * No filled pills; the count is a quieter weight of the same line.
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
            <Text variant="bodyStrong" color={active ? 'text' : 'textFaint'}>
              {seg.label}
              {seg.count != null ? (
                <Text color={active ? 'textMuted' : 'textFaint'} style={styles.count}>
                  {` ${seg.count}`}
                </Text>
              ) : null}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  seg: {
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 2.5,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  segActive: { borderBottomColor: colors.accent },
  count: { fontWeight: '500', fontVariant: ['tabular-nums'] },
});

export default SegmentedControl;
