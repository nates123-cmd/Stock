import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';

/**
 * Shopping-mode trip state: what is already in the cart, and whether low/out
 * staples ride along.
 *
 * Persisted, not component state. A phone in a grocery store locks, gets
 * pocketed, and iOS suspends or evicts the PWA constantly; a trip that forgot
 * half the cart every time the screen slept would be worse than a paper list.
 * Device-local on purpose — it is one person's cart on one phone.
 */
const NATIVE = Platform.OS !== 'web';
const KEY = 'shop-mode';

type Saved = { got: Record<string, true>; includeStaples: boolean };

type ShopModeState = Saved & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Flip one row (by row key) in or out of the cart. */
  toggleGot: (key: string) => void;
  /** Forget these rows — the trip is settled for them. */
  clearGot: (keys: string[]) => void;
  setIncludeStaples: (on: boolean) => void;
};

export const useShopModeStore = create<ShopModeState>((set, get) => ({
  got: {},
  includeStaples: false,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const saved = await webPersist.load<Saved>(KEY);
      set({
        got: saved?.got ?? {},
        includeStaples: saved?.includeStaples ?? false,
        hydrated: true,
      });
      return;
    }
    set({ hydrated: true });
  },

  toggleGot: (key) =>
    set((s) => {
      const got = { ...s.got };
      if (got[key]) delete got[key];
      else got[key] = true;
      return { got };
    }),

  clearGot: (keys) =>
    set((s) => {
      const got = { ...s.got };
      for (const k of keys) delete got[k];
      return { got };
    }),

  setIncludeStaples: (on) => set({ includeStaples: on }),
}));

if (!NATIVE) {
  useShopModeStore.subscribe((s) => {
    // Never write before hydrate, or the empty boot state overwrites the trip.
    if (s.hydrated) void webPersist.save(KEY, { got: s.got, includeStaples: s.includeStaples });
  });
}
