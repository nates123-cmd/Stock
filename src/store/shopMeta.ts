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

export type CombineChoice = 'combine' | 'separate';

type ShopMetaState = {
  /** normalized name → true (deleted from plan-derived lists, stays gone). */
  suppressed: Record<string, true>;
  /** normalized name → per-item store tag + detail. */
  meta: Record<string, ShopMeta>;
  /**
   * Cart-combine decisions, keyed by group signature (see cartCombine
   * groupSignature). MUST persist: the shopping list is unmounted every time you
   * leave the Shop segment, so a session-only decision meant the "Combine
   * duplicates?" sheet re-asked the same questions on every visit — and a "keep
   * separate" never survived, since the lines regenerate merged.
   */
  combine: Record<string, CombineChoice>;
  /**
   * Manual merges: alias matchKey → target matchKey. The user checked two rows
   * ("shallot" + "shallots") and combined them, so from now on they fold into
   * one line. MUST persist — the list is rebuilt from the plan on every visit,
   * so a merge that lived in component state would evaporate immediately.
   */
  merges: Record<string, string>;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  suppress: (name: string) => void;
  unsuppress: (name: string) => void;
  isSuppressed: (name: string) => boolean;
  setMeta: (name: string, patch: ShopMeta) => void;
  clearMeta: (name: string) => void;
  setCombine: (sig: string, choice: CombineChoice) => void;
  /** Fold `aliases` into `target` (all matchKeys). */
  mergeInto: (target: string, aliases: string[]) => void;
  /** Undo a merge: drop every alias pointing at this target. */
  unmerge: (target: string) => void;
};

const clean = (m: ShopMeta): ShopMeta => {
  const out: ShopMeta = {};
  if (m.store) out.store = m.store;
  if (m.qty && m.qty.trim()) out.qty = m.qty.trim();
  if (m.brand && m.brand.trim()) out.brand = m.brand.trim();
  if (m.note && m.note.trim()) out.note = m.note.trim();
  return out;
};

export const useShopMetaStore = create<ShopMetaState>((set, get) => ({
  suppressed: {},
  meta: {},
  combine: {},
  merges: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const [sup, met, comb, mrg] = await Promise.all([
        webPersist.load<Record<string, true>>('shop-suppressed'),
        webPersist.load<Record<string, ShopMeta>>('shop-meta'),
        webPersist.load<Record<string, CombineChoice>>('shop-combine'),
        webPersist.load<Record<string, string>>('shop-merges'),
      ]);
      set({
        suppressed: sup ?? {},
        meta: met ?? {},
        combine: comb ?? {},
        merges: mrg ?? {},
        hydrated: true,
      });
      return;
    }
    set({ hydrated: true });
  },

  setCombine: (sig, choice) =>
    set((s) => ({ combine: { ...s.combine, [sig]: choice } })),

  mergeInto: (target, aliases) =>
    set((s) => {
      const next = { ...s.merges };
      for (const a of aliases) {
        if (a === target) continue;
        next[a] = target;
      }
      // Re-point anything that pointed at an alias, so chains can't form.
      for (const [k, v] of Object.entries(next)) {
        if (aliases.includes(v)) next[k] = target;
      }
      return { merges: next };
    }),

  unmerge: (target) =>
    set((s) => {
      const next = { ...s.merges };
      for (const [k, v] of Object.entries(next)) {
        if (v === target || k === target) delete next[k];
      }
      return { merges: next };
    }),

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
    void webPersist.save('shop-combine', s.combine);
    void webPersist.save('shop-merges', s.merges);
  });
}
