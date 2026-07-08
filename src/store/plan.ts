import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Dish, Meal, MealStatus, MealType } from '@/types';
import { migrate, planRepo } from '@/lib/db';
import { webPersist } from '@/lib/db/webStore';
import { uid } from '@/lib/id';
import { dateKey } from '@/lib/week';

/**
 * Week plan — the orchestrator (spec §5), reshaped for the Phase B meal model:
 * a day holds one or more Meals, each Meal holds multiple Dishes. Adding a dish
 * merges into the day's single default (unlabeled) meal unless a lunch/dinner
 * split is requested. Native persists to SQLite (plan_meals); web writes the
 * whole meal array through IndexedDB on every mutation.
 *
 * Plan data is disposable (Nate): old-shape rows are dropped on hydrate, never
 * migrated. Recipes / pipeline stores are untouched.
 */
const NATIVE = Platform.OS !== 'web';
const DAY_MS = 86_400_000;

function seedPlan(): Meal[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = (offset: number) => new Date(today.getTime() + offset * DAY_MS);
  return [
    {
      id: uid('meal'),
      date: day(0),
      type: null,
      status: 'cooked',
      dishes: [{ id: uid('dish'), recipeId: 'seed_sushi', title: 'Sushi night' }],
    },
    {
      id: uid('meal'),
      date: day(2),
      type: null,
      status: 'planned',
      dishes: [{ id: uid('dish'), recipeId: 'seed_chicken', title: 'Roast chicken' }],
    },
    {
      id: uid('meal'),
      date: day(4),
      type: null,
      status: 'planned',
      dishes: [{ id: uid('dish'), recipeId: 'seed_bread', title: 'Fresh bread' }],
    },
  ];
}

/** Drop anything that isn't a well-formed Meal (old PlanEntry rows have no
 *  `dishes` array) and revive the date. Never throws — hydration must not
 *  crash on legacy data (plan is disposable). */
function sanitizeMeals(raw: unknown): Meal[] {
  if (!Array.isArray(raw)) return [];
  const out: Meal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as Partial<Meal>;
    if (!m.id || !Array.isArray(m.dishes)) continue;
    out.push({
      id: m.id,
      date: m.date instanceof Date ? m.date : new Date(m.date as unknown as string),
      type: m.type ?? null,
      status: m.status ?? 'planned',
      dishes: m.dishes,
      cookId: m.cookId,
    });
  }
  return out;
}

type DishInput = Omit<Dish, 'id'> & { id?: string };

async function persistMeal(meal: Meal | undefined): Promise<void> {
  if (!NATIVE || !meal) return;
  try {
    await planRepo.upsert(meal);
  } catch (e) {
    console.warn('[stock] plan meal persist failed', e);
  }
}

async function removeMealRow(id: string | undefined): Promise<void> {
  if (!NATIVE || !id) return;
  try {
    await planRepo.remove(id);
  } catch (e) {
    console.warn('[stock] plan meal delete failed', e);
  }
}

type PlanState = {
  meals: Meal[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** All meals on a given day (accepts a Date or a local day key). */
  mealsFor: (date: Date | string) => Meal[];
  /**
   * Add a dish to a day. Merges into the day's default meal (or the meal whose
   * type matches `opts.type`), creating one if none exists (merge-by-default).
   */
  addDish: (
    date: Date,
    dish: DishInput,
    opts?: { type?: MealType | null },
  ) => Promise<void>;
  /** Remove a dish; if it was the meal's last dish, the meal goes too. */
  removeDish: (mealId: string, dishId: string) => Promise<void>;
  /** Label (or clear) a meal's lunch/dinner split. */
  setMealType: (mealId: string, type: MealType | null) => Promise<void>;
  /** Move one dish out of a meal into a (new or existing) meal of `type`. */
  splitMeal: (mealId: string, dishId: string, type: MealType) => Promise<void>;
  setStatus: (mealId: string, status: MealStatus) => Promise<void>;
  removeMeal: (mealId: string) => Promise<void>;
};

export const usePlanStore = create<PlanState>((set, get) => ({
  meals: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (NATIVE) {
      try {
        await migrate();
        let rows = await planRepo.all();
        if (rows.length === 0) {
          for (const m of seedPlan()) await planRepo.upsert(m);
          rows = await planRepo.all();
        }
        set({ meals: rows, hydrated: true });
        return;
      } catch (e) {
        console.warn('[stock] plan hydrate failed, using seed', e);
      }
    }
    const saved = await webPersist.load<unknown>('plan');
    const clean = sanitizeMeals(saved);
    // saved === null → never persisted; old-shape data → sanitize empties it.
    // Either way an empty result seeds so the preview grid isn't blank.
    set({ meals: clean.length ? clean : seedPlan(), hydrated: true });
  },

  mealsFor: (date) => {
    const key = typeof date === 'string' ? date : dateKey(date);
    return get().meals.filter((m) => dateKey(m.date) === key);
  },

  addDish: async (date, dish, opts) => {
    const targetType = opts?.type ?? null;
    const key = dateKey(date);
    const newDish: Dish = {
      id: dish.id ?? uid('dish'),
      recipeId: dish.recipeId,
      pipelineId: dish.pipelineId,
      title: dish.title,
    };
    let saved: Meal | undefined;
    set((s) => {
      const existing = s.meals.find(
        (m) => dateKey(m.date) === key && (m.type ?? null) === targetType,
      );
      if (existing) {
        saved = { ...existing, dishes: [...existing.dishes, newDish] };
        return { meals: s.meals.map((m) => (m.id === existing.id ? saved! : m)) };
      }
      saved = {
        id: uid('meal'),
        date,
        type: targetType,
        status: 'planned',
        dishes: [newDish],
      };
      return { meals: [...s.meals, saved!] };
    });
    await persistMeal(saved);
  },

  removeDish: async (mealId, dishId) => {
    let saved: Meal | undefined;
    let removedId: string | undefined;
    set((s) => {
      const meal = s.meals.find((m) => m.id === mealId);
      if (!meal) return s;
      const dishes = meal.dishes.filter((d) => d.id !== dishId);
      if (dishes.length === 0) {
        removedId = mealId;
        return { meals: s.meals.filter((m) => m.id !== mealId) };
      }
      saved = { ...meal, dishes };
      return { meals: s.meals.map((m) => (m.id === mealId ? saved! : m)) };
    });
    if (removedId) await removeMealRow(removedId);
    else await persistMeal(saved);
  },

  setMealType: async (mealId, type) => {
    let saved: Meal | undefined;
    set((s) => ({
      meals: s.meals.map((m) => {
        if (m.id !== mealId) return m;
        saved = { ...m, type };
        return saved;
      }),
    }));
    await persistMeal(saved);
  },

  splitMeal: async (mealId, dishId, type) => {
    const toPersist: Meal[] = [];
    const toRemove: string[] = [];
    set((s) => {
      const meal = s.meals.find((m) => m.id === mealId);
      const dish = meal?.dishes.find((d) => d.id === dishId);
      if (!meal || !dish) return s;
      const dayKey = dateKey(meal.date);
      const source = { ...meal, dishes: meal.dishes.filter((d) => d.id !== dishId) };
      const targetExisting = s.meals.find(
        (m) => m.id !== mealId && dateKey(m.date) === dayKey && (m.type ?? null) === type,
      );
      const target: Meal = targetExisting
        ? { ...targetExisting, dishes: [...targetExisting.dishes, dish] }
        : {
            id: uid('meal'),
            date: meal.date,
            type,
            status: 'planned',
            dishes: [dish],
          };

      let next = s.meals.map((m) => {
        if (m.id === mealId) return source;
        if (targetExisting && m.id === targetExisting.id) return target;
        return m;
      });
      if (!targetExisting) next = [...next, target];

      // Source may now be empty — drop it and schedule the row delete.
      if (source.dishes.length === 0) {
        toRemove.push(source.id);
        next = next.filter((m) => m.id !== source.id);
      } else {
        toPersist.push(source);
      }
      toPersist.push(target);
      return { meals: next };
    });
    for (const id of toRemove) await removeMealRow(id);
    for (const m of toPersist) await persistMeal(m);
  },

  setStatus: async (mealId, status) => {
    let saved: Meal | undefined;
    set((s) => ({
      meals: s.meals.map((m) => {
        if (m.id !== mealId) return m;
        saved = { ...m, status };
        return saved;
      }),
    }));
    await persistMeal(saved);
  },

  removeMeal: async (mealId) => {
    set((s) => ({ meals: s.meals.filter((m) => m.id !== mealId) }));
    await removeMealRow(mealId);
  },
}));

if (!NATIVE) {
  usePlanStore.subscribe((s) => void webPersist.save('plan', s.meals));
}
