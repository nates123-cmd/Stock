import { Platform } from 'react-native';
import { create } from 'zustand';
import { webPersist } from '@/lib/db/webStore';

/**
 * Background cart-fill indicator. When you push a shopping list to the Beelink
 * agent, the fill runs SERVER-SIDE and takes ~30s — you shouldn't have to sit on
 * the shopping screen watching it. This tiny store tracks the active job so a
 * floating banner (CartFillBanner, mounted in the tab layout) can show progress
 * from ANY tab, and survive a reload.
 *
 * It's the INDICATOR only — the shopping screen still owns settle-up (moving
 * confirmed rows to Pushed / keeping the unavailable ones), which runs when
 * you're on the shopping tab (now the app's default landing).
 */
const NATIVE = Platform.OS !== 'web';

export type CartFillStatus = 'queued' | 'running' | 'done' | 'error';
export type CartRetailer = 'wegmans' | 'costco';

type Persisted = {
  jobId: string;
  retailer: CartRetailer;
  total: number;
  startedAtMs: number;
  status: CartFillStatus;
  added: number | null;
};

type CartFillState = {
  jobId: string | null;
  retailer: CartRetailer;
  total: number;
  startedAtMs: number | null;
  status: CartFillStatus | null;
  /** Items confirmed added — set on done. */
  added: number | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  start: (a: {
    jobId: string;
    retailer: CartRetailer;
    total: number;
    startedAtMs: number;
  }) => void;
  update: (a: { status?: CartFillStatus; added?: number | null }) => void;
  clear: () => void;
};

export const useCartFillStore = create<CartFillState>((set, get) => ({
  jobId: null,
  retailer: 'wegmans',
  total: 0,
  startedAtMs: null,
  status: null,
  added: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (!NATIVE) {
      const s = await webPersist.load<Persisted | null>('cart-fill');
      if (s && s.jobId) {
        set({ ...s, hydrated: true });
        return;
      }
    }
    set({ hydrated: true });
  },

  start: ({ jobId, retailer, total, startedAtMs }) =>
    set({ jobId, retailer, total, startedAtMs, status: 'queued', added: null }),

  update: ({ status, added }) =>
    set((st) => ({
      status: status ?? st.status,
      added: added === undefined ? st.added : added,
    })),

  clear: () =>
    set({ jobId: null, status: null, added: null, startedAtMs: null, total: 0 }),
}));

if (!NATIVE) {
  useCartFillStore.subscribe((s) => {
    const payload: Persisted | null = s.jobId
      ? {
          jobId: s.jobId,
          retailer: s.retailer,
          total: s.total,
          startedAtMs: s.startedAtMs ?? 0,
          status: s.status ?? 'queued',
          added: s.added,
        }
      : null;
    void webPersist.save('cart-fill', payload);
  });
}
