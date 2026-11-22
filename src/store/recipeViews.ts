import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';
import type { ViewedMap } from '@/lib/recipeRecency';

/**
 * When each recipe was last opened — drives the "Recently viewed" sort and
 * shelf in the recipe library.
 *
 * Kept OUT of the recipe row on purpose. Stamping the recipe itself would turn
 * every open into a recipe save: a cloud upsert, a `modifiedAt`-style churn,
 * and a sync conflict waiting to happen between two phones in one household.
 * A view is not an edit. So this is a small device-local map (like the
 * shopping check-offs), persisted to IndexedDB on web.
 */
const NATIVE = Platform.OS !== 'web';
const KEY = 'recipe-views';

type RecipeViewsState = {
  viewedAt: ViewedMap;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Stamp a recipe as opened just now. */
  mark: (id: string) => void;
};

export const useRecipeViewsStore = create<RecipeViewsState>((set, get) => ({
  viewedAt: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const saved = await webPersist.load<ViewedMap>(KEY);
      // Merge rather than replace: a recipe opened before hydrate finished
      // (a cold deep-link straight to a recipe) must keep its stamp.
      set((s) => ({ viewedAt: { ...(saved ?? {}), ...s.viewedAt }, hydrated: true }));
      return;
    }
    set({ hydrated: true });
  },

  mark: (id) => set((s) => ({ viewedAt: { ...s.viewedAt, [id]: Date.now() } })),
}));

if (!NATIVE) {
  useRecipeViewsStore.subscribe((s) => {
    // Never write before hydrate: that would overwrite the saved map with the
    // empty boot state.
    if (s.hydrated) void webPersist.save(KEY, s.viewedAt);
  });
}
