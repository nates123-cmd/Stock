import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';
import { upsertPushed, type PushedInput } from '@/lib/activeList';

export type { PushedInput };

/**
 * "Pushed" list (Apple Reminders-style). When you select rows and push them to
 * Wegmans / Reminders / Amazon / Costco, they leave the active shopping list and
 * land here — a collapsed record of what went out.
 *
 * Pushed is PERMANENT: an item stays pushed until you explicitly restore it (or
 * Clear the section). It used to self-expire on a wall-clock timer (24h), which
 * meant everything you pushed FLOODED BACK onto Active a day later — the "why
 * are groceries I already ordered back on my list" bug. Gone means gone; the
 * clock plays no part. Same principle as the permanent check-off in have.ts.
 *
 * Web (the PWA) persists via IndexedDB, which round-trips Date objects; native
 * gets a session-only copy (fine — Stock is web-first).
 */
const NATIVE = Platform.OS !== 'web';

export type PushDest = 'wegmans' | 'reminders' | 'amazon' | 'costco';
export type PushedEntry = {
  /** matchKey of the item name — the display / de-dupe key. */
  key: string;
  name: string;
  /**
   * The EXTRAS this push actually sent, by stable id.
   *
   * A marker used to exclude rows from Active by name, matched loosely — which
   * hid unrelated items ("green onions" pushed → "red onions" gone) and then
   * dumped them all back the moment the marker was cleared. Recording ids makes
   * a marker responsible for exactly the rows it sent: nothing else is hidden,
   * and nothing added later is retroactively swallowed.
   *
   * Absent on markers written before this existed; those still match by name
   * (see activeList.ts) so upgrading doesn't resurrect an old order.
   */
  extraIds?: string[];
  /**
   * This marker ALSO excludes by name. True for rows with no extra behind them
   * (pantry restock lines) and for any marker that has ever matched by name.
   */
  nameMatch?: true;
  pushedAt: Date;
  dest: PushDest;
};

type PushedState = {
  items: PushedEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Move rows into the pushed list (upsert by matchKey; ids accumulate). */
  push: (rows: PushedInput[], dest: PushDest, at?: Date) => void;
  /** Pull a name back out (matchKey) — it returns to the active list. */
  restore: (key: string) => void;
  /** Empty the pushed list (start a fresh shopping cycle). */
  clear: () => void;
};

export const usePushedStore = create<PushedState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const saved = (await webPersist.load<PushedEntry[]>('pushed')) ?? [];
    set({ items: saved, hydrated: true });
  },

  push: (rows, dest, at = new Date()) => {
    set((s) => ({
      items: upsertPushed(s.items, rows, (base) => ({ ...base, pushedAt: at, dest })),
    }));
  },

  restore: (key) => set((s) => ({ items: s.items.filter((e) => e.key !== key) })),

  clear: () => set({ items: [] }),
}));

if (!NATIVE) {
  usePushedStore.subscribe((s) => void webPersist.save('pushed', s.items));
}
