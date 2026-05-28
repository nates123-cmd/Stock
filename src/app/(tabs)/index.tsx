import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
// Inside a Swipeable, RN's Pressable consumes pointer events before the Pan
// handler can pick them up — swaps below use gesture-handler's Pressable so
// the swipe actually registers on web.
import { Pressable as GHPressable } from 'react-native-gesture-handler';
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
import { useAuthStore } from '@/store/auth';
import { useHaveStore } from '@/store/have';
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
  // For the current week, hide already-past days — today should always be
  // the first row. Other weeks (past read-only, future planning) show all
  // 7 days so the grid is still a complete week-at-a-glance.
  const days = useMemo(() => {
    const all = weekDays(weekStart);
    const isCurrentWeek =
      startOfWeek(new Date()).getTime() === weekStart.getTime();
    if (!isCurrentWeek) return all;
    const todayKey = dateKey(new Date());
    return all.filter((d) => dateKey(d) >= todayKey);
  }, [weekStart]);
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

  // Pantry coverage (spec §5): count of distinct planned canonicals already
  // covered by the user's "always have" pins. Until the full Pantry pillar
  // ships (§10) the always-have set is the proxy for in-stock inventory.
  const alwaysHaveMap = useHaveStore((s) => s.alwaysHave);
  const pantryCovers = useMemo(() => {
    let n = 0;
    for (const name of ingredientNames) {
      if (alwaysHaveMap[name.toLowerCase().trim()]) n += 1;
    }
    return n;
  }, [ingredientNames, alwaysHaveMap]);
  const toShop = Math.max(0, ingredientNames.size - pantryCovers);

  const openPicker = (date: Date, meal: Meal) => {
    if (readOnly) return;
    router.push({
      pathname: '/plan-picker',
      params: { date: date.toISOString(), meal },
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <AccountBar />
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
          const lunch = entryFor(key, 'lunch');
          const dinner = entryFor(key, 'dinner');
          const { dow, date } = dayLabel(day);
          return (
            <View key={key} style={styles.dayRow}>
              <View style={styles.dayCol}>
                <Text
                  variant="sectionLabel"
                  color={today ? 'accent' : 'textMuted'}>
                  {today ? 'TODAY' : dow}
                </Text>
                <Numeric color={today ? 'accent' : 'text'} style={styles.dayNum}>
                  {date}
                </Numeric>
              </View>

              <View style={styles.cells}>
                {breakfast ? (
                  <SwipeableMeal
                    onDelete={readOnly ? undefined : () => removeEntry(breakfast.id)}>
                    <MealCell
                      entry={breakfast}
                      meal="breakfast"
                      recipe={recipeById.get(breakfast.recipeId ?? '')}
                      onPress={() => setManage(breakfast)}
                    />
                  </SwipeableMeal>
                ) : !readOnly ? (
                  <Pressable
                    style={styles.addSide}
                    onPress={() => openPicker(day, 'breakfast')}>
                    <Text color="textFaint">+ breakfast</Text>
                  </Pressable>
                ) : null}

                {lunch ? (
                  <SwipeableMeal
                    onDelete={readOnly ? undefined : () => removeEntry(lunch.id)}>
                    <MealCell
                      entry={lunch}
                      meal="lunch"
                      recipe={recipeById.get(lunch.recipeId ?? '')}
                      onPress={() => setManage(lunch)}
                    />
                  </SwipeableMeal>
                ) : !readOnly ? (
                  <Pressable
                    style={styles.addSide}
                    onPress={() => openPicker(day, 'lunch')}>
                    <Text color="textFaint">+ lunch</Text>
                  </Pressable>
                ) : null}

                {dinner ? (
                  <SwipeableMeal
                    onDelete={readOnly ? undefined : () => removeEntry(dinner.id)}>
                    <MealCell
                      entry={dinner}
                      meal="dinner"
                      recipe={recipeById.get(dinner.recipeId ?? '')}
                      onPress={() => setManage(dinner)}
                      readOnly={readOnly}
                    />
                  </SwipeableMeal>
                ) : (
                  <MealCell
                    entry={undefined}
                    meal="dinner"
                    onPress={() => openPicker(day, 'dinner')}
                    readOnly={readOnly}
                  />
                )}
              </View>
            </View>
          );
        })}
        {days.length === 0 ? (
          <Text color="textMuted" style={styles.emptyWeek}>
            Nothing left in this week. Tap → for next week.
          </Text>
        ) : null}
      </ScrollView>

      <BottomActionBar
        meta={
          <View>
            <Numeric color="textMuted">
              {plannedRecipes.length} recipes · {ingredientNames.size} ingredients
              {pantryCovers > 0 ? ` · pantry covers ${pantryCovers}` : ''}
            </Numeric>
            <Text color="textFaint">
              {toShop} items to shop
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

function AccountBar() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  return (
    <Pressable
      // Cast: expo's typedRoutes generates .expo/types/router.d.ts only on
      // `expo start`; `expo export` doesn't refresh it, so a newly-added route
      // isn't in the typed Href union yet. Runtime resolution works fine.
      onPress={() => router.push('/sign-in' as never)}
      hitSlop={8}
      style={styles.accountBar}>
      {user ? (
        <Text variant="sectionLabel" color="textMuted">
          ✓ {user.email}
        </Text>
      ) : (
        <Text variant="sectionLabel" color="accent">
          Sign in to sync →
        </Text>
      )}
    </Pressable>
  );
}

/** Wraps a pinned MealCell with the swipe-left → Delete affordance. When
 *  `onDelete` is omitted (e.g., a read-only past week) the swipe is a no-op
 *  — children render bare so we don't pay the Reanimated overhead. */
function SwipeableMeal({
  onDelete,
  children,
}: {
  onDelete?: () => void;
  children: ReactNode;
}) {
  const swipeRef = useRef<SwipeableMethods | null>(null);
  if (!onDelete) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1.5}
      rightThreshold={48}
      overshootRight={false}
      onSwipeableOpen={() => {
        // Snap back first so the row animation finishes cleanly even though
        // the parent will unmount us when removeEntry runs.
        swipeRef.current?.close();
        onDelete();
      }}
      renderRightActions={() => (
        <View
          style={styles.deleteAction}
          accessibilityLabel="Swipe to delete meal from plan">
          <Text color="bg" variant="bodyStrong" style={styles.deleteLabel}>
            Delete
          </Text>
        </View>
      )}>
      {children}
    </ReanimatedSwipeable>
  );
}

function MealMarker({ meal, tone }: { meal: Meal; tone: 'primary' | 'muted' | 'warn' }) {
  // B / L are secondary (cream/outlined); D is primary (espresso-filled).
  const letter = meal === 'dinner' ? 'D' : meal === 'lunch' ? 'L' : 'B';
  const isPrimary = meal === 'dinner';
  const bg =
    tone === 'warn'
      ? colors.warn
      : tone === 'muted'
        ? 'transparent'
        : isPrimary
          ? colors.text
          : 'transparent';
  const border = tone === 'muted' ? colors.textFaint : !isPrimary ? colors.line : bg;
  const fg: ColorToken =
    isPrimary && tone === 'primary' ? 'bg' : tone === 'muted' ? 'textFaint' : 'text';
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
  // Breakfast + lunch are the small/secondary cells; dinner is the main row.
  const small = meal !== 'dinner';

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
    <GHPressable
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
    </GHPressable>
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
  accountBar: {
    alignItems: 'flex-end',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
  },
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
  // Day-row hierarchy (spec §5): grouping is visual, not structural — each
  // day's rows share a card-like container with a left gutter pinning the
  // day label so empty + breakfast / + lunch cells anchor to a date instead
  // of floating as free text. (Pre-fix the day label sat in its own narrow
  // column with no shared background, which read as flat list of strings.)
  grid: { padding: layout.screenPadding, gap: 14 },
  dayRow: {
    flexDirection: 'row',
    gap: 14,
    paddingTop: 6,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineSoft,
  },
  dayCol: { width: 44, alignItems: 'flex-start', paddingTop: 12, paddingLeft: 2 },
  dayNum: { fontSize: 19 },
  cells: { flex: 1, gap: 6 },
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
  // minWidth: 0 lets the title shrink on narrow phones — RN/web flex
  // children default to min-content sizing, so without this a long recipe
  // title shoves the `exp` tag off the row. Same defensive pattern used in
  // shopping.tsx (#10 overlapping text on mobile).
  cellTitle: { flex: 1, minWidth: 0 },
  strike: { textDecorationLine: 'line-through' },
  addSide: {
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
  deleteAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 22,
    borderRadius: 12,
    marginLeft: 6,
  },
  deleteLabel: { fontSize: 13 },
  emptyWeek: { textAlign: 'center', paddingVertical: 24, fontStyle: 'italic' },
});
