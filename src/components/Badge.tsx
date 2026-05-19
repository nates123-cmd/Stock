import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, type ColorToken } from '@/design';
import type { RecipeSource } from '@/types';
import type { Confidence } from '@/lib/parsing';

const SOURCE: Record<RecipeSource['type'], { label: string; fill: ColorToken; fg: ColorToken }> = {
  nyt: { label: 'NYT', fill: 'bg3', fg: 'text' }, // cream
  yt: { label: 'YouTube', fill: 'accentSoft', fg: 'bg' }, // light tomato (≈pink)
  book: { label: 'Book', fill: 'ok', fg: 'bg' }, // olive/green
  mine: { label: 'Mine', fill: 'accent', fg: 'bg' }, // tomato
};

/** Source provenance pill (spec §6). */
export function SourceBadge({ source }: { source: RecipeSource }) {
  const s = SOURCE[source.type];
  return (
    <View style={[styles.badge, { backgroundColor: colors[s.fill] }]}>
      <Text variant="sectionLabel" color={s.fg} style={styles.badgeText}>
        {s.label}
      </Text>
    </View>
  );
}

export type PillTone = 'accent' | 'warn' | 'ok' | 'muted';

/** Outline pill — `modified` (accent), `exp` (warn), etc. (spec §6). */
export function Pill({ label, tone = 'accent' }: { label: string; tone?: PillTone }) {
  const c: ColorToken =
    tone === 'accent' ? 'accent' : tone === 'warn' ? 'warn' : tone === 'ok' ? 'ok' : 'textMuted';
  return (
    <View style={[styles.pill, { borderColor: colors[c] }]}>
      <Text variant="sectionLabel" color={c} style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

/** Inference confidence marker (spec §11 confidence flags). */
export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  if (confidence === 'extracted') return null;
  const guessed = confidence === 'guessed';
  return (
    <Text
      color={guessed ? 'warn' : 'textFaint'}
      style={styles.conf}>
      {guessed ? 'I guessed' : 'parsed'}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  badgeText: { letterSpacing: 1 },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  conf: { fontSize: 12, fontStyle: 'italic' },
});

export default SourceBadge;
