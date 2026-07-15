import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';

/**
 * Small bag of user preferences that aren't tied to any one recipe/pantry item.
 *
 * `preferGrams` — sticky "to grams". Converting a recipe to grams already
 * persists on that recipe, but Nate didn't want to press the button on every
 * new recipe. So the first time he applies a grams conversion we flip this on,
 * and from then on RecipeTools auto-converts a recipe to grams the first time
 * it's opened (see RecipeTools). Idempotent: once a recipe is all grams there's
 * nothing left to convert, so no repeat work.
 *
 * Web persists via IndexedDB; native keeps it in memory (Stock is web-first).
 */
const NATIVE = Platform.OS !== 'web';

type PrefsState = {
  preferGrams: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPreferGrams: (on: boolean) => void;
};

export const usePrefsStore = create<PrefsState>((set, get) => ({
  preferGrams: false,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const saved = await webPersist.load<boolean>('prefer-grams');
      set({ preferGrams: saved ?? false, hydrated: true });
      return;
    }
    set({ hydrated: true });
  },

  setPreferGrams: (on) => set({ preferGrams: on }),
}));

if (!NATIVE) {
  usePrefsStore.subscribe((s) => {
    void webPersist.save('prefer-grams', s.preferGrams);
  });
}
