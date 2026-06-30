import { Platform } from 'react-native';
import { create } from 'zustand';
import type { CookPlan } from '@/types';
import { migrate, cookPlanRepo } from '@/lib/db';
import { webPersist } from '@/lib/db/webStore';
import { seedCookPlans } from '@/lib/seedCookPlans';

/**
 * Source of truth for Cook Plans — a multi-component, multi-phase production
 * (whole-meal "event" above a single Recipe). Mirrors useRecipeStore exactly:
 * SQLite on native, IndexedDB on web; first run seeds the fried-chicken plan.
 */
const NATIVE = Platform.OS !== 'web';

type CookPlanState = {
  plans: CookPlan[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  getById: (id: string) => CookPlan | undefined;
  save: (plan: CookPlan) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useCookPlanStore = create<CookPlanState>((set, get) => ({
  plans: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (NATIVE) {
      try {
        await migrate();
        let rows = await cookPlanRepo.all();
        if (rows.length === 0) {
          for (const p of seedCookPlans()) await cookPlanRepo.upsert(p);
          rows = await cookPlanRepo.all();
        }
        set({ plans: rows, hydrated: true });
        return;
      } catch (e) {
        console.warn('[stock] cook-plan hydrate failed, using seed', e);
      }
    }
    const saved = await webPersist.load<CookPlan[]>('cookPlans');
    set({ plans: saved ?? seedCookPlans(), hydrated: true });
  },

  getById: (id) => get().plans.find((p) => p.id === id),

  save: async (plan) => {
    set((s) => {
      const i = s.plans.findIndex((p) => p.id === plan.id);
      const plans = [...s.plans];
      if (i >= 0) plans[i] = plan;
      else plans.unshift(plan);
      return { plans };
    });
    if (NATIVE) {
      try {
        await cookPlanRepo.upsert(plan);
      } catch (e) {
        console.warn('[stock] cook-plan persist failed', e);
      }
    }
  },

  remove: async (id) => {
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
    if (NATIVE) {
      try {
        await cookPlanRepo.remove(id);
      } catch (e) {
        console.warn('[stock] cook-plan delete failed', e);
      }
    }
  },
}));

// Web write-through to IndexedDB on every change (native persists per-mutation).
if (!NATIVE) {
  useCookPlanStore.subscribe((s) => void webPersist.save('cookPlans', s.plans));
}
