import { View, StyleSheet } from 'react-native';
import { Screen } from './Screen';
import { Text, Heading, SectionLabel } from './Text';
import { Glyph } from './Glyph';
import { Card } from './Card';
import { colors, glyph, layout, type GlyphName } from '@/design';

export type PillarPlaceholderProps = {
  pillar: string;
  icon: GlyphName;
  /** one-line statement of what this pillar does (from the spec) */
  tagline: string;
  /** spec section that defines this pillar's screens */
  specRef: string;
  primary?: boolean;
};

/**
 * Scaffold placeholder for each of the five pillars (spec §3). Real screens
 * replace these in build order (spec §13). It exists to prove the design
 * system renders end-to-end: wordmark, serif headings, glyph icon, card
 * surface, parchment background.
 */
export function PillarPlaceholder({
  pillar,
  icon,
  tagline,
  specRef,
  primary,
}: PillarPlaceholderProps) {
  return (
    <Screen>
      <View style={styles.header}>
        <Heading variant="wordmark">Stock</Heading>
        {primary ? <SectionLabel color="accent">Primary pillar</SectionLabel> : null}
      </View>

      <Card style={styles.hero}>
        <Glyph name={icon} size={40} color="accent" />
        <Heading variant="screenTitle" style={styles.title}>
          {pillar}
        </Heading>
        <Text color="textMuted" style={styles.tagline}>
          {tagline}
        </Text>
      </Card>

      <View style={styles.note}>
        <Text color="textFaint">
          {glyph.next} Screens defined in spec {specRef}. Scaffold only — wire up
          in build order (spec §13).
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 20,
  },
  hero: {
    gap: 10,
    alignItems: 'flex-start',
  },
  title: {
    marginTop: 4,
  },
  tagline: {
    lineHeight: 20,
  },
  note: {
    marginTop: layout.cardGap,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 14,
  },
});

export default PillarPlaceholder;
