import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  SectionLabel,
  Card,
  Button,
  RecipeCard,
} from '@/components';
import { colors } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { isSameDay } from '@/lib/week';
import type { Recipe } from '@/types';

/**
 * Cook launcher (redesign Phase A). Whole-meal launcher lands here; the
 * back-scheduled combine timeline + folded-in Bench are Phase C. For now:
 * a "Tonight" launch card, an ad-hoc recipe launcher, and a Bench shortcut.
 */
export default function CookScreen() {
  const router = useRouter();
  const planMeals = usePlanStore((s) => s.meals);
  const recipes = useRecipeStore((s) => s.recipes);

  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Tonight's cookable dish — same date helper the Plan screen uses. Prefer a
  // dinner-typed meal, else the first non-skipped meal that carries a recipe
  // dish (Phase B model: Day→Meals→Dishes).
  const tonight = useMemo(() => {
    const today = new Date();
    const todays = planMeals
      .filter((m) => isSameDay(m.date, today) && (m.status ?? 'planned') !== 'skipped')
      .sort((a, b) => (a.type === 'dinner' ? -1 : b.type === 'dinner' ? 1 : 0));
    for (const meal of todays) {
      const dish = meal.dishes.find((d) => d.recipeId && recipeById.get(d.recipeId));
      if (dish?.recipeId) {
        const recipe = recipeById.get(dish.recipeId);
        if (recipe) return { meal, recipe };
      }
    }
    return null;
  }, [planMeals, recipeById]);

  const cookable = useMemo(
    () => recipes.filter((r) => r.status !== 'archived'),
    [recipes],
  );

  const launch = (id: string) =>
    router.push({ pathname: '/cook/[id]', params: { id } } as never);

  return (
    <Screen>
      <View style={styles.header}>
        <Heading variant="screenTitle">Cook</Heading>
        <Text color="textMuted">what's on tonight</Text>
      </View>

      <SectionLabel style={styles.label}>Tonight</SectionLabel>
      {tonight ? (
        <Card bordered style={styles.tonightCard}>
          <Text variant="recipeTitle">{tonight.recipe.title}</Text>
          <Text color="textMuted">
            planned{tonight.meal.type ? ` ${tonight.meal.type}` : ''} · serves{' '}
            {tonight.recipe.yield.serves}
          </Text>
          <Button
            label="Start cooking"
            glyph="next"
            onPress={() => launch(tonight.recipe.id)}
          />
        </Card>
      ) : (
        <Card style={styles.tonightCard}>
          <Text color="textMuted">Nothing planned to cook tonight.</Text>
          <Text color="textFaint">Pick something below, or plan a meal.</Text>
        </Card>
      )}

      <SectionLabel style={styles.label}>Cook something now</SectionLabel>
      <View style={styles.list}>
        {cookable.map((r) => (
          <RecipeCard key={r.id} recipe={r} onPress={() => launch(r.id)} />
        ))}
        {cookable.length === 0 ? (
          <Text color="textFaint">No recipes yet.</Text>
        ) : null}
      </View>

      <View style={styles.benchRow}>
        <SectionLabel style={styles.label}>Bench</SectionLabel>
        <Text color="textFaint" style={styles.benchHint}>
          Scale, convert and substitute. Folds in here fully in a later pass.
        </Text>
        <Button
          label="Open Bench"
          glyph="bench"
          variant="secondary"
          onPress={() => router.push('/(tabs)/bench' as never)}
        />
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
    paddingBottom: 14,
  },
  label: { paddingTop: 8, paddingBottom: 10 },
  tonightCard: { gap: 10, borderColor: colors.line },
  list: { gap: 12 },
  benchRow: { paddingTop: 12, gap: 8 },
  benchHint: { lineHeight: 18 },
});
