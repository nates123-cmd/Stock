/**
 * Cloud sync layer (spec direction: [[project_stock_is_a_pwa]]).
 *
 * Signed in: cloud is the source of truth. Every local store mutation pushes
 * to cloud; Realtime mirrors other devices' changes back into the store.
 *
 * WHY THIS FILE IS SHAPED LIKE THIS (round 2, "device to device"): the first
 * version pulled ONCE at sign-in and then trusted Realtime forever. That is
 * not enough for a PWA:
 *
 *   * iOS Safari suspends a backgrounded PWA and kills its websocket. Realtime
 *     has no backfill — every change made while the socket was down is lost to
 *     that device, permanently, because nothing ever pulled again.
 *   * a phone left "open" for days never cold-starts, so `start()` never
 *     re-ran and the only pull that ever happened was days ago.
 *   * `ch.subscribe()` took no status callback, so a channel that failed to
 *     join (or silently dropped) looked exactly like "no changes".
 *
 * So: the pull is now a re-runnable MERGE (`syncNow`), re-run on foreground,
 * on network-online, on Realtime (re)join, and on a slow timer. Realtime is an
 * accelerator now, not the only path.
 *
 * The merge is incremental — it compares each row's `updated_at` against the
 * last one we saw, so a resync of a 200-recipe library normally revives and
 * replaces nothing and costs one SELECT per table. Rows whose ref it does
 * change are added to `suppress` first, so the local→cloud subscriber sees the
 * change, finds the id suppressed, and skips the echo push.
 */
import { AppState } from 'react-native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase, SUPABASE_AVAILABLE } from './supabase';
import { resolveOwnerId } from './household';
import { idsNeedingFetch, planMerge, type CloudStamp } from './syncMerge';
import { useAuthStore } from '@/store/auth';
import { useRecipeStore } from '@/store/recipes';
import { usePlanStore } from '@/store/plan';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';
import { useCookStore } from '@/store/cooks';
import { useCookPlanStore } from '@/store/cookPlans';
import { useHaveStore, type HaveRecord } from '@/store/have';
import { useExtrasStore, type ExtraItem } from '@/store/extras';
import { usePushedStore, type PushedEntry } from '@/store/pushed';
import { reviveRecipeDates, reviveCookPlanDates } from './db/repositories';
import type { Cook, CookPlan, Meal, PantryItem, PipelineIdea } from '@/types';

type CloudTable =
  | 'recipes'
  | 'plan_entries'
  | 'pantry_items'
  | 'pipeline_ideas'
  | 'cooks'
  | 'cook_plans'
  | 'have_records'
  | 'extras'
  | 'pushed';

/* ---------- Date revivers (JSON → Date; mirrors repositories.ts) ---------- */

function reviveModDatesAny(item: {
  modificationHistory?: { date: Date }[];
}): void {
  item.modificationHistory?.forEach((m) => {
    m.date = new Date(m.date as unknown as string);
  });
}

function reviveMeal(p: Meal): Meal {
  p.date = new Date(p.date as unknown as string);
  // Tolerate legacy cloud rows (old PlanEntry shape) — an absent dishes array
  // would crash every reader that maps over it. Reset to empty rather than drop
  // (the row still round-trips; the UI just shows an empty meal).
  if (!Array.isArray(p.dishes)) p.dishes = [];
  return p;
}

function revivePantryItem(p: PantryItem): PantryItem {
  p.acquiredAt = new Date(p.acquiredAt as unknown as string);
  if (p.expiresAt) p.expiresAt = new Date(p.expiresAt as unknown as string);
  // statusUpdatedAt is a Date too — missing it left cloud-synced 'out'/'low'
  // items with a string here, and StatusPill's since.getTime() then crashed
  // the whole Pantry screen to blank (patch #1ef184bd, round 2).
  if (p.statusUpdatedAt) p.statusUpdatedAt = new Date(p.statusUpdatedAt as unknown as string);
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

/**
 * Item-shaped projection of a pushed marker.
 *
 * `PushedEntry` is keyed by `key` (the matchKey of the item name); the sync
 * layer needs an `id`. They are the same string — this row type just renames
 * it so the generic collection machinery can address it like every other
 * table.
 */
type PushedRow = {
  id: string;
  name: string;
  extraIds?: string[];
  nameMatch?: true;
  pushedAt: Date;
  dest: PushedEntry['dest'];
};

function revivePushedRow(r: PushedRow): PushedRow {
  r.pushedAt = new Date(r.pushedAt as unknown as string);
  return r;
}

const toPushedRow = (e: PushedEntry): PushedRow => ({
  id: e.key,
  name: e.name,
  ...(e.extraIds ? { extraIds: e.extraIds } : {}),
  ...(e.nameMatch ? { nameMatch: e.nameMatch } : {}),
  pushedAt: e.pushedAt,
  dest: e.dest,
});

// Cached so unchanged markers keep their reference identity — the sync diff is
// ref-equality based, and a fresh object every read would push every marker on
// every store notification.
const pushedRowCache = new Map<string, PushedRow>();

function readPushedRows(): PushedRow[] {
  const items = usePushedStore.getState().items;
  const out: PushedRow[] = [];
  const seen = new Set<string>();
  for (const e of items) {
    seen.add(e.key);
    const cached = pushedRowCache.get(e.key);
    if (
      cached &&
      cached.name === e.name &&
      cached.dest === e.dest &&
      cached.pushedAt.getTime() === e.pushedAt.getTime() &&
      cached.nameMatch === e.nameMatch &&
      sameIds(cached.extraIds, e.extraIds)
    ) {
      out.push(cached);
    } else {
      const next = toPushedRow(e);
      pushedRowCache.set(e.key, next);
      out.push(next);
    }
  }
  for (const id of Array.from(pushedRowCache.keys())) {
    if (!seen.has(id)) pushedRowCache.delete(id);
  }
  return out;
}

function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function replacePushedRows(next: PushedRow[]): void {
  pushedRowCache.clear();
  const items: PushedEntry[] = next.map((row) => {
    pushedRowCache.set(row.id, row);
    return {
      key: row.id,
      name: row.name,
      ...(row.extraIds ? { extraIds: row.extraIds } : {}),
      ...(row.nameMatch ? { nameMatch: row.nameMatch } : {}),
      pushedAt: row.pushedAt,
      dest: row.dest,
    };
  });
  usePushedStore.setState({ items });
}

/* ---------- Per-collection wiring ---------- */

type Item = { id: string };
type Collection = {
  table: CloudTable;
  read: () => Item[];
  replace: (next: Item[]) => void;
  subscribe: (listener: () => void) => () => void;
  revive: (raw: unknown) => Item;
  /**
   * Has this store finished loading from IndexedDB/SQLite? The pull must not
   * run before it has: a merge against an empty-because-not-loaded-yet store
   * reads as "everything was deleted elsewhere".
   */
  hydrated: () => boolean;
};

const collections: Collection[] = [
  {
    table: 'recipes',
    read: () => useRecipeStore.getState().recipes,
    replace: (next) =>
      useRecipeStore.setState({ recipes: next as ReturnType<typeof useRecipeStore.getState>['recipes'] }),
    subscribe: (l) => useRecipeStore.subscribe(l),
    revive: (raw) => reviveRecipeDates(raw as never),
    hydrated: () => useRecipeStore.getState().hydrated,
  },
  {
    // Cloud table name kept as-is (JSON blob store); the row shape is now Meal.
    table: 'plan_entries',
    read: () => usePlanStore.getState().meals,
    replace: (next) =>
      usePlanStore.setState({ meals: next as ReturnType<typeof usePlanStore.getState>['meals'] }),
    subscribe: (l) => usePlanStore.subscribe(l),
    revive: (raw) => reviveMeal(raw as Meal),
    hydrated: () => usePlanStore.getState().hydrated,
  },
  {
    table: 'pantry_items',
    read: () => usePantryStore.getState().items,
    replace: (next) =>
      usePantryStore.setState({ items: next as ReturnType<typeof usePantryStore.getState>['items'] }),
    subscribe: (l) => usePantryStore.subscribe(l),
    revive: (raw) => revivePantryItem(raw as PantryItem),
    hydrated: () => usePantryStore.getState().hydrated,
  },
  {
    table: 'pipeline_ideas',
    read: () => usePipelineStore.getState().ideas,
    replace: (next) =>
      usePipelineStore.setState({ ideas: next as ReturnType<typeof usePipelineStore.getState>['ideas'] }),
    subscribe: (l) => usePipelineStore.subscribe(l),
    revive: (raw) => revivePipelineIdea(raw as PipelineIdea),
    hydrated: () => usePipelineStore.getState().hydrated,
  },
  {
    table: 'cooks',
    read: () => useCookStore.getState().cooks,
    replace: (next) =>
      useCookStore.setState({ cooks: next as ReturnType<typeof useCookStore.getState>['cooks'] }),
    subscribe: (l) => useCookStore.subscribe(l),
    revive: (raw) => reviveCook(raw as Cook),
    hydrated: () => useCookStore.getState().hydrated,
  },
  {
    table: 'cook_plans',
    read: () => useCookPlanStore.getState().plans,
    replace: (next) =>
      useCookPlanStore.setState({ plans: next as ReturnType<typeof useCookPlanStore.getState>['plans'] }),
    subscribe: (l) => useCookPlanStore.subscribe(l),
    revive: (raw) => reviveCookPlanDates(raw as CookPlan),
    hydrated: () => useCookPlanStore.getState().hydrated,
  },
  {
    table: 'have_records',
    read: readHaveRows,
    replace: (next) => replaceHaveRows(next as HaveRow[]),
    subscribe: (l) => useHaveStore.subscribe(l),
    revive: (raw) => reviveHaveRow(raw as HaveRow),
    hydrated: () => useHaveStore.getState().hydrated,
  },
  {
    table: 'extras',
    read: () => useExtrasStore.getState().items,
    replace: (next) =>
      useExtrasStore.setState({ items: next as ExtraItem[] }),
    subscribe: (l) => useExtrasStore.subscribe(l),
    revive: (raw) => reviveExtraItem(raw as ExtraItem),
    hydrated: () => useExtrasStore.getState().hydrated,
  },
  {
    // A pushed marker is the ONLY thing that takes a row off the active
    // shopping list (see lib/activeList.ts). Syncing `extras` without syncing
    // these means every device pulls the same items but reaches a different
    // answer about which of them are already ordered — push on the phone and
    // the laptop still shows the whole list. That is the "shopping list keeps
    // reappearing / doesn't sync" bug, and it lives here rather than in any of
    // the row logic that previous rounds kept rewriting.
    table: 'pushed',
    read: readPushedRows,
    replace: (next) => replacePushedRows(next as PushedRow[]),
    subscribe: (l) => usePushedStore.subscribe(l),
    revive: (raw) => revivePushedRow(raw as PushedRow),
    hydrated: () => usePushedStore.getState().hydrated,
  },
];

/* ---------- Observable status (rendered on the sign-in screen) ---------- */

export type SyncPhase = 'off' | 'starting' | 'syncing' | 'idle' | 'error';

type SyncStatus = {
  phase: SyncPhase;
  /** Realtime channel is joined — changes arrive instantly, not just on resync. */
  live: boolean;
  /** ms epoch of the last successful full merge, or null. */
  lastSyncAt: number | null;
  lastError: string | null;
};

export const useSyncStatus = create<SyncStatus>(() => ({
  phase: SUPABASE_AVAILABLE ? 'starting' : 'off',
  live: false,
  lastSyncAt: null,
  lastError: null,
}));

/* ---------- State ---------- */

let activeChannel: RealtimeChannel | null = null;
let activeUserId: string | null = null;
/**
 * The uid every kitchen row is stored under — the signed-in uid normally, or
 * the household owner's uid when this account is a member of someone else's
 * kitchen ([[project_stock_household_sharing]]). Resolved at sign-in and
 * re-checked on foreground, so being added to a household takes effect without
 * the member having to reload. Every pull, push, and Realtime filter uses
 * THIS, not the signed-in uid, which is what makes two accounts see one
 * kitchen.
 */
let activeOwnerId: string | null = null;
const unsubscribers: Array<() => void> = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let rejoinTimer: ReturnType<typeof setTimeout> | null = null;
let rejoinAttempt = 0;
let syncing = false;
let lastOwnerCheckAt = 0;

/** How often to re-pull while the app is foregrounded, as a Realtime backstop. */
const POLL_MS = 60_000;
/** Ignore a resync request this soon after the last one (burst collapsing). */
const MIN_GAP_MS = 4_000;
/** Re-resolve household membership at most this often. */
const OWNER_RECHECK_MS = 5 * 60_000;

/**
 * The kitchen this session is syncing, or null before sign-in. Differs from the
 * signed-in uid exactly when this account is a member of someone else's
 * household — which is how the UI knows to say "shared kitchen" rather than
 * offering to share one.
 */
export function getActiveOwnerId(): string | null {
  return activeOwnerId;
}

// Per-table cache of the LAST item ref we pushed for each id. A diff against
// this catches local mutations (new ref) without needing a deep equality.
const refCache: Record<CloudTable, Map<string, Item>> = {
  recipes: new Map(),
  plan_entries: new Map(),
  pantry_items: new Map(),
  pipeline_ideas: new Map(),
  cooks: new Map(),
  cook_plans: new Map(),
  have_records: new Map(),
  extras: new Map(),
  pushed: new Map(),
};

/**
 * Per-table id → the `updated_at` we last pulled for that row. The merge skips
 * any row whose timestamp is unchanged, so a routine resync touches no refs and
 * re-renders nothing. (Every kitchen table has an updated_at trigger — see
 * 20260519000000_user_sync_init.sql.)
 */
const seenUpdatedAt: Record<CloudTable, Map<string, string>> = {
  recipes: new Map(),
  plan_entries: new Map(),
  pantry_items: new Map(),
  pipeline_ideas: new Map(),
  cooks: new Map(),
  cook_plans: new Map(),
  have_records: new Map(),
  extras: new Map(),
  pushed: new Map(),
};

/**
 * Ids CONFIRMED to exist in the cloud (a pull returned them, or our upsert came
 * back without an error). Only these may be dropped locally when they go
 * missing from a pull — an item whose upsert failed (offline) is absent from
 * the cloud too, and dropping it would destroy work the user just did.
 */
const confirmed: Record<CloudTable, Set<string>> = {
  recipes: new Set(),
  plan_entries: new Set(),
  pantry_items: new Set(),
  pipeline_ideas: new Set(),
  cooks: new Set(),
  cook_plans: new Set(),
  have_records: new Set(),
  extras: new Set(),
  pushed: new Set(),
};

// Echo guard: when Realtime (or a merge) applies a cloud change, we add its id
// to suppress before applying. The store-subscribe then sees the new ref, looks
// up the id in suppress, and skips the push (the change is already in the cloud
// — we just got it from there).
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
  if (error) {
    console.warn('[stock/sync] upsert failed', table, error.message);
    useSyncStatus.setState({ phase: 'error', lastError: error.message });
    return;
  }
  // It really is up there now, so a later pull that doesn't return it means
  // another device deleted it — safe to mirror that deletion locally.
  confirmed[table].add(item.id);
}

async function cloudDelete(
  table: CloudTable,
  id: string,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) {
    console.warn('[stock/sync] delete failed', table, error.message);
    useSyncStatus.setState({ phase: 'error', lastError: error.message });
    return;
  }
  confirmed[table].delete(id);
  seenUpdatedAt[table].delete(id);
}

/* ---------- Local → cloud (per-store subscribe) ---------- */

function makeStoreListener(c: Collection): () => void {
  const cache = refCache[c.table];
  return () => {
    // Stamp rows with the household owner, not the signed-in user — otherwise a
    // member's edits would land in a silo nobody else pulls.
    const userId = activeOwnerId;
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
  errors?: unknown;
};

function applyRealtime(c: Collection, payload: ChangePayload): void {
  const cur = c.read();
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id;
    if (!id) return;
    confirmed[c.table].delete(id);
    seenUpdatedAt[c.table].delete(id);
    suppress.add(suppressKey(c.table, id));
    c.replace(cur.filter((x) => x.id !== id));
    return;
  }
  // Realtime drops the record body when the row exceeds the channel's
  // max_record_bytes (a recipe carrying an embedded photo can). `data` is then
  // missing, and reviving it would throw — fall back to a pull, which has no
  // such limit.
  if (!payload.new?.data) {
    void syncNow('realtime-payload-truncated', { force: true });
    return;
  }
  const item = c.revive(payload.new.data);
  confirmed[c.table].add(item.id);
  suppress.add(suppressKey(c.table, item.id));
  const i = cur.findIndex((x) => x.id === item.id);
  const next =
    i >= 0 ? cur.map((x, idx) => (idx === i ? item : x)) : [item, ...cur];
  c.replace(next);
}

/* ---------- The merge ---------- */

type MergeMode = 'initial' | 'resync';

/** Rows to ask for the body of in one `.in('id', …)` — keeps the URL sane. */
const BODY_BATCH = 100;
/** Stamp-read page size; must be ≤ PostgREST's max-rows so paging terminates. */
const STAMP_PAGE = 500;

/**
 * Pull one table and reconcile it into the store.
 *
 * Two phases on purpose: a stamp read (`id, updated_at`) costs a few KB even
 * for a 200-recipe library, and tells us exactly which rows are worth pulling
 * the (photo-carrying) body of. A resync that finds nothing new transfers
 * almost nothing, which is what makes a once-a-minute poll acceptable on a
 * phone.
 *
 * Cloud wins for any row whose `updated_at` moved since we last saw it; rows
 * that didn't move keep their existing object ref, so a no-op resync causes no
 * re-render and no echo push. Local rows the cloud has never confirmed are kept
 * (they're new, or their upload failed) and get pushed by the store listener.
 * Local rows the cloud HAS confirmed but no longer returns were deleted on
 * another device, so they're dropped here too.
 */
async function mergeTable(
  c: Collection,
  userId: string,
  mode: MergeMode,
  isMember: boolean,
): Promise<void> {
  if (!supabase) return;

  // Page the stamp read explicitly. PostgREST caps an unbounded select (1000
  // rows by default), and a SILENTLY truncated list is the worst possible input
  // to this function: every row past the cap looks like one another device
  // deleted, and the merge would delete it for real.
  const stamps: CloudStamp[] = [];
  for (let from = 0; ; from += STAMP_PAGE) {
    const { data, error } = await supabase
      .from(c.table)
      .select('id, updated_at')
      .eq('user_id', userId)
      .range(from, from + STAMP_PAGE - 1);
    if (error) throw new Error(`${c.table}: ${error.message}`);
    const page = (data ?? []) as CloudStamp[];
    stamps.push(...page);
    if (page.length < STAMP_PAGE) break;
  }
  const local = c.read();

  // First sign-in for the OWNER of an empty kitchen: nothing to merge down, and
  // the store listener would push local up one row at a time. Bulk-upload
  // instead, then treat local as authoritative.
  if (mode === 'initial' && stamps.length === 0) {
    if (local.length > 0 && !isMember) {
      const { error: upErr } = await supabase
        .from(c.table)
        .upsert(local.map((item) => ({ id: item.id, user_id: userId, data: item })));
      if (upErr) {
        console.warn('[stock/sync] migration upload failed', c.table, upErr.message);
      } else {
        for (const item of local) confirmed[c.table].add(item.id);
      }
    }
    // A member joining someone's kitchen is ADOPTING it, not merging into it —
    // their local-only items stay local and are never uploaded into the
    // owner's data. (Nothing to do here; we just don't upload.)
    return;
  }

  // Phase two: bodies, but only for the rows that actually moved.
  const seen = seenUpdatedAt[c.table];
  const wanted = idsNeedingFetch(local, stamps, seen);
  const bodies = new Map<string, unknown>();
  for (let i = 0; i < wanted.length; i += BODY_BATCH) {
    const batch = wanted.slice(i, i + BODY_BATCH);
    const { data: bodyRows, error: bodyErr } = await supabase
      .from(c.table)
      .select('id, data')
      .eq('user_id', userId)
      .in('id', batch);
    if (bodyErr) throw new Error(`${c.table} bodies: ${bodyErr.message}`);
    for (const r of (bodyRows ?? []) as { id: string; data: unknown }[]) {
      bodies.set(r.id, r.data);
    }
  }

  const plan = planMerge<Item>({
    local,
    stamps,
    bodies,
    seen,
    confirmed: confirmed[c.table],
    revive: c.revive,
    adoptOnly: mode === 'initial' && isMember,
  });

  if (!plan.next) return; // nothing moved: don't touch the store at all

  for (const id of plan.changedIds) suppress.add(suppressKey(c.table, id));
  for (const id of plan.droppedIds) suppress.add(suppressKey(c.table, id));
  c.replace(plan.next);
}

/**
 * Re-pull every table and reconcile. Safe to call as often as you like — it
 * collapses bursts, skips while one is already running, and normally changes
 * nothing.
 */
export async function syncNow(
  reason: string,
  opts: { mode?: MergeMode; force?: boolean } = {},
): Promise<void> {
  const { mode = 'resync', force = false } = opts;
  if (!supabase || !activeOwnerId || !activeUserId) return;
  if (syncing) return;
  const last = useSyncStatus.getState().lastSyncAt;
  if (!force && last !== null && Date.now() - last < MIN_GAP_MS) return;

  syncing = true;
  useSyncStatus.setState({ phase: 'syncing' });
  const userId = activeOwnerId;
  const isMember = activeOwnerId !== activeUserId;
  try {
    for (const c of collections) {
      // A store still loading has no rows yet; merging against it would look
      // like "everything was deleted elsewhere". Skip it this pass.
      if (!c.hydrated()) continue;
      await mergeTable(c, userId, mode, isMember);
      if (activeOwnerId !== userId) return; // signed out / switched mid-pass
    }
    useSyncStatus.setState({
      phase: 'idle',
      lastSyncAt: Date.now(),
      lastError: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[stock/sync] resync failed', reason, msg);
    useSyncStatus.setState({ phase: 'error', lastError: msg });
  } finally {
    syncing = false;
  }
}

/* ---------- Lifecycle ---------- */

function seedCache(c: Collection): void {
  const cache = refCache[c.table];
  cache.clear();
  for (const item of c.read()) cache.set(item.id, item);
}

/**
 * Wait (briefly) for the local stores to finish loading. The pull races the
 * hydrate kicked off in _layout; merging before hydrate reads an empty store.
 */
async function waitForHydration(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (collections.every((c) => c.hydrated())) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.warn('[stock/sync] hydrate timed out; syncing the stores that are ready');
}

function joinChannel(userId: string): void {
  if (!supabase) return;
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
  ch.subscribe((status: string) => {
    if (activeChannel !== ch) return; // superseded by a later join
    if (status === 'SUBSCRIBED') {
      rejoinAttempt = 0;
      useSyncStatus.setState({ live: true });
      // Anything that changed while we were not joined never arrived. Catch up.
      void syncNow('realtime-joined', { force: true });
    } else if (
      status === 'CHANNEL_ERROR' ||
      status === 'TIMED_OUT' ||
      status === 'CLOSED'
    ) {
      useSyncStatus.setState({ live: false });
      scheduleRejoin(userId);
    }
  });
}

function scheduleRejoin(userId: string): void {
  if (rejoinTimer) return;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(rejoinAttempt, 5));
  rejoinAttempt += 1;
  rejoinTimer = setTimeout(() => {
    rejoinTimer = null;
    if (activeOwnerId !== userId) return;
    if (activeChannel) {
      void activeChannel.unsubscribe();
      activeChannel = null;
    }
    joinChannel(userId);
  }, delay);
}

/**
 * Household membership can be granted after this session signed in. Re-resolve
 * it on foreground (rate-limited) and restart the sync layer if the kitchen
 * changed, so being added takes effect without a reload.
 */
async function recheckOwner(): Promise<boolean> {
  const uid = activeUserId;
  const email = useAuthStore.getState().user?.email ?? null;
  if (!uid) return false;
  if (Date.now() - lastOwnerCheckAt < OWNER_RECHECK_MS) return false;
  lastOwnerCheckAt = Date.now();
  const owner = await resolveOwnerId(uid, email);
  if (activeUserId !== uid || owner === activeOwnerId) return false;
  console.warn('[stock/sync] kitchen changed; restarting sync');
  await stop();
  await start(uid, email);
  return true;
}

/** Foreground / network-back: re-resolve the kitchen, re-pull, re-join. */
async function wake(reason: string): Promise<void> {
  if (!activeUserId) return;
  if (await recheckOwner()) return; // start() already pulled
  if (!useSyncStatus.getState().live && activeOwnerId) {
    // Socket died while we were away and no status fired — force a rejoin.
    scheduleRejoin(activeOwnerId);
  }
  await syncNow(reason, { force: true });
}

function isForeground(): boolean {
  if (typeof document !== 'undefined' && typeof document.visibilityState === 'string') {
    return document.visibilityState === 'visible';
  }
  return AppState.currentState === 'active';
}

function installWakeTriggers(): void {
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void wake('appstate-active');
  });
  unsubscribers.push(() => sub.remove());

  if (typeof window !== 'undefined' && window.addEventListener) {
    const onOnline = () => void wake('network-online');
    window.addEventListener('online', onOnline);
    unsubscribers.push(() => window.removeEventListener('online', onOnline));

    // AppState on react-native-web already maps visibilitychange, but a PWA
    // resumed from the iOS app switcher does not always emit it. Listen
    // directly too; syncNow collapses the duplicate.
    if (typeof document !== 'undefined') {
      const onVis = () => {
        if (document.visibilityState === 'visible') void wake('visible');
      };
      document.addEventListener('visibilitychange', onVis);
      unsubscribers.push(() => document.removeEventListener('visibilitychange', onVis));
    }
  }

  // Slow backstop: Realtime can be joined-but-dead (a proxy holding a stale
  // socket open). A minute-scale pull makes that a delay, not a data loss.
  pollTimer = setInterval(() => {
    if (isForeground()) void syncNow('poll');
  }, POLL_MS);
}

async function start(signedInUserId: string, email: string | null): Promise<void> {
  if (!supabase || activeUserId === signedInUserId) return;
  if (activeUserId) await stop();
  activeUserId = signedInUserId;
  useSyncStatus.setState({ phase: 'starting', lastError: null });

  // 0) Whose kitchen is this? Own uid normally; the owner's uid if this email
  //    has been added to someone's household. Everything below keys off it.
  //    Re-check activeUserId after the await: a fast sign-out/sign-in during
  //    the round-trip would otherwise let this stale call arm the sync layer
  //    against the previous account.
  const ownerId = await resolveOwnerId(signedInUserId, email);
  if (activeUserId !== signedInUserId) return;
  activeOwnerId = ownerId;
  lastOwnerCheckAt = Date.now();

  // 1) Let the local stores finish loading, THEN pull. Merging against a store
  //    that hasn't hydrated reads it as empty and would delete the kitchen.
  await waitForHydration();
  if (activeUserId !== signedInUserId) return;

  await syncNow('sign-in', { mode: 'initial', force: true });

  // 2) Snapshot so the first subscribe pass sees no spurious diff.
  for (const c of collections) seedCache(c);

  // 3) Register local → cloud subscribers.
  for (const c of collections) {
    unsubscribers.push(c.subscribe(makeStoreListener(c)));
  }

  // 4) Cloud → local Realtime channel, plus the wake/poll backstops that make
  //    sync survive a suspended PWA.
  joinChannel(ownerId);
  installWakeTriggers();
}

async function stop(): Promise<void> {
  while (unsubscribers.length) unsubscribers.pop()?.();
  for (const c of collections) {
    refCache[c.table].clear();
    seenUpdatedAt[c.table].clear();
    confirmed[c.table].clear();
  }
  suppress.clear();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (rejoinTimer) {
    clearTimeout(rejoinTimer);
    rejoinTimer = null;
  }
  rejoinAttempt = 0;
  if (activeChannel) {
    await activeChannel.unsubscribe();
    activeChannel = null;
  }
  activeUserId = null;
  activeOwnerId = null;
  useSyncStatus.setState({
    phase: SUPABASE_AVAILABLE ? 'starting' : 'off',
    live: false,
    lastSyncAt: null,
    lastError: null,
  });
}

/* ---------- Wire to auth state ---------- */

if (SUPABASE_AVAILABLE) {
  useAuthStore.subscribe((s) => {
    if (s.user && s.user.id !== activeUserId) {
      void start(s.user.id, s.user.email ?? null);
    } else if (!s.user && activeUserId) {
      void stop();
    }
  });
}
