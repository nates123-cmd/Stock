import { StyleSheet } from 'react-native';
import { Text } from './Text';
import { colors, fonts, useColors } from '@/design';
import { tokenizeStep } from '@/lib/cookText';

/**
 * Renders a step body with inline styling: amounts and temperatures in bold
 * tabular ink (DESIGN.md — Flame is for actions, and an amount is not one), durations as tappable timer links
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
  const c = useColors();
  return (
    <Text style={{ fontSize: size, lineHeight: lh, color: c.text }}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <Text key={i} style={{ fontSize: size, lineHeight: lh }}>{seg.text}</Text>;
        if (seg.type === 'amount')
          return (
            <Text key={i} style={[styles.amount, { fontSize: size, color: c.text }]}>
              {' '}{seg.text}{' '}
            </Text>
          );
        if (seg.type === 'temp')
          return (
            <Text key={i} style={[styles.temp, { fontSize: size, color: c.text, backgroundColor: c.bg3 }]}>
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
    fontVariant: ['tabular-nums'],
  },
  temp: {
    fontFamily: fonts.mono,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timer: {
    color: colors.accent,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});

export default StepBody;
