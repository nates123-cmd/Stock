import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';
import { matchKey } from '@/lib/pantry';

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
  /** matchKey of the item name — the stable de-dupe/exclusion key. */
  key: string;
  name: string;
  pushedAt: Date;
  dest: PushDest;
};

type PushedState = {
  items: PushedEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Move names into the pushed list (upsert by matchKey). */
  push: (names: string[], dest: PushDest, at?: Date) => void;
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

  push: (names, dest, at = new Date()) => {
    set((s) => {
      const byKey = new Map(s.items.map((e) => [e.key, e]));
      for (const name of names) {
        const k = matchKey(name);
        if (!k) continue;
        byKey.set(k, { key: k, name, pushedAt: at, dest });
      }
      return { items: [...byKey.values()] };
    });
  },

  restore: (key) => set((s) => ({ items: s.items.filter((e) => e.key !== key) })),

  clear: () => set({ items: [] }),
}));

if (!NATIVE) {
  usePushedStore.subscribe((s) => void webPersist.save('pushed', s.items));
}
