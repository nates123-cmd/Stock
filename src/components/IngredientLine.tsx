/**
 * Inline modification diff renderers (spec §6): when an ingredient's amount
 * or name has been edited mid-cook, show the original value struck through
 * next to the new value — "~~45g~~ 60g lemon juice". Used in the cook
 * screens and the recipe detail; one source of truth for the diff visual.
 */
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Text, Numeric } from './Text';
import { formatAmount } from '@/lib/format';
import { priorAmount, priorName } from '@/lib/recipe';
import type { Ingredient } from '@/types';

export function IngredientAmount({
  ing,
  style,
}: {
  ing: Ingredient;
  style?: StyleProp<TextStyle>;
}) {
  const prior = priorAmount(ing);
  if (!prior) {
    return (
      <Numeric color="text" style={style}>
        {formatAmount(ing.amount, ing.unit) || '—'}
      </Numeric>
    );
  }
  return (
    <Numeric color="accent" style={style}>
      <Text color="textFaint" style={styles.strike}>
        {formatAmount(prior.amount, prior.unit) || '—'}
      </Text>
      {'  '}
      {formatAmount(ing.amount, ing.unit) || '—'}
    </Numeric>
  );
}

export function IngredientName({
  ing,
  style,
}: {
  ing: Ingredient;
  style?: StyleProp<TextStyle>;
}) {
  const prior = priorName(ing);
  if (!prior) {
    return <Text style={style}>{ing.canonicalName}</Text>;
  }
  return (
    <Text style={style}>
      <Text color="textFaint" style={styles.strike}>
        {prior}
      </Text>
      {'  '}
      {ing.canonicalName}
    </Text>
  );
}

const styles = StyleSheet.create({
  strike: { textDecorationLine: 'line-through' },
});
