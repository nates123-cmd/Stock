import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Pill } from './Badge';
import { Glyph } from './Glyph';
import { colors, layout } from '@/design';
import { totalSteps } from '@/lib/planSchedule';
import type { CookPlan } from '@/types';

/** Library / Plan-tab card for a Cook Plan — a whole-meal production. Mirrors
 *  RecipeCard but flags the plan and surfaces its schedule when set. */
export function CookPlanCard({ plan, onPress }: { plan: CookPlan; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.headRow}>
        <Text variant="recipeTitle" style={styles.title} numberOfLines={2}>
          {plan.title}
        </Text>
        <Pill label="Cook plan" tone="warn" />
      </View>

      <Text color="textMuted" style={styles.meta}>
        {plan.components.length} components · {plan.phases.length} phases ·{' '}
        {totalSteps(plan)} steps
        {plan.cookCount > 0 ? ` · cooked ${plan.cookCount}×` : ''}
      </Text>

      {plan.serveAt ? (
        <View style={styles.serveRow}>
          <Glyph name="plan" size={13} color="accent" />
          <Text color="accent" variant="sectionLabel">
            {plan.serveAt.toLocaleString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
        </View>
      ) : null}

      {plan.spread.length > 0 ? (
        <Text color="textFaint" variant="sectionLabel" style={styles.spread} numberOfLines={1}>
          {plan.spread.slice(0, 5).join(' · ')}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg2,
    borderRadius: layout.cardRadius,
    padding: 16,
    gap: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.warn,
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { flex: 1 },
  meta: {},
  serveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  spread: { lineHeight: 16 },
});

export default CookPlanCard;
