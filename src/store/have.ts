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
  /**
   * Names checked off the shopping list. Checking off is PERMANENT: it stays
   * checked until you uncheck it, or until the pantry says you're low/out
   * again (see `inHave` in shopping.tsx — a low/out pantry status outranks
   * this, which is the intended "bought → pantry → depletes → resurfaces" loop).
   *
   * This used to be inferred from `byName[k].lastAt` being within the last 6
   * hours. That meant every item you checked off silently came BACK six hours
   * later, which read as items adding themselves to the list at random.
   */
  checked: Record<string, true>;
  /** Canonical names the user has pinned as "I always have this." These
   *  auto-route to the Already-have bucket on every shopping list and never
   *  surface as buy items. Per-canonical-name; persists across runs. */
  alwaysHave: Record<string, true>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  mark: (name: string) => void;
  unmark: (name: string) => void;
  isMarked: (name: string) => boolean;
  likelyHave: (name: string) => boolean;
  setAlways: (name: string, on: boolean) => void;
  isAlways: (name: string) => boolean;
};

const key = (s: string) => s.toLowerCase().trim();

export const useHaveStore = create<HaveState>((set, get) => ({
  byName: {},
  checked: {},
  alwaysHave: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const [saved, chk, alw] = await Promise.all([
        webPersist.load<Record<string, HaveRecord>>('have-counts'),
        webPersist.load<Record<string, true>>('have-checked'),
        webPersist.load<Record<string, true>>('always-have'),
      ]);
      set({
        byName: saved ?? {},
        checked: chk ?? {},
        alwaysHave: alw ?? {},
        hydrated: true,
      });
      return;
    }
    set({ hydrated: true });
  },

  mark: (name) => {
    const k = key(name);
    set((s) => ({
      // count + lastAt still drive the "you likely already have this" hint.
      byName: {
        ...s.byName,
        [k]: { count: (s.byName[k]?.count ?? 0) + 1, lastAt: new Date() },
      },
      checked: { ...s.checked, [k]: true },
    }));
  },

  unmark: (name) => {
    const k = key(name);
    set((s) => {
      const nextChecked = { ...s.checked };
      delete nextChecked[k];
      const r = s.byName[k];
      if (!r) return { checked: nextChecked };
      const nextCount = Math.max(0, r.count - 1);
      const updated = { ...s.byName };
      if (nextCount === 0) delete updated[k];
      else updated[k] = { count: nextCount, lastAt: r.lastAt };
      return { byName: updated, checked: nextChecked };
    });
  },

  /** Checked off the list. Sticks until unchecked (or the pantry goes low/out). */
  isMarked: (name) => get().checked[key(name)] === true,

  likelyHave: (name) => {
    const r = get().byName[key(name)];
    if (!r) return false;
    const ageDays = (Date.now() - r.lastAt.getTime()) / 86_400_000;
    return r.count >= 3 && ageDays <= 60;
  },

  setAlways: (name, on) => {
    const k = key(name);
    set((s) => {
      const next = { ...s.alwaysHave };
      if (on) next[k] = true;
      else delete next[k];
      return { alwaysHave: next };
    });
  },

  isAlways: (name) => get().alwaysHave[key(name)] === true,
}));

if (!NATIVE) {
  useHaveStore.subscribe((s) => {
    void webPersist.save('have-counts', s.byName);
    void webPersist.save('have-checked', s.checked);
    void webPersist.save('always-have', s.alwaysHave);
  });
}
