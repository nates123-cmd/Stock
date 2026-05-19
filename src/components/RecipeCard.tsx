import { Pressable, StyleSheet, View } from 'react-native';
import { Card } from './Card';
import { Text, Numeric } from './Text';
import { SourceBadge, Pill } from './Badge';
import { Glyph } from './Glyph';
import { colors } from '@/design';
import type { Recipe } from '@/types';
import { modCount } from '@/lib/recipe';
import { formatMinutes } from '@/lib/format';

/** Library / list recipe card (spec §6 "Recipe cards"). */
export function RecipeCard({ recipe, onPress }: { recipe: Recipe; onPress?: () => void }) {
  const mods = modCount(recipe);
  const time = formatMinutes(recipe.yield.totalMinutes);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text variant="recipeTitle" style={styles.title}>
            {recipe.title}
          </Text>
          <Glyph name="next" size={16} color="textFaint" />
        </View>

        <View style={styles.metaRow}>
          <SourceBadge source={recipe.source} />
          {mods > 0 ? <Pill label={`modified ${mods}`} tone="accent" /> : null}
        </View>

        <View style={styles.statRow}>
          <Numeric color="textMuted">
            {recipe.cookCount > 0 ? `cooked ${recipe.cookCount}×` : 'not cooked yet'}
          </Numeric>
          <Text color="textFaint"> · </Text>
          <Numeric color="textMuted">serves {recipe.yield.serves}</Numeric>
          {time ? (
            <>
              <Text color="textFaint"> · </Text>
              <Numeric color="textMuted">~{time}</Numeric>
            </>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  pressed: { opacity: 0.6 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  statRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});

export default RecipeCard;
