/**
 * The ChefSteps ingredient block that opens a step: amounts right-aligned in
 * a gram column, names in italic, the volume and prep note faint after the
 * name ("600 g  All-purpose flour  about 4 3/4 cups").
 *
 * Amounts come straight off the live ingredient (see lib/stepIngredients), so
 * Scale / To grams / an edit show here with no extra wiring. Uses the
 * ink-aware colours, so the same block works on cook mode's navy ground.
 */
import { StyleSheet, View } from 'react-native';
import { useColors } from '@/design';
import { IngredientAmount, IngredientName } from './IngredientLine';
import { Text } from './Text';
import { approxVolume } from '@/lib/stepIngredients';
import type { Ingredient } from '@/types';

export function StepIngredients({
  ingredients,
  large = false,
}: {
  ingredients: Ingredient[];
  /** cook mode's arm's-length size */
  large?: boolean;
}) {
  const colors = useColors();
  if (ingredients.length === 0) return null;
  const size = large ? 18 : 15;
  return (
    <View style={[styles.block, { borderColor: colors.line }]}>
      {ingredients.map((ing) => {
        const volume = approxVolume(ing);
        const tail = [volume, ing.inlineNote].filter(Boolean).join(' · ');
        return (
          <View key={ing.id} style={styles.row}>
            <IngredientAmount
              ing={ing}
              style={[styles.amount, { fontSize: size, lineHeight: size + 5, width: large ? 84 : 68 }]}
            />
            <Text style={[styles.text, { fontSize: size, lineHeight: size + 5 }]}>
              <IngredientName ing={ing} style={[styles.name, { fontSize: size }]} />
              {tail ? (
                <Text color="textFaint" style={[styles.tail, { fontSize: size - 2 }]}>
                  {`  ${tail}`}
                </Text>
              ) : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: 8,
    gap: 4,
  },
  row: { flexDirection: 'row', gap: 12, alignItems: 'baseline' },
  amount: { textAlign: 'right' },
  text: { flex: 1 },
  name: { fontStyle: 'italic', fontWeight: '500' },
  tail: { fontStyle: 'italic' },
});
