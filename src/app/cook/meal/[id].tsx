import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  AwakeIndicator,
  BenchSheet,
} from '@/components';
import { colors, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { dayTag } from '@/lib/week';
import { combineMeal, type CombineDish, type CombinedPlan } from '@/lib/combineMeal';
import type { Recipe } from '@/types';

/**
 * Whole-meal cook mode (redesign Phase C). Renders the Combine output: one
 * back-scheduled timeline (`combineMeal`) merging every dish's steps, anchored
 * to serve time. Current-step emphasis + the full ordered list, make-ahead
 * steps first. Falls back to a per-dish sequential list offline (never blocks).
 * Cooking a single dish still uses cook/[id]; Bench folds in as a sheet.
 */
export default function MealCookScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const meal = usePlanStore((s) => s.meals.find((m) => m.id === id));
  const recipes = useRecipeStore((s) => s.recipes);

  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Cookable dishes: recipe dishes whose recipe still resolves and isn't
  // archived (same rule as the Cook launcher).
  const dishes = useMemo(() => {
    if (!meal) return [] as { title: string; recipe: Recipe }[];
    return meal.dishes
      .map((d) => (d.recipeId ? recipeById.get(d.recipeId) : undefined))
      .filter((r): r is Recipe => !!r && r.status !== 'archived')
      .map((r) => ({ title: r.title, recipe: r }));
  }, [meal, recipeById]);

  const [plan, setPlan] = useState<CombinedPlan | null>(null);
  const [busy, setBusy] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [benchOpen, setBenchOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Build (or reuse cached) timeline once the dishes resolve. combineMeal is
  // tolerant — it always resolves, degrading to the offline fallback.
  const generate = useMemo(
    () =>
      async (force = false) => {
        if (dishes.length === 0) {
          setPlan({ steps: [], source: 'fallback' });
          setBusy(false);
          return;
        }
        setBusy(true);
        const payload: CombineDish[] = dishes.map((d) => ({
          title: d.title,
          steps: d.recipe.steps,
        }));
        const result = await combineMeal(payload, {
          serveLabel: meal?.type ?? 'serve',
          force,
        });
        setPlan(result);
        setStepIndex(0);
        setDoneSteps(new Set());
        setReady(false);
        setBusy(false);
      },
    [dishes, meal?.type],
  );

  useEffect(() => {
    void generate(false);
  }, [generate]);

  if (!meal) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text color="textMuted">Meal not found.</Text>
          <Button label="Close" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const launchDish = (recipeId: string) =>
    router.push({ pathname: '/cook/[id]', params: { id: recipeId } } as never);

  const steps = plan?.steps ?? [];
  const advance = () => {
    setDoneSteps((prev) => new Set(prev).add(stepIndex));
    if (stepIndex >= steps.length - 1) setReady(true);
    else setStepIndex((i) => i + 1);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Exit
          </Text>
        </Pressable>
        <Text variant="recipeTitle" numberOfLines={1} style={styles.topTitle}>
          {dishes.length > 1 ? `${dishes.length} dishes` : dishes[0]?.title ?? 'Meal'}
        </Text>
        <AwakeIndicator />
      </View>

      <Text color="textFaint" style={styles.context}>
        {dayTag(meal.date)}
        {meal.type ? ` · ${meal.type}` : ''} · one timeline to serve
      </Text>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Dishes — jump into a single-dish cook if you'd rather. */}
        <Card style={styles.dishCard}>
          <SectionLabel color="textMuted">Dishes</SectionLabel>
          {dishes.map((d) => (
            <Pressable
              key={d.recipe.id}
              style={styles.dishRow}
              onPress={() => launchDish(d.recipe.id)}
              accessibilityRole="button">
              <Text variant="bodyStrong" style={styles.flex}>
                {d.title}
              </Text>
              <Text color="accent">Cook alone</Text>
            </Pressable>
          ))}
        </Card>

        {busy ? (
          <Card style={styles.stateCard}>
            <Text color="textMuted">Building the timeline…</Text>
          </Card>
        ) : plan && plan.source === 'fallback' ? (
          <Text color="textFaint" style={styles.fallbackNote}>
            Offline order — each dish's steps in sequence (no back-scheduling).
            Connect Claude for one interleaved, timed plan.
          </Text>
        ) : null}

        {!busy && steps.length > 0 ? (
          <View style={styles.timeline}>
            {steps.map((s, i) => {
              const done = doneSteps.has(i);
              const current = i === stepIndex && !ready;
              return (
                <Pressable
                  key={`${i}-${s.text}`}
                  style={[styles.stepRow, current && styles.stepRowCurrent]}
                  onPress={() => {
                    setStepIndex(i);
                    setReady(false);
                  }}>
                  <View style={styles.stepOffsetCol}>
                    {s.offsetLabel ? (
                      <Numeric color={current ? 'accent' : done ? 'ok' : 'textMuted'}>
                        {s.offsetLabel}
                      </Numeric>
                    ) : (
                      <Text color={current ? 'accent' : done ? 'ok' : 'textFaint'}>
                        {done ? '✓' : '·'}
                      </Text>
                    )}
                  </View>
                  <View style={styles.flex}>
                    <Text
                      variant={current ? 'bodyStrong' : 'body'}
                      color={done && !current ? 'textMuted' : 'text'}
                      style={done && !current ? styles.strike : undefined}>
                      {s.text}
                    </Text>
                    {s.dish ? (
                      <Text color="textFaint" style={styles.stepDish}>
                        {s.dish}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!busy && steps.length === 0 ? (
          <Card style={styles.stateCard}>
            <Text color="textMuted">These dishes have no steps to combine.</Text>
          </Card>
        ) : null}

        {!busy ? (
          <Pressable onPress={() => void generate(true)} style={styles.regen} hitSlop={6}>
            <Glyph name="undo" size={14} color="textMuted" />
            <Text color="textMuted">Regenerate timeline</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={() => setBenchOpen(true)} style={styles.benchLink} hitSlop={6}>
          <Glyph name="bench" size={14} color="textMuted" />
          <Text color="textMuted">Open Bench (scale · convert · sub)</Text>
        </Pressable>
      </ScrollView>

      {!busy && steps.length > 0 ? (
        <View style={styles.actionBar}>
          {ready ? (
            <Button label="Meal ready · done" glyph="done" flex onPress={() => router.back()} />
          ) : (
            <Button
              label={stepIndex >= steps.length - 1 ? 'Done' : 'Next'}
              glyph="next"
              flex
              onPress={advance}
            />
          )}
        </View>
      ) : null}

      <BenchSheet visible={benchOpen} onClose={() => setBenchOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgCook },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    paddingBottom: 10,
  },
  topTitle: { flex: 1, textAlign: 'center', marginHorizontal: 10 },
  context: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 6,
    fontStyle: 'italic',
  },
  content: { padding: layout.screenPadding, gap: 14, paddingBottom: 30 },
  dishCard: { gap: 8 },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  stateCard: { alignItems: 'center', paddingVertical: 18 },
  fallbackNote: { lineHeight: 18, fontStyle: 'italic' },
  timeline: { gap: 2 },
  stepRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginHorizontal: -12,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  stepRowCurrent: { backgroundColor: colors.bg2 },
  stepOffsetCol: { minWidth: 54 },
  stepDish: { paddingTop: 2 },
  strike: { textDecorationLine: 'line-through' },
  regen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingVertical: 8,
  },
  benchLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingVertical: 6,
  },
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    paddingBottom: 8,
  },
});
