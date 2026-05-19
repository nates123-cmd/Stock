import { Platform } from 'react-native';
import { create } from 'zustand';
import type { Cook } from '@/types';
import { cookRepo } from '@/lib/db';

/**
 * Cook records (spec §4/§7). A Cook captures a recipeVersionSnapshot so the
 * modification-history pillar (build step 9, spec §6) can reconstruct exactly
 * what was made. Not displayed yet, so no hydrate — session list + persist.
 * Native persists to SQLite; web is in-memory only (spec §12).
 */
const NATIVE = Platform.OS !== 'web';

type CookState = {
  cooks: Cook[];
  record: (cook: Cook) => Promise<void>;
};

export const useCookStore = create<CookState>((set) => ({
  cooks: [],
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
