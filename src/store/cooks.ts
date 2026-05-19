import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Cook } from '@/types';
import { cookRepo } from '@/lib/db';
import { webPersist } from '@/lib/db/webStore';

/**
 * Cook records (spec §4/§7). A Cook captures a recipeVersionSnapshot so the
 * modification-history pillar (build step 9, spec §6) can reconstruct exactly
 * what was made. Native persists to SQLite (session-only — no reload path
 * yet); web persists to IndexedDB and reloads, so cook history isn't lost.
 */
const NATIVE = Platform.OS !== 'web';

type CookState = {
  cooks: Cook[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  record: (cook: Cook) => Promise<void>;
};

export const useCookStore = create<CookState>((set, get) => ({
  cooks: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const saved = await webPersist.load<Cook[]>('cooks');
      if (saved) {
        set({ cooks: saved, hydrated: true });
        return;
      }
    }
    set({ hydrated: true });
  },

  record: async (cook) => {
    set((s) => ({ cooks: [cook, ...s.cooks] }));
    if (NATIVE) {
      try {
        await cookRepo.upsert(cook);
      } catch (e) {
        console.warn('[stock] cook persist failed', e);
      }
    }
  },
}));

if (!NATIVE) {
  useCookStore.subscribe((s) => void webPersist.save('cooks', s.cooks));
}
