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
  const entries = usePlanStore((s) => s.entries);
  const recipes = useRecipeStore((s) => s.recipes);

  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Today's cookable entry — same date helper the Plan screen uses (isSameDay).
  // Prefer dinner, else the first planned meal that carries a recipe.
  const tonight = useMemo(() => {
    const today = new Date();
    const todays = entries.filter(
      (e) => isSameDay(e.date, today) && e.recipeId && e.status !== 'skipped',
    );
    const dinner = todays.find((e) => e.meal === 'dinner');
    const entry = dinner ?? todays[0];
    if (!entry?.recipeId) return null;
    const recipe = recipeById.get(entry.recipeId);
    return recipe ? { entry, recipe } : null;
  }, [entries, recipeById]);

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
            planned {tonight.entry.meal} · serves {tonight.recipe.yield.serves}
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
