import { StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, fonts } from '@/design';
import { tokenizeStep } from '@/lib/cookText';

/**
 * Renders a step body with spec §7 inline styling: amounts as mono tomato
 * chips, temperatures as neutral chips, durations as tappable timer links
 * (⏱ prefix, underlined) that start a cook timer.
 */
export function StepBody({
  body,
  size = 20,
  onStartTimer,
}: {
  body: string;
  size?: number;
  onStartTimer?: (label: string, seconds: number) => void;
}) {
  const segments = tokenizeStep(body);
  const lh = Math.round(size * 1.45);
  return (
    <Text style={{ fontSize: size, lineHeight: lh, color: colors.text }}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <Text key={i} style={{ fontSize: size, lineHeight: lh }}>{seg.text}</Text>;
        if (seg.type === 'amount')
          return (
            <Text key={i} style={[styles.amount, { fontSize: size - 2 }]}>
              {' '}{seg.text}{' '}
            </Text>
          );
        if (seg.type === 'temp')
          return (
            <Text key={i} style={[styles.temp, { fontSize: size - 2 }]}>
              {' '}{seg.text}{' '}
            </Text>
          );
        // timer — tappable
        return (
          <Text
            key={i}
            onPress={() => onStartTimer?.(seg.text, seg.seconds)}
            style={[styles.timer, { fontSize: size }]}
            suppressHighlighting>
            ⏱ {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

/** Inline-pill variants used inside flowing text (RN nested <Text>). */
const styles = StyleSheet.create({
  amount: {
    fontFamily: fonts.mono,
    fontWeight: '700',
    color: colors.accent,
    backgroundColor: 'rgba(204,61,46,0.08)',
  },
  temp: {
    fontFamily: fonts.mono,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.bg3,
  },
  timer: {
    color: colors.accent,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});

export default StepBody;
