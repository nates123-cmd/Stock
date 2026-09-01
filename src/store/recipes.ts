import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Recipe } from '@/types';
import { migrate, recipeRepo } from '@/lib/db';
import { webPersist } from '@/lib/db/webStore';
import { seedRecipes } from '@/lib/seed';
import { deriveTags, reconcileTags } from '@/lib/recipeTags';
import { deriveCuisine, reconcileCuisine } from '@/lib/cuisine';
import { findDuplicate, type DupeReason } from '@/lib/recipeDupes';

/**
 * App-facing source of truth for recipes (spec §6). Zustand holds the working
 * set in memory; persistence is platform-split per the scaffold decision:
 * SQLite on native (spec §4 local-first), in-memory only on web preview
 * (no SQLite on web — spec §12). First run seeds sample recipes.
 */
const NATIVE = Platform.OS !== 'web';

/**
 * What a save did. A refused save is NOT an error — it means this recipe is
 * already in the library, and it hands back the copy that's already there so
 * the caller can show it ("already saved") instead of silently doing nothing.
 */
export type SaveResult =
  | { ok: true; recipe: Recipe }
  | { ok: false; duplicateOf: Recipe; reason: DupeReason };

type RecipeState = {
  recipes: Recipe[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  getById: (id: string) => Recipe | undefined;
  /**
   * Persist a recipe. Refuses a NEW recipe that duplicates one already in the
   * library; pass `allowDuplicate` to save it anyway (the "save it regardless"
   * escape hatch on the capture screen).
   */
  save: (recipe: Recipe, opts?: { allowDuplicate?: boolean }) => Promise<SaveResult>;
  /** Flip a recipe's isFavorite flag and persist via the save path. */
  toggleFavorite: (id: string) => Promise<void>;
  /** Flip a recipe's isToTry flag and persist via the save path. */
  toggleToTry: (id: string) => Promise<void>;
  /** File a recipe into a folder, or pass undefined to unfile it. */
  setFolder: (id: string, folder: string | undefined) => Promise<void>;
  /**
   * Rename a folder across every recipe in it. Folders are derived from the
   * recipes, so a rename IS this bulk edit — there is no folder record to
   * update. Returns how many recipes moved.
   */
  renameFolder: (from: string, to: string) => Promise<number>;
  remove: (id: string) => Promise<void>;
  /**
   * Re-run the auto-tagger over the library (or one recipe).
   *
   * Safe to call as often as you like: the derivation is deterministic and the
   * reconcile respects every edit, so a run that changes nothing writes nothing.
   * Returns how many recipes actually changed.
   */
  autoTag: (id?: string) => Promise<number>;
};

/**
 * Apply the tagger AND the cuisine deriver to one recipe; null when it comes
 * out unchanged.
 *
 * Cuisine rides along here rather than in its own pass because the contract is
 * identical (derived locally, deterministic, never overrides an edit) and
 * because this function is already called on every save and on every boot —
 * which makes the backfill over the existing library free and automatic
 * instead of a one-off script somebody has to remember to run.
 */
function retag(r: Recipe): Recipe | null {
  const { tags, tagMeta } = reconcileTags(r.tags, deriveTags(r), r.tagMeta);
  const tagsSame =
    tags.length === r.tags.length &&
    tags.every((t, i) => t === r.tags[i]) &&
    JSON.stringify(tagMeta) === JSON.stringify(r.tagMeta ?? { auto: [], removed: [] });

  // Derive from the RECONCILED tags: a cuisine you typed as a tag ("thai")
  // should win immediately, not one save later.
  const cuisinePatch = reconcileCuisine(r, deriveCuisine({ ...r, tags }));

  if (tagsSame && cuisinePatch === null) return null;
  const next: Recipe = { ...r, tags, tagMeta };
  if (cuisinePatch !== null) {
    // The patch is the whole cuisine state, so an empty object CLEARS both
    // fields rather than leaving a stale value behind.
    delete next.cuisine;
    delete next.cuisineAuto;
    Object.assign(next, cuisinePatch);
  }
  return next;
}

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
    const saved = await webPersist.load<Recipe[]>('recipes');
    set({ recipes: saved ?? seedRecipes(), hydrated: true });
  },

  getById: (id) => get().recipes.find((r) => r.id === id),

  save: async (recipe, opts) => {
    // The duplicate stop-gap. Guards EVERY write path — capture, a paste
    // import, a script driving the store — because the two batches that
    // doubled ~10 recipes came in through different doors and neither checked
    // the other ([[project_stock_recipe_import]]).
    //
    // Only a NEW id is screened: `findDuplicate` never matches a recipe
    // against itself, so re-saving an existing recipe (an edit, a favourite
    // toggle, the retag pass) is untouched.
    if (!opts?.allowDuplicate) {
      const existing = get().recipes.find((r) => r.id === recipe.id);
      if (!existing) {
        const hit = findDuplicate(recipe, get().recipes);
        if (hit) return { ok: false as const, duplicateOf: hit.existing, reason: hit.reason };
      }
    }
    // Re-derive on every save so tags stay honest when you change the
    // ingredients or the time — and so a newly captured recipe is tagged the
    // moment it lands, not at the next boot. This cannot fight a tag edit: the
    // editor records what the edit MEANT (applyTagEdit) before calling save,
    // and reconcileTags honours that. Cheap, local, deterministic.
    const tagged = retag(recipe) ?? recipe;
    set((s) => {
      const i = s.recipes.findIndex((r) => r.id === tagged.id);
      const recipes = [...s.recipes];
      if (i >= 0) recipes[i] = tagged;
      else recipes.unshift(tagged);
      return { recipes };
    });
    if (NATIVE) {
      try {
        await recipeRepo.upsert(tagged);
      } catch (e) {
        console.warn('[stock] recipe persist failed', e);
      }
    }
    return { ok: true as const, recipe: tagged };
  },

  toggleFavorite: async (id) => {
    const current = get().recipes.find((r) => r.id === id);
    if (!current) return;
    await get().save({ ...current, isFavorite: !current.isFavorite });
  },

  toggleToTry: async (id) => {
    const current = get().recipes.find((r) => r.id === id);
    if (!current) return;
    await get().save({ ...current, isToTry: !current.isToTry });
  },

  setFolder: async (id, folder) => {
    const current = get().recipes.find((r) => r.id === id);
    if (!current) return;
    const next = { ...current, modifiedAt: new Date() };
    // Undefined must DELETE the key, not store `undefined` — the row is
    // JSON-serialised into the cloud, where an explicit null would read back
    // as a folder named "null" rather than as unfiled.
    if (folder) next.folder = folder;
    else delete next.folder;
    await get().save(next);
  },

  renameFolder: async (from, to) => {
    const target = to.trim().replace(/\s+/g, ' ');
    const same = (a: string | undefined) =>
      !!a && a.trim().toLowerCase() === from.trim().toLowerCase();
    const moving = get().recipes.filter((r) => same(r.folder));
    for (const r of moving) {
      const next = { ...r, modifiedAt: new Date() };
      if (target) next.folder = target;
      else delete next.folder;
      await get().save(next);
    }
    return moving.length;
  },

  autoTag: async (id) => {
    const changed: Recipe[] = [];
    set((s) => {
      const recipes = s.recipes.map((r) => {
        if (id && r.id !== id) return r;
        const next = retag(r);
        if (!next) return r;
        changed.push(next);
        return next;
      });
      return changed.length ? { recipes } : {};
    });
    if (NATIVE) {
      for (const r of changed) {
        try {
          await recipeRepo.upsert(r);
        } catch (e) {
          console.warn('[stock] retag persist failed', e);
        }
      }
    }
    return changed.length;
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

// Web: write the working set through to IndexedDB on every change (native
// persists per-mutation via the repo above). Small JSON-ish collection —
// whole-array write-through is simplest and matches the §4 blob model.
if (!NATIVE) {
  useRecipeStore.subscribe((s) => void webPersist.save('recipes', s.recipes));
}
