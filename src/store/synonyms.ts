import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';
import {
  addApart,
  addSynonym,
  areApart,
  areSynonyms,
  loadApart,
  loadSynonyms,
} from '@/lib/synonyms';

/**
 * Persistent learned-synonyms store. Holds the raw pairs the user has manually
 * merged and mirrors them into the lib/synonyms union-find (which looksLikeSameItem
 * consults). So a merge you do once — "cherry tomatoes" = "Cherry or grape
 * tomatoes", "Fresh mint" = "mint leaves" — sticks for every future list.
 *
 * Web persists via IndexedDB; native keeps it in memory (Stock is web-first).
 */
const NATIVE = Platform.OS !== 'web';

type SynonymsState = {
  pairs: [string, string][];
  apartPairs: [string, string][];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Record a manual merge. No-op if the two are already linked. */
  learn: (a: string, b: string) => void;
  /** Record a DECLINED fuzzy match — the two are NOT the same item. */
  decline: (a: string, b: string) => void;
};

export const useSynonymsStore = create<SynonymsState>((set, get) => ({
  pairs: [],
  apartPairs: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const saved = (await webPersist.load<[string, string][]>('synonyms')) ?? [];
      const savedApart =
        (await webPersist.load<[string, string][]>('synonyms-apart')) ?? [];
      loadSynonyms(saved);
      loadApart(savedApart);
      set({ pairs: saved, apartPairs: savedApart, hydrated: true });
      return;
    }
    set({ hydrated: true });
  },

  learn: (a, b) => {
    if (!a?.trim() || !b?.trim() || areSynonyms(a, b)) return;
    addSynonym(a, b);
    set((s) => ({ pairs: [...s.pairs, [a, b]] }));
  },

  decline: (a, b) => {
    if (!a?.trim() || !b?.trim() || areApart(a, b)) return;
    addApart(a, b);
    set((s) => ({ apartPairs: [...s.apartPairs, [a, b]] }));
  },
}));

if (!NATIVE) {
  useSynonymsStore.subscribe((s) => {
    void webPersist.save('synonyms', s.pairs);
    void webPersist.save('synonyms-apart', s.apartPairs);
  });
}
