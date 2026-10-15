/**
 * What the Cook tab leads with, and what it offers for the rest of the week.
 *
 * Two kinds of thing can be "what's on tonight":
 *  - a planned Meal (Plan tab, Day → Meals → Dishes) whose dishes resolve to
 *    recipes. A dish can be a plain recipe or a DINNER (a recipe that links
 *    other recipes, lib/dinners). The Plan tab opens a dinner on its recipe
 *    page, where every linked recipe is listed; Cook used to launch it straight
 *    into cook mode, where a dinner has no steps of its own and shows nothing.
 *    Nate, 2026-10-15: "I'm able to access cook plans correctly from the plan
 *    section ... but not from the cook tab. Make those the same."
 *  - a scheduled CookPlan (a whole-meal production with a serve time), which
 *    the Plan tab shadows as "Cook plans coming up".
 *
 * Both are flattened to one shape, one entry per day, so the tab can lead with
 * its best guess and still let you pick another day ("sometimes I switch up
 * dinners"). Pure module: no store, no router, no Date.now() — the caller
 * passes `today`.
 */
import { dateKey, isSameDay } from '@/lib/week';
import { isDinner, resolveRefs, type RecipeIndex } from '@/lib/dinners';
import type { CookPlan, Dish, Meal, Recipe } from '@/types';

const DAY_MS = 86_400_000;

/** A recipe on the night: the dish itself, or one recipe a dinner links. */
export type CookableDish = {
  dish: Dish;
  recipe: Recipe;
  /** `true` when the recipe is a dinner shell — it opens on its recipe page
   *  (same as the Plan tab) and its own `parts` are what you actually cook. */
  dinner: boolean;
  /** the linked recipes of a dinner, in the dinner's order; empty otherwise */
  parts: Recipe[];
};

export type CookEntry =
  | { kind: 'meal'; id: string; date: Date; meal: Meal; dishes: CookableDish[] }
  | { kind: 'plan'; id: string; date: Date; plan: CookPlan };

/** Where a tap goes. Mirrors the routes the Plan tab uses for the same thing. */
export type CookDestination =
  | { pathname: '/recipes/[id]'; params: { id: string } }
  | { pathname: '/cook/[id]'; params: { id: string } }
  | { pathname: '/cook/meal/[id]'; params: { id: string } }
  | { pathname: '/cook-plan/[id]'; params: { id: string } };

/** Resolve a meal's dishes to recipes that still exist and aren't archived. */
export function cookableDishes(meal: Meal, index: RecipeIndex): CookableDish[] {
  const lookup = typeof index === 'function' ? index : (id: string) => index.get(id);
  const out: CookableDish[] = [];
  for (const dish of meal.dishes) {
    const recipe = dish.recipeId ? lookup(dish.recipeId) : undefined;
    if (!recipe || recipe.status === 'archived') continue;
    const dinner = isDinner(recipe);
    const parts = dinner
      ? resolveRefs(recipe, index)
          .map((r) => r.recipe)
          .filter((r): r is Recipe => !!r && r.status !== 'archived')
      : [];
    out.push({ dish, recipe, dinner, parts });
  }
  return out;
}

/**
 * Every day from `today` through `today + daysAhead - 1` that has something to
 * cook, soonest first. A day with both a meal and a cook plan yields two
 * entries (meal first — it's what the Plan tab shows in the grid).
 */
export function cookWeek(
  meals: Meal[],
  plans: CookPlan[],
  index: RecipeIndex,
  today: Date,
  daysAhead = 7,
): CookEntry[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start.getTime() + daysAhead * DAY_MS);
  const inWindow = (d: Date) => d.getTime() >= start.getTime() && d.getTime() < end.getTime();

  const entries: CookEntry[] = [];
  for (const meal of meals) {
    if ((meal.status ?? 'planned') === 'skipped') continue;
    if (!inWindow(dayStart(meal.date))) continue;
    const dishes = cookableDishes(meal, index);
    if (dishes.length === 0) continue;
    entries.push({ kind: 'meal', id: meal.id, date: meal.date, meal, dishes });
  }
  for (const plan of plans) {
    if (!plan.serveAt || plan.status === 'archived') continue;
    if (!inWindow(dayStart(plan.serveAt))) continue;
    entries.push({ kind: 'plan', id: plan.id, date: plan.serveAt, plan });
  }

  return entries.sort((a, b) => {
    const da = dateKey(a.date);
    const db = dateKey(b.date);
    if (da !== db) return da < db ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'meal' ? -1 : 1;
    if (a.kind === 'meal' && b.kind === 'meal') return mealRank(a.meal) - mealRank(b.meal);
    return a.date.getTime() - b.date.getTime();
  });
}

/**
 * The best guess for "what's on tonight": today's dinner, else today's first
 * entry, else the soonest upcoming one. Null when the week is empty.
 */
export function leadEntry(entries: CookEntry[], today: Date): CookEntry | null {
  const todays = entries.filter((e) => isSameDay(e.date, today));
  const dinner = todays.find((e) => e.kind === 'meal' && e.meal.type === 'dinner');
  return dinner ?? todays[0] ?? entries[0] ?? null;
}

/** What opening an entry means. Same routes the Plan tab uses. */
export function entryDestination(entry: CookEntry): CookDestination {
  if (entry.kind === 'plan') return { pathname: '/cook-plan/[id]', params: { id: entry.plan.id } };
  const [first] = entry.dishes;
  if (entry.dishes.length === 1 && first) return dishDestination(first);
  return { pathname: '/cook/meal/[id]', params: { id: entry.meal.id } };
}

/** A dinner opens on its recipe page (the Plan tab's door); a dish cooks. */
export function dishDestination(dish: CookableDish): CookDestination {
  return dish.dinner
    ? { pathname: '/recipes/[id]', params: { id: dish.recipe.id } }
    : { pathname: '/cook/[id]', params: { id: dish.recipe.id } };
}

/** One line naming an entry, for the week list. */
export function entryTitle(entry: CookEntry): string {
  if (entry.kind === 'plan') return entry.plan.title;
  return entry.dishes.map((d) => d.recipe.title).join(' · ');
}

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** dinner first, then anything else in the order it was planned */
function mealRank(meal: Meal): number {
  return meal.type === 'dinner' ? 0 : 1;
}
