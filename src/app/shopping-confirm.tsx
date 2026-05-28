import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, Heading, Button, BottomActionBar } from '@/components';
import { colors, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { dateKey, dayTag } from '@/lib/week';
import type { Meal, Recipe } from '@/types';

const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

// Graceful fallback (Expo Router route boundary) instead of a blank screen.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={styles.boundary}>
      <Heading variant="screenTitle">Couldn't open the confirm step</Heading>
      <Text color="textMuted">{String(error?.message ?? error)}</Text>
      <Pressable onPress={retry}>
        <Text color="accent">Tap to retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * Shopping confirm step (spec §8 follow-on). Lists the planned meals in the
 * Plan's rolling window, all checked by default (90% of the time you shop for
 * everything). Uncheck the exceptions, then Build list scopes the shopping
 * screen to exactly the chosen entries.
 */
export default function ShoppingConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ days?: string }>();
  const daysAhead = Math.min(60, Math.max(1, Number(params.days) || 6));
  const entries = usePlanStore((s) => s.entries);
  const recipes = useRecipeStore((s) => s.recipes);

  const meals = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const windowKeys = new Set(
      Array.from({ length: daysAhead }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return dateKey(d);
      }),
    );
    const byId = new Map<string, Recipe>(recipes.map((r) => [r.id, r]));
    return entries
      .filter(
        (e) =>
          e.status === 'planned' && e.recipeId && windowKeys.has(dateKey(e.date)),
      )
      .map((e) => ({ entry: e, recipe: byId.get(e.recipeId as string) }))
      .filter((m) => !!m.recipe)
      .sort(
        (a, b) =>
          new Date(a.entry.date).getTime() - new Date(b.entry.date).getTime(),
      );
  }, [entries, recipes, daysAhead]);

  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = meals
    .map((m) => m.entry.id)
    .filter((id) => !excluded.has(id));

  const buildList = () => {
    router.replace({
      pathname: '/shopping',
      params: { entryIds: selectedIds.join(',') },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Heading variant="screenTitle">Shop for…</Heading>
          <Text color="textMuted">
            Next {daysAhead} days · uncheck anything to skip
          </Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Cancel
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {meals.length === 0 ? (
          <Text color="textMuted" style={styles.empty}>
            No planned meals in the next {daysAhead} days yet.
          </Text>
        ) : (
          meals.map(({ entry, recipe }) => {
            const checked = !excluded.has(entry.id);
            return (
              <Pressable
                key={entry.id}
                style={styles.row}
                onPress={() => toggle(entry.id)}>
                <View style={[styles.box, checked && styles.boxOn]}>
                  {checked ? <Text style={styles.check}>✓</Text> : null}
                </View>
                <View style={styles.flex}>
                  <Text numberOfLines={1}>{recipe!.title}</Text>
                  <Text color="textMuted" variant="sectionLabel">
                    {dayTag(new Date(entry.date))} · {MEAL_LABEL[entry.meal]}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <BottomActionBar>
        <Button
          label={`Build list (${selectedIds.length})`}
          glyph="next"
          flex
          disabled={selectedIds.length === 0}
          onPress={buildList}
        />
      </BottomActionBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  flex: { flex: 1, gap: 2 },
  list: { padding: layout.screenPadding, gap: 8 },
  empty: { textAlign: 'center', paddingVertical: 32, fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bg2,
    borderRadius: 12,
    padding: 14,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  check: { color: colors.bg, fontWeight: '700', fontSize: 13 },
  boundary: {
    flex: 1,
    padding: 24,
    gap: 12,
    backgroundColor: colors.bg,
    justifyContent: 'center',
  },
});
