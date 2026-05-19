import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Glyph } from './Glyph';
import { colors } from '@/design';

export type ProgressState = 'done' | 'doing' | 'todo';
export type ProgressStep = { label: string; state: ProgressState };

/** Vertical check-state list for the capture parsing screen (spec §6 · 3). */
export function ProgressStepList({ steps }: { steps: ProgressStep[] }) {
  return (
    <View style={styles.list}>
      {steps.map((s, i) => (
        <View key={i} style={styles.row}>
          <View
            style={[
              styles.dot,
              s.state === 'done' && styles.dotDone,
              s.state === 'doing' && styles.dotDoing,
            ]}>
            {s.state === 'done' ? <Glyph name="done" size={13} color="bg" /> : null}
          </View>
          <Text
            color={s.state === 'todo' ? 'textFaint' : 'text'}
            variant={s.state === 'doing' ? 'bodyStrong' : 'body'}>
            {s.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.ok, borderColor: colors.ok },
  dotDoing: { borderColor: colors.accent, borderWidth: 2 },
});

export default ProgressStepList;
