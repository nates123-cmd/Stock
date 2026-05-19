import { Platform } from 'react-native';
import { create } from 'zustand';
import type { PantryItem, PantryLocation, ShoppingCategory } from '@/types';
import { migrate, pantryRepo } from '@/lib/db';
import { webPersist } from '@/lib/db/webStore';
import { uid } from '@/lib/id';
import { seedPantry } from '@/lib/seed';
import {
  categoryFor,
  computeExpiry,
  cycleEstimateDays,
  defaultFreshnessDays,
  matchKey,
} from '@/lib/pantry';

/**
 * Pantry store (spec §10). Same platform-split persistence as the other
 * pillars: SQLite on native (spec §4 local-first), in-memory seed on web
 * preview (spec §12). The paste flow funnels through applyPaste so restocks
 * merge into purchase history and cycle estimates refresh in one place.
 */
const NATIVE = Platform.OS !== 'web';

/** Where a freshly-pasted item lands when it's not already tracked. */
function defaultLocation(category: ShoppingCategory): PantryLocation {
  if (category === 'frozen') return 'freezer';
  if (category === 'dairy' || category === 'meat' || category === 'produce')
    return 'fridge';
  return 'pantry';
}

/** One row of the §10 "Saved" screen cycle-update block. */
export type CycleChange = { name: string; fromDays?: number; toDays: number };

export type PasteInput = {
  canonicalName: string;
  amount?: number;
  unit?: string;
  originalInstacartText: string;
};

export type PasteResult = {
  added: number;
  restocks: number;
  cycleChanges: CycleChange[];
};

type PantryState = {
  items: PantryItem[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  applyPaste: (rows: PasteInput[], at?: Date) => Promise<PasteResult>;
  toggleStaple: (id: string) => Promise<void>;
  setLocation: (id: string, location: PantryLocation) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

async function persist(item: PantryItem): Promise<void> {
  if (!NATIVE) return;
  try {
    await pantryRepo.upsert(item);
  } catch (e) {
    console.warn('[stock] pantry persist failed', e);
  }
}

export const usePantryStore = create<PantryState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (NATIVE) {
      try {
        await migrate();
        let rows = await pantryRepo.all();
        if (rows.length === 0) {
          for (const it of seedPantry()) await pantryRepo.upsert(it);
          rows = await pantryRepo.all();
        }
        set({ items: rows, hydrated: true });
        return;
      } catch (e) {
        console.warn('[stock] pantry hydrate failed, using seed', e);
      }
    }
    const saved = await webPersist.load<PantryItem[]>('pantry');
    set({ items: saved ?? seedPantry(), hydrated: true });
  },

  applyPaste: async (rows, at = new Date()) => {
    const items = [...get().items];
    const cycleChanges: CycleChange[] = [];
    let added = 0;
    let restocks = 0;

    for (const row of rows) {
      const key = matchKey(row.canonicalName);
      const idx = items.findIndex((p) => {
        const pk = matchKey(p.canonicalName);
        return pk === key || pk.startsWith(key) || key.startsWith(pk);
      });

      if (idx >= 0) {
        // Restock: extend purchase history, refresh estimate + freshness.
        const prev = items[idx]!;
        const before = cycleEstimateDays(prev.purchaseHistory);
        const purchaseHistory = [...prev.purchaseHistory, at];
        const after = cycleEstimateDays(purchaseHistory);
        const next: PantryItem = {
          ...prev,
          amount: row.amount ?? prev.amount,
          unit: row.unit ?? prev.unit,
          acquiredAt: at,
          expiresAt: computeExpiry(at, prev.defaultFreshnessDays),
          purchaseHistory,
          cycleEstimateDays: after,
          originalInstacartText: row.originalInstacartText,
        };
        items[idx] = next;
        restocks++;
        if (after != null && after !== before) {
          cycleChanges.push({ name: prev.canonicalName, fromDays: before, toDays: after });
        }
        await persist(next);
      } else {
        const cat = categoryFor(row.canonicalName);
        const freshness = defaultFreshnessDays(row.canonicalName);
        const item: PantryItem = {
          id: uid('pan'),
          canonicalName: row.canonicalName,
          amount: row.amount,
          unit: row.unit,
          location: defaultLocation(cat),
          isStaple: false,
          acquiredAt: at,
          defaultFreshnessDays: freshness,
          expiresAt: computeExpiry(at, freshness),
          purchaseHistory: [at],
          originalInstacartText: row.originalInstacartText,
        };
        items.push(item);
        added++;
        await persist(item);
      }
    }

    set({ items });
    return { added, restocks, cycleChanges };
  },

  toggleStaple: async (id) => {
    let updated: PantryItem | undefined;
    set((s) => ({
      items: s.items.map((p) => {
        if (p.id !== id) return p;
        updated = { ...p, isStaple: !p.isStaple };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  setLocation: async (id, location) => {
    let updated: PantryItem | undefined;
    set((s) => ({
      items: s.items.map((p) => {
        if (p.id !== id) return p;
        updated = { ...p, location };
        return updated;
      }),
    }));
    if (updated) await persist(updated);
  },

  remove: async (id) => {
    set((s) => ({ items: s.items.filter((p) => p.id !== id) }));
    if (NATIVE) {
      try {
        await pantryRepo.remove(id);
      } catch (e) {
        console.warn('[stock] pantry delete failed', e);
      }
    }
  },
}));

if (!NATIVE) {
  usePantryStore.subscribe((s) => void webPersist.save('pantry', s.items));
}
