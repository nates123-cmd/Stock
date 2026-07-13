import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
// Inside a Swipeable, RN's Pressable consumes pointer events before the Pan
// handler can pick them up — rows below use gesture-handler's Pressable so the
// swipe actually registers on web.
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import {
  Text,
  Numeric,
  SectionLabel,
  Button,
  Glyph,
  Overlay,
  BottomActionBar,
  SegmentedControl,
} from '@/components';
import { colors, layout } from '@/design';
import ShoppingList from '@/app/shopping';
import PantryScreen from './pantry';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { useCookPlanStore } from '@/store/cookPlans';
import { useAuthStore } from '@/store/auth';
import { useHaveStore } from '@/store/have';
import { useShopMetaStore } from '@/store/shopMeta';
import { isAlwaysHave, alwaysHaveKey } from '@/lib/alwaysHave';
import type { Dish, Meal, MealType, Recipe } from '@/types';
import { dateKey, dayLabel, isSameDay } from '@/lib/week';

type PlanView = 'horizontal' | 'vertical';
const VIEW_KEY = 'stock:plan-view';

/** Persisted view choice (web-only localStorage, mirrors the shopping
 *  onboarding pattern). Native falls back to the default until an AsyncStorage
 *  pass lands — the toggle still works in-session. */
function loadPlanView(): PlanView {
  if (typeof window === 'undefined') return 'horizontal';
  try {
    return window.localStorage?.getItem(VIEW_KEY) === 'vertical'
      ? 'vertical'
      : 'horizontal';
  } catch {
    return 'horizontal';
  }
}

export default function PlanScreen() {
  const router = useRouter();
  const planMeals = usePlanStore((s) => s.meals);
  const setStatus = usePlanStore((s) => s.setStatus);
  const removeDish = usePlanStore((s) => s.removeDish);
  const setMealType = usePlanStore((s) => s.setMealType);
  const splitMeal = usePlanStore((s) => s.splitMeal);
  const recipes = useRecipeStore((s) => s.recipes);
  const cookPlans = useCookPlanStore((s) => s.plans);

  const [daysAhead, setDaysAhead] = useState(6); // today + next 5
  const [manage, setManage] = useState<{ meal: Meal; dish: Dish } | null>(null);
  // Redesign: Plan tab hosts three segments, Shop leading (shopping is the
  // front door — you live in the list, plan + pantry feed it). Shop and Pantry
  // ("Have") embed the real screens; Plan is the meal model below.
  const [segment, setSegment] = useState<'shop' | 'plan' | 'pantry'>('shop');
  // Plan has two layouts; the choice persists (spec Phase B).
  const [planView, setPlanView] = useState<PlanView>(loadPlanView);
  const setView = (v: PlanView) => {
    setPlanView(v);
    try {
      window.localStorage?.setItem(VIEW_KEY, v);
    } catch {
      /* ignore (native / private mode) */
    }
  };

  // "Today" anchor (midnight ms). Re-anchor on focus / foreground so a session
  // left open past midnight doesn't keep rendering yesterday.
  const [todayMs, setTodayMs] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
  const refreshToday = useCallback(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setTodayMs((prev) => (prev === d.getTime() ? prev : d.getTime()));
  }, []);
  useFocusEffect(refreshToday);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshToday();
    });
    return () => sub.remove();
  }, [refreshToday]);

  // Today + the next (daysAhead - 1) days, anchored today-forward.
  const days = useMemo(() => {
    const start = new Date(todayMs);
    return Array.from({ length: daysAhead }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [daysAhead, todayMs]);

  // Horizontal view: which day's meals are shown below the chip strip.
  const [selectedKey, setSelectedKey] = useState(() => dateKey(new Date(todayMs)));
  useEffect(() => {
    // If the selected day fell outside the window (e.g. after re-anchoring at
    // midnight), snap back to today.
    if (!days.some((d) => dateKey(d) === selectedKey)) {
      setSelectedKey(dateKey(new Date(todayMs)));
    }
  }, [days, selectedKey, todayMs]);

  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    recipes.forEach((r) => m.set(r.id, r));
    return m;
  }, [recipes]);

  // Cook Plans scheduled within the rolling window — the Plan-tab "shadow" of
  // a plan that lives in the Recipes library (see CookPlanCard / detail).
  const upcomingPlans = useMemo(() => {
    const windowEnd = todayMs + daysAhead * 86_400_000;
    return cookPlans
      .filter((p) => p.serveAt && p.status !== 'archived')
      .filter((p) => {
        const t = (p.serveAt as Date).getTime();
        return t >= todayMs && t < windowEnd;
      })
      .sort((a, b) => (a.serveAt as Date).getTime() - (b.serveAt as Date).getTime());
  }, [cookPlans, todayMs, daysAhead]);

  // Meals grouped by local day key — derived from the SAME subscribed store the
  // action bar + shopping list read, so every surface stays in sync.
  const mealsByDay = useMemo(() => {
    const m = new Map<string, Meal[]>();
    for (const meal of planMeals) {
      const k = dateKey(meal.date);
      (m.get(k) ?? m.set(k, []).get(k)!).push(meal);
    }
    return m;
  }, [planMeals]);

  const dishLabel = (dish: Dish): string => {
    if (dish.recipeId) return recipeById.get(dish.recipeId)?.title ?? dish.title;
    return dish.title || (dish.pipelineId ? 'experimental idea' : 'dish');
  };

  // Action-bar stats: this window's planned, non-skipped recipe dishes.
  const weekKeys = useMemo(() => new Set(days.map(dateKey)), [days]);
  const plannedRecipes = useMemo(() => {
    const out: Recipe[] = [];
    for (const meal of planMeals) {
      if (!weekKeys.has(dateKey(meal.date))) continue;
      if ((meal.status ?? 'planned') === 'skipped') continue;
      for (const d of meal.dishes) {
        const r = d.recipeId ? recipeById.get(d.recipeId) : undefined;
        if (r) out.push(r);
      }
    }
    return out;
  }, [planMeals, weekKeys, recipeById]);
  const ingredientNames = useMemo(
    () =>
      new Set(plannedRecipes.flatMap((r) => r.ingredients.map((i) => i.canonicalName))),
    [plannedRecipes],
  );

  // Pantry coverage proxy: planned canonicals the shopping list will drop —
  // always-have (canonical isAlwaysHave, same predicate the list uses) plus
  // items suppressed off prior plan → shopping runs (note 7a). Keeps this
  // count honest with what Shop actually shows.
  const alwaysHaveMap = useHaveStore((s) => s.alwaysHave);
  const suppressedMap = useShopMetaStore((s) => s.suppressed);
  const pantryCovers = useMemo(() => {
    let n = 0;
    for (const name of ingredientNames) {
      if (
        isAlwaysHave(name, alwaysHaveMap) ||
        suppressedMap[alwaysHaveKey(name)] === true
      )
        n += 1;
    }
    return n;
  }, [ingredientNames, alwaysHaveMap, suppressedMap]);
  const toShop = Math.max(0, ingredientNames.size - pantryCovers);

  const openPicker = (date: Date, type?: MealType | null) => {
    router.push({
      pathname: '/plan-picker',
      params: type ? { date: date.toISOString(), type } : { date: date.toISOString() },
    });
  };

  const selectedDay = useMemo(() => {
    const d = days.find((day) => dateKey(day) === selectedKey);
    return d ?? days[0] ?? new Date(todayMs);
  }, [days, selectedKey, todayMs]);

  const renderDay = (day: Date) => (
    <DayMeals
      key={dateKey(day)}
      day={day}
      today={isSameDay(day, new Date(todayMs))}
      meals={mealsByDay.get(dateKey(day)) ?? []}
      dishLabel={dishLabel}
      onAdd={() => openPicker(day)}
      onDelete={(mealId, dishId) => removeDish(mealId, dishId)}
      onOpenDish={(meal, dish) => setManage({ meal, dish })}
    />
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <AccountBar />

      <View style={styles.segments}>
        <SegmentedControl
          segments={[
            { key: 'shop', label: 'Shop' },
            { key: 'plan', label: 'Plan' },
            { key: 'pantry', label: 'Pantry' },
          ]}
          value={segment}
          onChange={(k) => setSegment(k as 'shop' | 'plan' | 'pantry')}
        />
      </View>

      {segment === 'shop' ? (
        // The shopping list IS the front door (embedded — no own safe-area /
        // Done button). Plan + pantry low/out feed it; buying feeds the pantry.
        <View style={styles.embed}>
          <ShoppingList embedded />
        </View>
      ) : segment === 'pantry' ? (
        // "Have" = the pantry: what you've got, what's low/out. Low + out
        // surface back onto Shop; buying an item lands it here.
        <View style={styles.embed}>
          <PantryScreen />
        </View>
      ) : (
        <>
          <View style={styles.viewToggleRow}>
            <ViewToggle value={planView} onChange={setView} />
          </View>

          {upcomingPlans.length > 0 ? (
            <View style={styles.planShadow}>
              <SectionLabel color="textMuted">Cook plans coming up</SectionLabel>
              {upcomingPlans.map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.planShadowRow}
                  onPress={() =>
                    router.push({ pathname: '/cook-plan/[id]', params: { id: p.id } })
                  }>
                  <View style={styles.planMarker}>
                    <Text variant="sectionLabel" color="bg">
                      ◷
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Text variant="sectionLabel" color="accent">
                      {(p.serveAt as Date).toLocaleString(undefined, {
                        weekday: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}{' '}
                      · {p.phases.length} phases
                    </Text>
                  </View>
                  <Text color="textFaint">›</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {planView === 'horizontal' ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipStrip}>
                {days.map((day) => {
                  const key = dateKey(day);
                  const today = isSameDay(day, new Date(todayMs));
                  const selected = key === selectedKey;
                  const { dow, date } = dayLabel(day);
                  const count = (mealsByDay.get(key) ?? []).reduce(
                    (n, m) => n + m.dishes.length,
                    0,
                  );
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setSelectedKey(key)}
                      style={[styles.dayChip, selected && styles.dayChipOn]}>
                      <Text
                        variant="sectionLabel"
                        color={today ? 'accent' : selected ? 'text' : 'textMuted'}>
                        {today ? 'TODAY' : dow}
                      </Text>
                      <Numeric color={selected ? 'text' : 'textMuted'} style={styles.dayChipNum}>
                        {date}
                      </Numeric>
                      {count > 0 ? (
                        <View style={[styles.dot, selected && styles.dotOn]} />
                      ) : (
                        <View style={styles.dotSpacer} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <ScrollView contentContainerStyle={styles.dayScroll}>
                {renderDay(selectedDay)}
              </ScrollView>
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.agenda}>
              {days.map((day) => renderDay(day))}
              <Pressable
                style={styles.moreDays}
                onPress={() => setDaysAhead((n) => n + 7)}>
                <Text color="textFaint">+ Show more days</Text>
              </Pressable>
            </ScrollView>
          )}

          <BottomActionBar
            meta={
              <View>
                <Numeric color="textMuted">
                  {plannedRecipes.length} recipes · {ingredientNames.size} ingredients
                  {pantryCovers > 0 ? ` · pantry covers ${pantryCovers}` : ''}
                </Numeric>
                <Text color="textFaint">{toShop} items to shop</Text>
              </View>
            }>
            <Button
              label="Shopping list"
              glyph="next"
              flex
              disabled={plannedRecipes.length === 0}
              onPress={() =>
                router.push({
                  pathname: '/shopping-confirm',
                  params: { days: String(daysAhead) },
                })
              }
            />
          </BottomActionBar>
        </>
      )}

      {/* Manage a dish */}
      <Overlay visible={!!manage} onClose={() => setManage(null)}>
        {manage ? (
          <ManageSheet
            meal={manage.meal}
            dish={manage.dish}
            title={dishLabel(manage.dish)}
            onOpenRecipe={() => {
              const id = manage.dish.recipeId;
              setManage(null);
              if (id) router.push({ pathname: '/recipes/[id]', params: { id } });
            }}
            onStatus={async (st) => {
              await setStatus(manage.meal.id, st);
              setManage(null);
            }}
            onSplit={async (type) => {
              // Split when the meal has siblings; otherwise just label it.
              if (manage.meal.dishes.length > 1) {
                await splitMeal(manage.meal.id, manage.dish.id, type);
              } else {
                await setMealType(manage.meal.id, type);
              }
              setManage(null);
            }}
            onMerge={async () => {
              await setMealType(manage.meal.id, null);
              setManage(null);
            }}
            onRemove={async () => {
              await removeDish(manage.meal.id, manage.dish.id);
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
      // Cast: typedRoutes' generated Href union isn't refreshed by `expo
      // export`; runtime resolution is fine.
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

/** Compact two-icon layout toggle (day-chips vs agenda). */
function ViewToggle({
  value,
  onChange,
}: {
  value: PlanView;
  onChange: (v: PlanView) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Pressable
        onPress={() => onChange('horizontal')}
        accessibilityRole="button"
        accessibilityLabel="Day-chips view"
        accessibilityState={{ selected: value === 'horizontal' }}
        style={[styles.toggleBtn, value === 'horizontal' && styles.toggleBtnOn]}>
        <Glyph name="dayChips" size={16} color={value === 'horizontal' ? 'bg' : 'textMuted'} />
      </Pressable>
      <Pressable
        onPress={() => onChange('vertical')}
        accessibilityRole="button"
        accessibilityLabel="Agenda view"
        accessibilityState={{ selected: value === 'vertical' }}
        style={[styles.toggleBtn, value === 'vertical' && styles.toggleBtnOn]}>
        <Glyph name="agenda" size={16} color={value === 'vertical' ? 'bg' : 'textMuted'} />
      </Pressable>
    </View>
  );
}

/** A day section: its meal(s) and their dishes, plus an add-dish affordance. */
function DayMeals({
  day,
  today,
  meals,
  dishLabel,
  onAdd,
  onDelete,
  onOpenDish,
}: {
  day: Date;
  today: boolean;
  meals: Meal[];
  dishLabel: (d: Dish) => string;
  onAdd: () => void;
  onDelete: (mealId: string, dishId: string) => void;
  onOpenDish: (meal: Meal, dish: Dish) => void;
}) {
  const { dow, date } = dayLabel(day);
  const empty = meals.every((m) => m.dishes.length === 0);
  return (
    <View style={styles.dayBlock}>
      <View style={styles.dayHead}>
        <Text variant="sectionLabel" color={today ? 'accent' : 'textMuted'}>
          {today ? 'TODAY' : dow}
        </Text>
        <Numeric color={today ? 'accent' : 'text'} style={styles.dayHeadNum}>
          {date}
        </Numeric>
      </View>

      {empty ? (
        <Text color="textFaint" style={styles.dayEmpty}>
          Nothing planned.
        </Text>
      ) : (
        meals.map((meal) =>
          meal.dishes.length === 0 ? null : (
            <View key={meal.id} style={styles.meal}>
              {meal.type ? (
                <Text variant="sectionLabel" color="textMuted" style={styles.mealType}>
                  {meal.type}
                </Text>
              ) : null}
              {meal.dishes.map((dish) => (
                <SwipeableDish key={dish.id} onDelete={() => onDelete(meal.id, dish.id)}>
                  <DishRow
                    meal={meal}
                    label={dishLabel(dish)}
                    experimental={!!dish.pipelineId}
                    onPress={() => onOpenDish(meal, dish)}
                  />
                </SwipeableDish>
              ))}
            </View>
          ),
        )
      )}

      <Pressable style={styles.addDish} onPress={onAdd}>
        <Glyph name="add" size={14} color="textFaint" />
        <Text color="textFaint">Add dish</Text>
      </Pressable>
    </View>
  );
}

function DishRow({
  meal,
  label,
  experimental,
  onPress,
}: {
  meal: Meal;
  label: string;
  experimental: boolean;
  onPress: () => void;
}) {
  const cooked = meal.status === 'cooked';
  const skipped = meal.status === 'skipped';
  const stateStyle = cooked
    ? styles.dishCooked
    : skipped
      ? styles.dishSkipped
      : experimental
        ? styles.dishExp
        : styles.dishPlanned;
  return (
    <GHPressable onPress={onPress} style={[styles.dish, stateStyle]}>
      <Text
        color={cooked ? 'ok' : skipped ? 'textFaint' : 'text'}
        numberOfLines={1}
        style={[styles.dishTitle, skipped && styles.strike]}>
        {cooked ? '✓ ' : ''}
        {label}
      </Text>
      {experimental ? (
        <Text variant="sectionLabel" color="warn">
          exp
        </Text>
      ) : null}
    </GHPressable>
  );
}

/** Wraps a DishRow with the swipe-left → Delete affordance. */
function SwipeableDish({
  onDelete,
  children,
}: {
  onDelete: () => void;
  children: ReactNode;
}) {
  const swipeRef = useRef<SwipeableMethods | null>(null);
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1.5}
      rightThreshold={48}
      overshootRight={false}
      onSwipeableOpen={() => {
        swipeRef.current?.close();
        onDelete();
      }}
      renderRightActions={() => (
        <View
          style={styles.deleteAction}
          accessibilityLabel="Swipe to remove dish from plan">
          <Text color="bg" variant="bodyStrong" style={styles.deleteLabel}>
            Delete
          </Text>
        </View>
      )}>
      {children}
    </ReanimatedSwipeable>
  );
}

function ManageSheet({
  meal,
  dish,
  title,
  onOpenRecipe,
  onStatus,
  onSplit,
  onMerge,
  onRemove,
}: {
  meal: Meal;
  dish: Dish;
  title: string;
  onOpenRecipe: () => void;
  onStatus: (s: NonNullable<Meal['status']>) => void;
  onSplit: (type: MealType) => void;
  onMerge: () => void;
  onRemove: () => void;
}) {
  const status = meal.status ?? 'planned';
  return (
    <View style={styles.sheet}>
      <Text variant="recipeTitle">{title}</Text>
      <SectionLabel color="textMuted">
        {meal.type ?? 'meal'} · {status}
      </SectionLabel>
      {dish.recipeId ? (
        <Button label="Open recipe" glyph="next" variant="secondary" onPress={onOpenRecipe} />
      ) : null}

      {status !== 'cooked' ? (
        <Button label="Mark cooked" glyph="done" onPress={() => onStatus('cooked')} />
      ) : (
        <Button label="Back to planned" variant="secondary" onPress={() => onStatus('planned')} />
      )}
      {status !== 'skipped' ? (
        <Button label="Skip" variant="secondary" onPress={() => onStatus('skipped')} />
      ) : (
        <Button label="Unskip" variant="secondary" onPress={() => onStatus('planned')} />
      )}

      {/* Optional lunch/dinner split (merge-by-default is the norm). */}
      <View style={styles.splitRow}>
        <Button
          label="→ Lunch"
          variant="secondary"
          flex
          onPress={() => onSplit('lunch')}
        />
        <Button
          label="→ Dinner"
          variant="secondary"
          flex
          onPress={() => onSplit('dinner')}
        />
      </View>
      {meal.type ? (
        <Pressable onPress={onMerge} style={styles.mergeRow}>
          <Text color="textMuted">Clear split (merge into the day)</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={onRemove} style={styles.removeRow}>
        <Text color="accent">Remove from plan</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  planShadow: {
    gap: 8,
    paddingBottom: 6,
  },
  planShadowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bg2,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.warn,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  planMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.warn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountBar: {
    alignItems: 'flex-end',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
  },
  segments: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
    paddingBottom: 6,
  },
  embed: { flex: 1 },
  viewToggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 4,
    paddingBottom: 4,
  },
  toggle: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: colors.bg2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 3,
  },
  toggleBtn: {
    width: 34,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnOn: { backgroundColor: colors.accent },

  // Horizontal day-chip strip.
  chipStrip: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 8,
    gap: 8,
  },
  dayChip: {
    minWidth: 56,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 2,
  },
  dayChipOn: { borderColor: colors.accent, backgroundColor: colors.bg3 },
  dayChipNum: { fontSize: 18 },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.textFaint,
    marginTop: 2,
  },
  dotOn: { backgroundColor: colors.accent },
  dotSpacer: { width: 5, height: 5, marginTop: 2 },

  dayScroll: { padding: layout.screenPadding, paddingTop: 6, gap: 14 },
  agenda: { padding: layout.screenPadding, gap: 14 },
  moreDays: { alignItems: 'center', paddingVertical: 16 },

  dayBlock: {
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineSoft,
  },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  dayHeadNum: { fontSize: 19 },
  dayEmpty: { fontStyle: 'italic', paddingVertical: 2 },
  meal: { gap: 6 },
  mealType: { textTransform: 'capitalize' },
  dish: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dishPlanned: { backgroundColor: colors.bg2 },
  dishCooked: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  dishSkipped: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  dishExp: {
    borderWidth: 1.5,
    borderColor: colors.warn,
    borderStyle: 'dashed',
    backgroundColor: 'rgba(194,139,43,0.08)',
  },
  // minWidth: 0 lets the title shrink on narrow phones (RN/web flex children
  // default to min-content sizing).
  dishTitle: { flex: 1, minWidth: 0 },
  strike: { textDecorationLine: 'line-through' },
  addDish: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 4,
  },
  sheet: { gap: 12 },
  splitRow: { flexDirection: 'row', gap: 10 },
  mergeRow: { alignItems: 'center', paddingVertical: 4 },
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
});
