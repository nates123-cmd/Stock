import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  SectionLabel,
  Card,
  Button,
  RecipeCard,
  BenchSheet,
  type BenchTab,
} from '@/components';
import { colors } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { isSameDay, dayTag } from '@/lib/week';
import type { Dish, Meal, Recipe } from '@/types';

type CookableDish = { dish: Dish; recipe: Recipe };
type RelevantMeal = { meal: Meal; dishes: CookableDish[] };

/**
 * Cook launcher (redesign Phase C). Opens contextually to the relevant meal —
 * today's (preferring a dinner-typed meal), else the next upcoming meal that
 * carries a cookable dish (Phase B model: Day→Meals→Dishes). Shows that meal's
 * dish(es): cook a single dish, or Combine 2+ into one back-scheduled timeline
 * (src/app/cook/meal/[id]). Bench (scale/convert/sub) folds in here as a sheet.
 */
export default function CookScreen() {
  const router = useRouter();
  const planMeals = usePlanStore((s) => s.meals);
  const recipes = useRecipeStore((s) => s.recipes);
  const [benchOpen, setBenchOpen] = useState(false);

  // Bench deep-links (recipe-detail "To grams" / long-press → Sub) land here
  // and auto-open the folded-in Bench sheet, pre-loaded from the params.
  const benchParams = useLocalSearchParams<{
    bench?: string;
    tab?: BenchTab;
    text?: string;
    sub?: string;
    amount?: string;
    unit?: string;
  }>();
  const benchKey = `${benchParams.bench ?? ''}:${benchParams.tab ?? ''}:${benchParams.sub ?? ''}:${benchParams.text ?? ''}`;
  useEffect(() => {
    if (benchParams.bench || benchParams.sub || benchParams.text || benchParams.tab) {
      setBenchOpen(true);
    }
    // Re-fires when a fresh deep-link hands over new params.
  }, [benchKey, benchParams.bench, benchParams.sub, benchParams.text, benchParams.tab]);

  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);

  // The relevant meal to cook. Resolve each non-skipped meal to its cookable
  // dishes (recipe dishes whose recipe still exists and isn't archived), then:
  // prefer today's (dinner first), else the soonest upcoming meal with dishes.
  const relevant = useMemo<RelevantMeal | null>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const resolve = (meal: Meal): CookableDish[] =>
      meal.dishes
        .map((dish) => ({ dish, recipe: dish.recipeId ? recipeById.get(dish.recipeId) : undefined }))
        .filter((x): x is CookableDish => !!x.recipe && x.recipe.status !== 'archived');

    const withDishes = planMeals
      .filter((m) => (m.status ?? 'planned') !== 'skipped')
      .map((m) => ({ meal: m, dishes: resolve(m) }))
      .filter((x) => x.dishes.length > 0);

    const todays = withDishes
      .filter((x) => isSameDay(x.meal.date, new Date()))
      .sort((a, b) => (a.meal.type === 'dinner' ? -1 : b.meal.type === 'dinner' ? 1 : 0));
    if (todays[0]) return todays[0];

    const upcoming = withDishes
      .filter((x) => x.meal.date.getTime() >= today.getTime())
      .sort((a, b) => a.meal.date.getTime() - b.meal.date.getTime());
    return upcoming[0] ?? null;
  }, [planMeals, recipeById]);

  const isToday = relevant ? isSameDay(relevant.meal.date, new Date()) : false;

  const cookable = useMemo(
    () => recipes.filter((r) => r.status !== 'archived'),
    [recipes],
  );

  const launch = (id: string) =>
    router.push({ pathname: '/cook/[id]', params: { id } } as never);

  const openCombine = (mealId: string) =>
    router.push({ pathname: '/cook/meal/[id]', params: { id: mealId } } as never);

  return (
    <Screen>
      <View style={styles.header}>
        <Heading variant="screenTitle">Cook</Heading>
        <Text color="textMuted">what's on tonight</Text>
      </View>

      <SectionLabel style={styles.label}>{isToday ? 'Tonight' : 'Up next'}</SectionLabel>
      {relevant ? (
        <Card bordered style={styles.mealCard}>
          <View style={styles.mealHead}>
            <Text variant="recipeTitle">
              {relevant.dishes.length > 1
                ? `${relevant.dishes.length} dishes`
                : relevant.dishes[0]?.recipe.title}
            </Text>
            <Text color="textMuted">
              {dayTag(relevant.meal.date)}
              {relevant.meal.type ? ` · ${relevant.meal.type}` : ''}
            </Text>
          </View>

          <View style={styles.dishList}>
            {relevant.dishes.map(({ dish, recipe }) => (
              <Pressable
                key={dish.id}
                style={styles.dishRow}
                onPress={() => launch(recipe.id)}
                accessibilityRole="button">
                <View style={styles.dishText}>
                  <Text variant="bodyStrong">{recipe.title}</Text>
                  <Text color="textFaint">serves {recipe.yield.serves}</Text>
                </View>
                <Text color="accent" variant="bodyStrong">
                  Cook
                </Text>
              </Pressable>
            ))}
          </View>

          {relevant.dishes.length >= 2 ? (
            <Button
              label="Combine into one timeline"
              glyph="cook"
              onPress={() => openCombine(relevant.meal.id)}
            />
          ) : (
            <Button
              label="Start cooking"
              glyph="next"
              onPress={() => {
                const first = relevant.dishes[0];
                if (first) launch(first.recipe.id);
              }}
            />
          )}
        </Card>
      ) : (
        <Card style={styles.mealCard}>
          <Text color="textMuted">Nothing planned to cook.</Text>
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
          Scale, convert and substitute — folded in here, no longer its own tab.
        </Text>
        <Button
          label="Open Bench"
          glyph="bench"
          variant="secondary"
          onPress={() => setBenchOpen(true)}
        />
      </View>

      <BenchSheet
        visible={benchOpen}
        onClose={() => setBenchOpen(false)}
        initial={{
          initialTab: benchParams.tab,
          initialText: benchParams.text ?? '',
          initialSub: benchParams.sub ?? '',
          initialAmount: benchParams.amount ?? '',
          initialUnit: benchParams.unit ?? 'cup',
        }}
      />
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
  mealCard: { gap: 12, borderColor: colors.line },
  mealHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  dishList: { gap: 2 },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  dishText: { gap: 2, flex: 1 },
  list: { gap: 12 },
  benchRow: { paddingTop: 12, gap: 8 },
  benchHint: { lineHeight: 18 },
});
