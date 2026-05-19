import { Pressable, StyleSheet, View } from 'react-native';
import { Text, Numeric, SectionLabel } from './Text';
import { Glyph } from './Glyph';
import { colors } from '@/design';
import { fmtClock, type CookTimer } from '@/lib/useCookTimers';

/** Active timers strip (spec §7). Always visible while ≥1 timer runs. */
export function TimerStrip({
  timers,
  onClear,
}: {
  timers: CookTimer[];
  onClear: (id: string) => void;
}) {
  if (timers.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <SectionLabel color="textMuted">Active · {timers.length}</SectionLabel>
      {timers.map((t) => (
        <View key={t.id} style={styles.row}>
          <Glyph name="timer" size={16} color={t.done ? 'ok' : 'accent'} />
          <View style={styles.mid}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {t.label}
            </Text>
            <Text color="textFaint" style={styles.prov}>
              from step {t.stepOrdinal}
            </Text>
          </View>
          <Numeric color={t.done ? 'ok' : 'text'} style={styles.clock}>
            {t.done ? 'done' : fmtClock(t.remaining)}
          </Numeric>
          <Pressable onPress={() => onClear(t.id)} hitSlop={10}>
            <Text color="textFaint" style={styles.clear}>
              ✕
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg2,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mid: { flex: 1 },
  prov: { fontSize: 12 },
  clock: { fontSize: 15 },
  clear: { fontSize: 15, paddingHorizontal: 4 },
});

export default TimerStrip;
