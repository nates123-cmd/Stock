import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Recipe } from '@/types';
import { migrate, recipeRepo } from '@/lib/db';
import { seedRecipes } from '@/lib/seed';

/**
 * App-facing source of truth for recipes (spec §6). Zustand holds the working
 * set in memory; persistence is platform-split per the scaffold decision:
 * SQLite on native (spec §4 local-first), in-memory only on web preview
 * (no SQLite on web — spec §12). First run seeds sample recipes.
 */
const NATIVE = Platform.OS !== 'web';

type RecipeState = {
  recipes: Recipe[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  getById: (id: string) => Recipe | undefined;
  save: (recipe: Recipe) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useRecipeStore = create<RecipeState>((set, get) => ({
  recipes: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (NATIVE) {
      try {
        await migrate();
        let rows = await recipeRepo.all();
        if (rows.length === 0) {
          for (const r of seedRecipes()) await recipeRepo.upsert(r);
          rows = await recipeRepo.all();
        }
        set({ recipes: rows, hydrated: true });
        return;
      } catch (e) {
        console.warn('[stock] recipe hydrate failed, using seed', e);
      }
    }
    set({ recipes: seedRecipes(), hydrated: true });
  },

  getById: (id) => get().recipes.find((r) => r.id === id),

  save: async (recipe) => {
    set((s) => {
      const i = s.recipes.findIndex((r) => r.id === recipe.id);
      const recipes = [...s.recipes];
      if (i >= 0) recipes[i] = recipe;
      else recipes.unshift(recipe);
      return { recipes };
    });
    if (NATIVE) {
      try {
        await recipeRepo.upsert(recipe);
      } catch (e) {
        console.warn('[stock] recipe persist failed', e);
      }
    }
  },

  remove: async (id) => {
    set((s) => ({ recipes: s.recipes.filter((r) => r.id !== id) }));
    if (NATIVE) {
      try {
        await recipeRepo.remove(id);
      } catch (e) {
        console.warn('[stock] recipe delete failed', e);
      }
    }
  },
}));
