/**
 * Per-canonical-name "already have" counter — the lightweight precursor of
 * the pantry pillar (spec §5 + §10). Every time the user taps "have" on a
 * shopping-list row, we increment the count + bump lastAt. Future shopping
 * lists fire a "likely already have" hint when the same canonical name has
 * been marked ≥ 3 times within the last 60 days.
 *
 * Persistence: web only for v1 (IndexedDB via webPersist), so it's per-
 * browser today. Folds into the cross-device sync layer in a follow-up.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';

const NATIVE = Platform.OS !== 'web';

export type HaveRecord = { count: number; lastAt: Date };

type HaveState = {
  byName: Record<string, HaveRecord>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  mark: (name: string) => void;
  unmark: (name: string) => void;
  isMarked: (name: string) => boolean;
  likelyHave: (name: string) => boolean;
};

const key = (s: string) => s.toLowerCase().trim();

export const useHaveStore = create<HaveState>((set, get) => ({
  byName: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const saved = await webPersist.load<Record<string, HaveRecord>>('have-counts');
      if (saved) {
        set({ byName: saved, hydrated: true });
        return;
      }
    }
    set({ hydrated: true });
  },

  mark: (name) => {
    const k = key(name);
    set((s) => ({
      byName: {
        ...s.byName,
        [k]: { count: (s.byName[k]?.count ?? 0) + 1, lastAt: new Date() },
      },
    }));
  },

  unmark: (name) => {
    const k = key(name);
    set((s) => {
      const r = s.byName[k];
      if (!r) return s;
      const nextCount = Math.max(0, r.count - 1);
      const updated = { ...s.byName };
      if (nextCount === 0) delete updated[k];
      else updated[k] = { count: nextCount, lastAt: r.lastAt };
      return { byName: updated };
    });
  },

  /** Has the user marked this name as "have" on the current list yet? */
  isMarked: (name) => {
    // Marked on the current list = count was bumped within the last few minutes.
    // We approximate "current session" with "within the last 6 hours" so that
    // refreshing the page doesn't lose the marks for the in-progress shop.
    const r = get().byName[key(name)];
    if (!r) return false;
    return Date.now() - r.lastAt.getTime() < 6 * 60 * 60 * 1000;
  },

  likelyHave: (name) => {
    const r = get().byName[key(name)];
    if (!r) return false;
    const ageDays = (Date.now() - r.lastAt.getTime()) / 86_400_000;
    return r.count >= 3 && ageDays <= 60;
  },
}));

if (!NATIVE) {
  useHaveStore.subscribe((s) => void webPersist.save('have-counts', s.byName));
}
