import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Meal, PlanEntry } from '@/types';
import { migrate, planRepo } from '@/lib/db';
import { uid } from '@/lib/id';
import { dateKey, startOfWeek } from '@/lib/week';

/**
 * Week plan — the orchestrator (spec §5). One entry per (day, meal). Native
 * persists to SQLite; web is in-memory seeded so the grid is populated in the
 * preview (spec §12).
 */
const NATIVE = Platform.OS !== 'web';

function seedPlan(): PlanEntry[] {
  const sun = startOfWeek(new Date());
  const day = (offset: number) => new Date(sun.getTime() + offset * 86_400_000);
  return [
    { id: uid('pe'), date: day(0), meal: 'dinner', recipeId: 'seed_sushi', status: 'cooked' },
    { id: uid('pe'), date: day(2), meal: 'dinner', recipeId: 'seed_chicken', status: 'planned' },
    { id: uid('pe'), date: day(4), meal: 'dinner', recipeId: 'seed_bread', status: 'planned' },
  ];
}

type PlanState = {
  entries: PlanEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  entryFor: (key: string, meal: Meal) => PlanEntry | undefined;
  /** Pin a recipe to a day/meal, replacing whatever was there. */
  setRecipe: (date: Date, meal: Meal, recipeId: string) => Promise<void>;
  /** Pin a Pipeline idea as an experiment (spec §8 → §5). */
  setExperiment: (date: Date, meal: Meal, pipelineIdeaId: string) => Promise<void>;
  setStatus: (id: string, status: PlanEntry['status']) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const usePlanStore = create<PlanState>((set, get) => ({
  entries: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (NATIVE) {
      try {
        await migrate();
        let rows = await planRepo.all();
        if (rows.length === 0) {
          for (const e of seedPlan()) await planRepo.upsert(e);
          rows = await planRepo.all();
        }
        set({ entries: rows, hydrated: true });
        return;
      } catch (e) {
        console.warn('[stock] plan hydrate failed, using seed', e);
      }
    }
    set({ entries: seedPlan(), hydrated: true });
  },

  entryFor: (key, meal) =>
    get().entries.find((e) => dateKey(e.date) === key && e.meal === meal),

  setRecipe: async (date, meal, recipeId) => {
    const key = dateKey(date);
    const existing = get().entries.find(
      (e) => dateKey(e.date) === key && e.meal === meal,
    );
    const entry: PlanEntry = {
      id: existing?.id ?? uid('pe'),
      date,
      meal,
      recipeId,
      status: 'planned',
    };
    set((s) => ({
      entries: [...s.entries.filter((e) => e.id !== entry.id), entry],
    }));
    if (NATIVE) {
      try {
        await planRepo.upsert(entry);
      } catch (e) {
        console.warn('[stock] plan persist failed', e);
      }
    }
  },

  setExperiment: async (date, meal, pipelineIdeaId) => {
    const key = dateKey(date);
    const existing = get().entries.find(
      (e) => dateKey(e.date) === key && e.meal === meal,
    );
    const entry: PlanEntry = {
      id: existing?.id ?? uid('pe'),
      date,
      meal,
      pipelineIdeaId,
      status: 'planned',
    };
    set((s) => ({
      entries: [...s.entries.filter((e) => e.id !== entry.id), entry],
    }));
    if (NATIVE) {
      try {
        await planRepo.upsert(entry);
      } catch (e) {
        console.warn('[stock] plan experiment persist failed', e);
      }
    }
  },

  setStatus: async (id, status) => {
    let updated: PlanEntry | undefined;
    set((s) => ({
      entries: s.entries.map((e) => {
        if (e.id !== id) return e;
        updated = { ...e, status };
        return updated;
      }),
    }));
    if (NATIVE && updated) {
      try {
        await planRepo.upsert(updated);
      } catch (e) {
        console.warn('[stock] plan status persist failed', e);
      }
    }
  },

  remove: async (id) => {
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }));
    if (NATIVE) {
      try {
        await planRepo.remove(id);
      } catch (e) {
        console.warn('[stock] plan delete failed', e);
      }
    }
  },
}));
