import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Button,
  Overlay,
  BottomActionBar,
} from '@/components';
import { colors, layout, type ColorToken } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import type { Meal, PlanEntry, Recipe } from '@/types';
import {
  addWeeks,
  dateKey,
  dayLabel,
  isPastWeek,
  isSameDay,
  startOfWeek,
  weekDays,
  weekOffsetLabel,
  weekRangeLabel,
} from '@/lib/week';

export default function PlanScreen() {
  const router = useRouter();
  const entries = usePlanStore((s) => s.entries);
  const setStatus = usePlanStore((s) => s.setStatus);
  const removeEntry = usePlanStore((s) => s.remove);
  const recipes = useRecipeStore((s) => s.recipes);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [manage, setManage] = useState<PlanEntry | null>(null);

  const readOnly = isPastWeek(weekStart);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Grid lookup derived from the SAME subscribed `entries` the action bar
  // and shopping list use — keeps every surface provably in sync. (Replaces
  // the store's imperative entryFor(), which read get() outside the reactive
  // path and could render stale after returning from the picker modal.)
  const entryIndex = useMemo(() => {
    const m = new Map<string, PlanEntry>();
    for (const e of entries) m.set(`${dateKey(e.date)}|${e.meal}`, e);
    return m;
  }, [entries]);
  const entryFor = (key: string, meal: Meal) => entryIndex.get(`${key}|${meal}`);

  // Action-bar stats: this week's pinned, non-skipped recipes (spec §5).
  const weekKeys = new Set(days.map(dateKey));
  const planned = entries.filter(
    (e) => weekKeys.has(dateKey(e.date)) && e.status !== 'skipped' && e.recipeId,
  );
  const plannedRecipes = planned
    .map((e) => recipeById.get(e.recipeId as string))
    .filter((r): r is Recipe => !!r);
  const ingredientNames = new Set(
    plannedRecipes.flatMap((r) => r.ingredients.map((i) => i.canonicalName)),
  );

  const openPicker = (date: Date, meal: Meal) => {
    if (readOnly) return;
    router.push({
      pathname: '/plan-picker',
      params: { date: date.toISOString(), meal },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Week nav */}
      <View style={styles.weeknav}>
        <Pressable onPress={() => setWeekStart((w) => addWeeks(w, -1))} hitSlop={10}>
          <Glyph name="pageLeft" size={22} color="textMuted" />
        </Pressable>
        <View style={styles.weekmid}>
          <Heading variant="recipeTitle">{weekRangeLabel(weekStart)}</Heading>
          <Text color={readOnly ? 'textFaint' : 'textMuted'}>
            {weekOffsetLabel(weekStart)}
            {readOnly ? ' · read-only' : ''}
          </Text>
        </View>
        <Pressable onPress={() => setWeekStart((w) => addWeeks(w, 1))} hitSlop={10}>
          <Glyph name="pageRight" size={22} color="textMuted" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {days.map((day) => {
          const today = isSameDay(day, new Date());
          const key = dateKey(day);
          const breakfast = entryFor(key, 'breakfast');
          const dinner = entryFor(key, 'dinner');
          const { dow, date } = dayLabel(day);
          return (
            <View key={key} style={styles.dayRow}>
              <View style={styles.dayCol}>
                <Text
                  variant="sectionLabel"
                  color={today ? 'accent' : 'textMuted'}>
                  {dow}
                </Text>
                <Numeric color={today ? 'accent' : 'text'} style={styles.dayNum}>
                  {date}
                </Numeric>
              </View>

              <View style={styles.cells}>
                {breakfast ? (
                  <MealCell
                    entry={breakfast}
                    meal="breakfast"
                    recipe={recipeById.get(breakfast.recipeId ?? '')}
                    onPress={() => setManage(breakfast)}
                  />
                ) : !readOnly ? (
                  <Pressable
                    style={styles.addBreakfast}
                    onPress={() => openPicker(day, 'breakfast')}>
                    <Text color="textFaint">+ breakfast</Text>
                  </Pressable>
                ) : null}

                <MealCell
                  entry={dinner}
                  meal="dinner"
                  recipe={dinner ? recipeById.get(dinner.recipeId ?? '') : undefined}
                  onPress={() =>
                    dinner ? setManage(dinner) : openPicker(day, 'dinner')
                  }
                  readOnly={readOnly}
                />
              </View>
            </View>
          );
        })}
      </ScrollView>

      <BottomActionBar
        meta={
          <View>
            <Numeric color="textMuted">
              {plannedRecipes.length} recipes · {ingredientNames.size} ingredients
            </Numeric>
            <Text color="textFaint">
              {ingredientNames.size} items to shop · pantry coverage with §10
            </Text>
          </View>
        }>
        <Button
          label="Shopping list"
          glyph="next"
          flex
          disabled={plannedRecipes.length === 0}
          onPress={() =>
            router.push({
              pathname: '/shopping',
              params: { weekStart: weekStart.toISOString() },
            })
          }
        />
      </BottomActionBar>

      {/* Manage a pinned entry */}
      <Overlay visible={!!manage} onClose={() => setManage(null)}>
        {manage ? (
          <ManageSheet
            entry={manage}
            recipe={recipeById.get(manage.recipeId ?? '')}
            readOnly={readOnly}
            onOpenRecipe={() => {
              const id = manage.recipeId;
              setManage(null);
              if (id) router.push({ pathname: '/recipes/[id]', params: { id } });
            }}
            onStatus={async (st) => {
              await setStatus(manage.id, st);
              setManage(null);
            }}
            onRemove={async () => {
              await removeEntry(manage.id);
              setManage(null);
            }}
          />
        ) : null}
      </Overlay>
    </SafeAreaView>
  );
}

function MealMarker({ meal, tone }: { meal: Meal; tone: 'primary' | 'muted' | 'warn' }) {
  const letter = meal === 'dinner' ? 'D' : 'B';
  const bg =
    tone === 'warn'
      ? colors.warn
      : tone === 'muted'
        ? 'transparent'
        : meal === 'dinner'
          ? colors.text
          : 'transparent';
  const border = tone === 'muted' ? colors.textFaint : meal === 'breakfast' ? colors.line : bg;
  const fg: ColorToken =
    meal === 'dinner' && tone === 'primary' ? 'bg' : tone === 'muted' ? 'textFaint' : 'text';
  return (
    <View style={[styles.marker, { backgroundColor: bg, borderColor: border }]}>
      <Text variant="sectionLabel" color={fg}>
        {letter}
      </Text>
    </View>
  );
}

function MealCell({
  entry,
  meal,
  recipe,
  onPress,
  readOnly,
}: {
  entry?: PlanEntry;
  meal: Meal;
  recipe?: Recipe;
  onPress: () => void;
  readOnly?: boolean;
}) {
  const small = meal === 'breakfast';

  if (!entry) {
    return (
      <Pressable
        onPress={onPress}
        disabled={readOnly}
        style={[styles.cell, styles.cellEmpty, small && styles.cellSmall]}>
        <Text color="textFaint" style={styles.emptyText}>
          {readOnly ? '—' : 'tap to add'}
        </Text>
      </Pressable>
    );
  }

  const experimental = !!entry.pipelineIdeaId;
  const title = recipe?.title ?? (experimental ? 'experimental idea' : 'recipe');
  const stateStyle =
    entry.status === 'cooked'
      ? styles.cellCooked
      : entry.status === 'skipped'
        ? styles.cellSkipped
        : experimental
          ? styles.cellExp
          : styles.cellPlanned;
  const tone = entry.status === 'planned' && !experimental ? 'primary' : experimental ? 'warn' : 'muted';

  return (
    <Pressable
      onPress={onPress}
      style={[styles.cell, stateStyle, small && styles.cellSmall]}>
      <MealMarker meal={meal} tone={tone} />
      <Text
        variant={small ? 'body' : 'recipeTitle'}
        color={entry.status === 'cooked' ? 'ok' : entry.status === 'skipped' ? 'textFaint' : 'text'}
        numberOfLines={1}
        style={[styles.cellTitle, entry.status === 'skipped' && styles.strike]}>
        {entry.status === 'cooked' ? '✓ ' : ''}
        {title}
      </Text>
      {experimental ? <Text variant="sectionLabel" color="warn">exp</Text> : null}
    </Pressable>
  );
}

function ManageSheet({
  entry,
  recipe,
  readOnly,
  onOpenRecipe,
  onStatus,
  onRemove,
}: {
  entry: PlanEntry;
  recipe?: Recipe;
  readOnly?: boolean;
  onOpenRecipe: () => void;
  onStatus: (s: PlanEntry['status']) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.sheet}>
      <Text variant="recipeTitle">{recipe?.title ?? 'Planned'}</Text>
      <SectionLabel color="textMuted">
        {entry.meal} · {entry.status}
      </SectionLabel>
      {entry.recipeId ? (
        <Button label="Open recipe" glyph="next" variant="secondary" onPress={onOpenRecipe} />
      ) : null}
      {!readOnly ? (
        <>
          {entry.status !== 'cooked' ? (
            <Button label="Mark cooked" glyph="done" onPress={() => onStatus('cooked')} />
          ) : (
            <Button label="Back to planned" variant="secondary" onPress={() => onStatus('planned')} />
          )}
          {entry.status !== 'skipped' ? (
            <Button label="Skip" variant="secondary" onPress={() => onStatus('skipped')} />
          ) : (
            <Button label="Unskip" variant="secondary" onPress={() => onStatus('planned')} />
          )}
          <Pressable onPress={onRemove} style={styles.removeRow}>
            <Text color="accent">Remove from plan</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  weeknav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  weekmid: { alignItems: 'center', gap: 2 },
  grid: { padding: layout.screenPadding, gap: 12 },
  dayRow: { flexDirection: 'row', gap: 14 },
  dayCol: { width: 40, alignItems: 'center', paddingTop: 8 },
  dayNum: { fontSize: 17 },
  cells: { flex: 1, gap: 8 },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 64,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cellSmall: { minHeight: 36, paddingVertical: 8, backgroundColor: colors.bg3 },
  cellPlanned: { backgroundColor: colors.bg2 },
  cellCooked: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  cellSkipped: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  cellExp: {
    borderWidth: 1.5,
    borderColor: colors.warn,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(194,139,43,0.08)',
  },
  cellEmpty: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  emptyText: { fontStyle: 'italic' },
  cellTitle: { flex: 1 },
  strike: { textDecorationLine: 'line-through' },
  addBreakfast: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  marker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: { gap: 12 },
  removeRow: { alignItems: 'center', paddingVertical: 8 },
});
