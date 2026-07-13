/**
 * Shopping-item persistence for state that outlives a single generated list
 * (redesign Phase D, notes 3 & 7a). Keyed by the canonical always-have key so
 * a plan-derived line ("salt") and an extra ("Salt") resolve to one record.
 *
 *  - `suppressed`: names the user deleted off a plan-derived list. The
 *    consolidation filters these out of FUTURE plan → shopping regen, so a
 *    deleted item stays gone (note 7a). Off-plan extras don't use this — they
 *    just delete from the extras store.
 *  - `meta`: the optional store tag (+ qty / brand / note) from the long-press
 *    detail sheet (note 3). The store tag doubles as the fulfillment channel.
 *
 * Persistence mirrors have.ts / extras.ts — per-browser via webPersist; the
 * cross-device sync layer folds it in later.
 */
import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';
import { alwaysHaveKey } from '@/lib/alwaysHave';
import type { ShopMeta } from '@/lib/shopStores';

const NATIVE = Platform.OS !== 'web';

type ShopMetaState = {
  /** normalized name → true (deleted from plan-derived lists, stays gone). */
  suppressed: Record<string, true>;
  /** normalized name → per-item store tag + detail. */
  meta: Record<string, ShopMeta>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  suppress: (name: string) => void;
  unsuppress: (name: string) => void;
  isSuppressed: (name: string) => boolean;
  setMeta: (name: string, patch: ShopMeta) => void;
  clearMeta: (name: string) => void;
};

const clean = (m: ShopMeta): ShopMeta => {
  const out: ShopMeta = {};
  if (m.store) out.store = m.store;
  if (m.qty && m.qty.trim()) out.qty = m.qty.trim();
  if (m.brand && m.brand.trim()) out.brand = m.brand.trim();
  if (m.note && m.note.trim()) out.note = m.note.trim();
  // Passing `deferredAt: undefined` through setMeta clears the defer.
  if (m.deferredAt) out.deferredAt = m.deferredAt;
  return out;
};

export const useShopMetaStore = create<ShopMetaState>((set, get) => ({
  suppressed: {},
  meta: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const [sup, met] = await Promise.all([
        webPersist.load<Record<string, true>>('shop-suppressed'),
        webPersist.load<Record<string, ShopMeta>>('shop-meta'),
      ]);
      set({ suppressed: sup ?? {}, meta: met ?? {}, hydrated: true });
      return;
    }
    set({ hydrated: true });
  },

  suppress: (name) =>
    set((s) => ({ suppressed: { ...s.suppressed, [alwaysHaveKey(name)]: true } })),

  unsuppress: (name) =>
    set((s) => {
      const next = { ...s.suppressed };
      delete next[alwaysHaveKey(name)];
      return { suppressed: next };
    }),

  isSuppressed: (name) => get().suppressed[alwaysHaveKey(name)] === true,

  setMeta: (name, patch) =>
    set((s) => {
      const k = alwaysHaveKey(name);
      const merged = clean({ ...s.meta[k], ...patch });
      const next = { ...s.meta };
      if (Object.keys(merged).length === 0) delete next[k];
      else next[k] = merged;
      return { meta: next };
    }),

  clearMeta: (name) =>
    set((s) => {
      const next = { ...s.meta };
      delete next[alwaysHaveKey(name)];
      return { meta: next };
    }),
}));

if (!NATIVE) {
  useShopMetaStore.subscribe((s) => {
    void webPersist.save('shop-suppressed', s.suppressed);
    void webPersist.save('shop-meta', s.meta);
  });
}
