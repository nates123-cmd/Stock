import { create } from 'zustand';

/**
 * Last cloud-write failure, so a rejected save can SAY so.
 *
 * Every cloud write in lib/sync.ts is fire-and-forget with a `console.warn` on
 * failure. That is the right default — a dropped upsert must never block the
 * local-first UI — but it means a write the server refuses (an RLS policy that
 * doesn't cover this account, an offline device, a table that was never
 * migrated to prod) looks EXACTLY like a write that succeeded. The note editor
 * showed "Saved" either way.
 *
 * This is deliberately not a queue or a retry mechanism: it is one line of
 * honesty for the UI. Local state is still the source of truth and the next
 * mutation re-pushes the whole item anyway.
 */
export type SyncFailure = {
  table: string;
  message: string;
  at: Date;
};

type SyncStatusState = {
  lastError: SyncFailure | null;
  /** Cleared by any write that succeeds, so the banner doesn't linger. */
  noteFailure: (table: string, message: string) => void;
  noteSuccess: () => void;
};

export const useSyncStatusStore = create<SyncStatusState>((set, get) => ({
  lastError: null,
  noteFailure: (table, message) =>
    set({ lastError: { table, message, at: new Date() } }),
  noteSuccess: () => {
    // Only touch state when there is something to clear — otherwise every
    // successful write would notify every subscriber.
    if (get().lastError) set({ lastError: null });
  },
}));
