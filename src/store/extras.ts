/**
 * Shopping-list "Extras" — items added to the shopping list that aren't
 * derived from the week's planned recipes. Today that means Pipeline ideas
 * pushed via "Add to shopping list" (spec §8). Eventually: a "+ Add item"
 * affordance on the shopping screen.
 *
 * Persistence: same as useHaveStore — per-browser via webPersist; cross-
 * device sync folds in later.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';
import { uid } from '@/lib/id';

const NATIVE = Platform.OS !== 'web';

export type ExtraItem = {
  id: string;
  canonicalName: string;
  amount: number | null;
  unit: string | null;
  /** Provenance label, shown on the row ("from pipeline: '{title}'"). */
  originLabel: string | null;
  /** Optional grouping key — used to add/remove a whole batch from one origin. */
  originId: string | null;
  addedAt: Date;
};

type ExtrasState = {
  items: ExtraItem[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (items: Omit<ExtraItem, 'id' | 'addedAt'>[]) => void;
  remove: (id: string) => void;
  removeByOrigin: (originId: string) => void;
};

export const useExtrasStore = create<ExtrasState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const saved = await webPersist.load<ExtraItem[]>('extras');
      if (saved) {
        set({ items: saved, hydrated: true });
        return;
      }
    }
    set({ hydrated: true });
  },

  add: (newItems) => {
    const now = new Date();
    const built: ExtraItem[] = newItems.map((i) => ({
      ...i,
      id: uid('extra'),
      addedAt: now,
    }));
    set((s) => ({ items: [...s.items, ...built] }));
  },

  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

  removeByOrigin: (originId) =>
    set((s) => ({ items: s.items.filter((i) => i.originId !== originId) })),
}));

if (!NATIVE) {
  useExtrasStore.subscribe((s) => void webPersist.save('extras', s.items));
}
