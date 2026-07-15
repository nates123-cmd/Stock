import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';
import { matchKey } from '@/lib/pantry';

/**
 * "Pushed" list (Apple Reminders-style). When you select rows and push them to
 * Wegmans or Reminders, they leave the active shopping list and land here —
 * a collapsed record of what went out, in case an order isn't fully covered.
 * Entries self-expire after 24h so the list keeps itself clean.
 *
 * Web (the PWA) persists via IndexedDB, which round-trips Date objects; native
 * gets a session-only copy (fine — Stock is web-first).
 */
const NATIVE = Platform.OS !== 'web';
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h

export type PushDest = 'wegmans' | 'reminders';
export type PushedEntry = {
  /** matchKey of the item name — the stable de-dupe/exclusion key. */
  key: string;
  name: string;
  pushedAt: Date;
  dest: PushDest;
};

function fresh(items: PushedEntry[], now = Date.now()): PushedEntry[] {
  return items.filter((e) => now - new Date(e.pushedAt).getTime() < EXPIRY_MS);
}

type PushedState = {
  items: PushedEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Move names into the pushed list (upsert by matchKey). */
  push: (names: string[], dest: PushDest, at?: Date) => void;
  /** Pull a name back out (matchKey) — it returns to the active list. */
  restore: (key: string) => void;
  /** Drop everything past the expiry window. */
  prune: () => void;
};

export const usePushedStore = create<PushedState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const saved = (await webPersist.load<PushedEntry[]>('pushed')) ?? [];
    set({ items: fresh(saved), hydrated: true });
  },

  push: (names, dest, at = new Date()) => {
    set((s) => {
      const byKey = new Map(s.items.map((e) => [e.key, e]));
      for (const name of names) {
        const k = matchKey(name);
        if (!k) continue;
        byKey.set(k, { key: k, name, pushedAt: at, dest });
      }
      return { items: fresh([...byKey.values()], at.getTime()) };
    });
  },

  restore: (key) => set((s) => ({ items: s.items.filter((e) => e.key !== key) })),

  prune: () => set((s) => ({ items: fresh(s.items) })),
}));

if (!NATIVE) {
  usePushedStore.subscribe((s) => void webPersist.save('pushed', s.items));
}
