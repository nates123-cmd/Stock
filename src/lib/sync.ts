/**
 * Cloud sync layer (spec direction: [[project_stock_is_a_pwa]]).
 *
 * Signed in: cloud is the source of truth. On sign-in we pull each table;
 * for tables that come back empty we upload existing local items (first-
 * sign-in migration). After that, every local store mutation pushes to
 * cloud, and Realtime mirrors changes from other devices back into the
 * store.
 *
 * Implementation: subscribe to each store from here — NO edits to the
 * stores needed. The stores already spread on every mutation, so per-item
 * object identity is a reliable "did this item change" signal. Realtime
 * updates add the id to a `suppress` set right before applying, so the
 * local-subscribe sees the change, finds the id in suppress, and skips the
 * echo push. Clean, synchronous, zero new imports in the store files.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, SUPABASE_AVAILABLE } from './supabase';
import { useAuthStore } from '@/store/auth';
import { useRecipeStore } from '@/store/recipes';
import { usePlanStore } from '@/store/plan';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';
import { useCookStore } from '@/store/cooks';
import { useHaveStore, type HaveRecord } from '@/store/have';
import { useExtrasStore, type ExtraItem } from '@/store/extras';
import { reviveRecipeDates } from './db/repositories';
import type { Cook, PantryItem, PipelineIdea, PlanEntry } from '@/types';

type CloudTable =
  | 'recipes'
  | 'plan_entries'
  | 'pantry_items'
  | 'pipeline_ideas'
  | 'cooks'
  | 'have_records'
  | 'extras';

/* ---------- Date revivers (JSON → Date; mirrors repositories.ts) ---------- */

function reviveModDatesAny(item: {
  modificationHistory?: { date: Date }[];
}): void {
  item.modificationHistory?.forEach((m) => {
    m.date = new Date(m.date as unknown as string);
  });
}

function revivePlanEntry(p: PlanEntry): PlanEntry {
  p.date = new Date(p.date as unknown as string);
  return p;
}

function revivePantryItem(p: PantryItem): PantryItem {
  p.acquiredAt = new Date(p.acquiredAt as unknown as string);
  if (p.expiresAt) p.expiresAt = new Date(p.expiresAt as unknown as string);
  p.purchaseHistory = (p.purchaseHistory ?? []).map(
    (d) => new Date(d as unknown as string),
  );
  return p;
}

function revivePipelineIdea(p: PipelineIdea): PipelineIdea {
  p.createdAt = new Date(p.createdAt as unknown as string);
  p.bestGuessIngredients?.forEach((i) => reviveModDatesAny(i));
  return p;
}

function reviveCook(c: Cook): Cook {
  c.startedAt = new Date(c.startedAt as unknown as string);
  if (c.finishedAt) c.finishedAt = new Date(c.finishedAt as unknown as string);
  c.modifications?.forEach((m) => {
    m.date = new Date(m.date as unknown as string);
  });
  if (c.recipeVersionSnapshot) reviveRecipeDates(c.recipeVersionSnapshot);
  return c;
}

function reviveExtraItem(e: ExtraItem): ExtraItem {
  e.addedAt = new Date(e.addedAt as unknown as string);
  return e;
}

/**
 * Have store cloud shape: one row per canonical name, carrying the count,
 * the last-marked timestamp, and the always-have pin flag. byName +
 * alwaysHave in the store get rebuilt from these on cloud → local.
 */
type HaveRow = {
  id: string;
  count: number;
  lastAt: Date;
  always: boolean;
};

function reviveHaveRow(r: HaveRow): HaveRow {
  r.lastAt = new Date(r.lastAt as unknown as string);
  return r;
}

// Item-shaped projection of useHaveStore state, cached so unchanged rows
// keep their reference identity (the sync diff is ref-equality based).
const haveRowCache = new Map<string, HaveRow>();

function readHaveRows(): HaveRow[] {
  const s = useHaveStore.getState();
  const out: HaveRow[] = [];
  const seen = new Set<string>();

  for (const [id, rec] of Object.entries(s.byName)) {
    seen.add(id);
    const always = s.alwaysHave[id] === true;
    const cached = haveRowCache.get(id);
    if (
      cached &&
      cached.count === rec.count &&
      cached.lastAt.getTime() === rec.lastAt.getTime() &&
      cached.always === always
    ) {
      out.push(cached);
    } else {
      const next: HaveRow = { id, count: rec.count, lastAt: rec.lastAt, always };
      haveRowCache.set(id, next);
      out.push(next);
    }
  }
  // Always-pinned names that have no count entry (pinned but never marked).
  for (const id of Object.keys(s.alwaysHave)) {
    if (seen.has(id)) continue;
    const cached = haveRowCache.get(id);
    if (cached && cached.count === 0 && cached.always === true) {
      out.push(cached);
    } else {
      const next: HaveRow = { id, count: 0, lastAt: new Date(0), always: true };
      haveRowCache.set(id, next);
      out.push(next);
    }
  }
  // Evict cache entries that no longer exist in either map.
  for (const id of Array.from(haveRowCache.keys())) {
    if (!s.byName[id] && !s.alwaysHave[id]) haveRowCache.delete(id);
  }
  return out;
}

function replaceHaveRows(next: HaveRow[]): void {
  const byName: Record<string, HaveRecord> = {};
  const alwaysHave: Record<string, true> = {};
  haveRowCache.clear();
  for (const row of next) {
    haveRowCache.set(row.id, row);
    if (row.count > 0) byName[row.id] = { count: row.count, lastAt: row.lastAt };
    if (row.always) alwaysHave[row.id] = true;
  }
  useHaveStore.setState({ byName, alwaysHave });
}

/* ---------- Per-collection wiring ---------- */

type Item = { id: string };
type Collection = {
  table: CloudTable;
  read: () => Item[];
  replace: (next: Item[]) => void;
  subscribe: (listener: () => void) => () => void;
  revive: (raw: unknown) => Item;
};

const collections: Collection[] = [
  {
    table: 'recipes',
    read: () => useRecipeStore.getState().recipes,
    replace: (next) =>
      useRecipeStore.setState({ recipes: next as ReturnType<typeof useRecipeStore.getState>['recipes'] }),
    subscribe: (l) => useRecipeStore.subscribe(l),
    revive: (raw) => reviveRecipeDates(raw as never),
  },
  {
    table: 'plan_entries',
    read: () => usePlanStore.getState().entries,
    replace: (next) =>
      usePlanStore.setState({ entries: next as ReturnType<typeof usePlanStore.getState>['entries'] }),
    subscribe: (l) => usePlanStore.subscribe(l),
    revive: (raw) => revivePlanEntry(raw as PlanEntry),
  },
  {
    table: 'pantry_items',
    read: () => usePantryStore.getState().items,
    replace: (next) =>
      usePantryStore.setState({ items: next as ReturnType<typeof usePantryStore.getState>['items'] }),
    subscribe: (l) => usePantryStore.subscribe(l),
    revive: (raw) => revivePantryItem(raw as PantryItem),
  },
  {
    table: 'pipeline_ideas',
    read: () => usePipelineStore.getState().ideas,
    replace: (next) =>
      usePipelineStore.setState({ ideas: next as ReturnType<typeof usePipelineStore.getState>['ideas'] }),
    subscribe: (l) => usePipelineStore.subscribe(l),
    revive: (raw) => revivePipelineIdea(raw as PipelineIdea),
  },
  {
    table: 'cooks',
    read: () => useCookStore.getState().cooks,
    replace: (next) =>
      useCookStore.setState({ cooks: next as ReturnType<typeof useCookStore.getState>['cooks'] }),
    subscribe: (l) => useCookStore.subscribe(l),
    revive: (raw) => reviveCook(raw as Cook),
  },
  {
    table: 'have_records',
    read: readHaveRows,
    replace: (next) => replaceHaveRows(next as HaveRow[]),
    subscribe: (l) => useHaveStore.subscribe(l),
    revive: (raw) => reviveHaveRow(raw as HaveRow),
  },
  {
    table: 'extras',
    read: () => useExtrasStore.getState().items,
    replace: (next) =>
      useExtrasStore.setState({ items: next as ExtraItem[] }),
    subscribe: (l) => useExtrasStore.subscribe(l),
    revive: (raw) => reviveExtraItem(raw as ExtraItem),
  },
];

/* ---------- State ---------- */

let activeChannel: RealtimeChannel | null = null;
let activeUserId: string | null = null;
const unsubscribers: Array<() => void> = [];

// Per-table cache of the LAST item ref we pushed for each id. A diff against
// this catches local mutations (new ref) without needing a deep equality.
const refCache: Record<CloudTable, Map<string, Item>> = {
  recipes: new Map(),
  plan_entries: new Map(),
  pantry_items: new Map(),
  pipeline_ideas: new Map(),
  cooks: new Map(),
  have_records: new Map(),
  extras: new Map(),
};

// Echo guard: when Realtime delivers a change, we add its id to suppress
// before applying. The store-subscribe then sees the new ref, looks up the
// id in suppress, and skips the push (the change is already in the cloud —
// we just got it from there).
const suppress = new Set<string>(); // `${table}:${id}`

const suppressKey = (table: CloudTable, id: string) => `${table}:${id}`;

/* ---------- Cloud I/O ---------- */

async function cloudUpsert(
  table: CloudTable,
  userId: string,
  item: Item,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from(table)
    .upsert({ id: item.id, user_id: userId, data: item });
  if (error) console.warn('[stock/sync] upsert failed', table, error.message);
}

async function cloudDelete(
  table: CloudTable,
  id: string,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) console.warn('[stock/sync] delete failed', table, error.message);
}

/* ---------- Local → cloud (per-store subscribe) ---------- */

function makeStoreListener(c: Collection): () => void {
  const cache = refCache[c.table];
  return () => {
    const userId = useAuthStore.getState().user?.id;
    if (!userId) return;

    const items = c.read();
    const currIds = new Set<string>();
    for (const item of items) {
      currIds.add(item.id);
      if (cache.get(item.id) !== item) {
        const key = suppressKey(c.table, item.id);
        if (suppress.has(key)) {
          suppress.delete(key);
        } else {
          void cloudUpsert(c.table, userId, item);
        }
        cache.set(item.id, item);
      }
    }
    // Deletions: anything in the cache but not in currIds.
    for (const id of Array.from(cache.keys())) {
      if (!currIds.has(id)) {
        const key = suppressKey(c.table, id);
        if (suppress.has(key)) {
          suppress.delete(key);
        } else {
          void cloudDelete(c.table, id);
        }
        cache.delete(id);
      }
    }
  };
}

/* ---------- Cloud → local (Realtime) ---------- */

type ChangePayload = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: { id: string; data: unknown } | null;
  old: { id?: string } | null;
};

function applyRealtime(c: Collection, payload: ChangePayload): void {
  const cur = c.read();
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id;
    if (!id) return;
    suppress.add(suppressKey(c.table, id));
    c.replace(cur.filter((x) => x.id !== id));
    return;
  }
  if (!payload.new) return;
  const item = c.revive(payload.new.data);
  suppress.add(suppressKey(c.table, item.id));
  const i = cur.findIndex((x) => x.id === item.id);
  const next =
    i >= 0 ? cur.map((x, idx) => (idx === i ? item : x)) : [item, ...cur];
  c.replace(next);
}

/* ---------- Lifecycle ---------- */

function seedCache(c: Collection): void {
  const cache = refCache[c.table];
  cache.clear();
  for (const item of c.read()) cache.set(item.id, item);
}

async function start(userId: string): Promise<void> {
  if (!supabase || activeUserId === userId) return;
  if (activeUserId) await stop();
  activeUserId = userId;

  // 1) Pull + first-sign-in migration per table.
  for (const c of collections) {
    const { data, error } = await supabase
      .from(c.table)
      .select('id, data')
      .eq('user_id', userId);
    if (error) {
      console.warn('[stock/sync] pull failed', c.table, error.message);
      continue;
    }
    const cloudItems = (data ?? []).map((row) => c.revive(row.data));
    if (cloudItems.length === 0) {
      const local = c.read();
      if (local.length > 0) {
        const rows = local.map((item) => ({
          id: item.id,
          user_id: userId,
          data: item,
        }));
        const { error: upErr } = await supabase.from(c.table).upsert(rows);
        if (upErr) {
          console.warn('[stock/sync] migration upload failed', c.table, upErr.message);
        }
        // Local already matches cloud now.
      } else {
        c.replace([]);
      }
    } else {
      c.replace(cloudItems);
    }
    // 2) Snapshot so the next subscribe pass sees no spurious diff.
    seedCache(c);
  }

  // 3) Register local → cloud subscribers.
  for (const c of collections) {
    unsubscribers.push(c.subscribe(makeStoreListener(c)));
  }

  // 4) Cloud → local Realtime channel.
  const ch = supabase.channel(`stock-sync-${userId}`);
  for (const c of collections) {
    ch.on(
      // postgres_changes is a valid Realtime event but not part of the
      // narrow generic type in supabase-js — cast at the boundary.
      'postgres_changes' as never,
      {
        event: '*',
        schema: 'public',
        table: c.table,
        filter: `user_id=eq.${userId}`,
      } as never,
      (payload: ChangePayload) => applyRealtime(c, payload),
    );
  }
  activeChannel = ch;
  ch.subscribe();
}

async function stop(): Promise<void> {
  while (unsubscribers.length) unsubscribers.pop()?.();
  for (const c of collections) refCache[c.table].clear();
  suppress.clear();
  if (activeChannel) {
    await activeChannel.unsubscribe();
    activeChannel = null;
  }
  activeUserId = null;
}

/* ---------- Wire to auth state ---------- */

if (SUPABASE_AVAILABLE) {
  useAuthStore.subscribe((s) => {
    if (s.user && s.user.id !== activeUserId) {
      void start(s.user.id);
    } else if (!s.user && activeUserId) {
      void stop();
    }
  });
}
