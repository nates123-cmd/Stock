import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
// Inside a Swipeable, use gesture-handler's Pressable instead of RN's — the
// RN one consumes pointer events before Pan can pick them up, so swipes
// silently no-op on web.
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  BottomActionBar,
  Overlay,
  SegmentedControl,
} from '@/components';
import { colors, fonts, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { useHaveStore } from '@/store/have';
import { useExtrasStore, type ExtraItem } from '@/store/extras';
import { usePantryStore } from '@/store/pantry';
import { useShopMetaStore } from '@/store/shopMeta';
import { usePushedStore } from '@/store/pushed';
import { useCartFillStore } from '@/store/cartFill';
import type { PantryLocation, PantryStatus } from '@/types';
import { baseIngredient, matchKey, looksLikeSameItem } from '@/lib/pantry';
import { areApart } from '@/lib/synonyms';
import { alwaysHaveKey, isAlwaysHave, isExactAlwaysHave } from '@/lib/alwaysHave';
import {
  STORES,
  storeLabel,
  remindersDeepLink,
  REMINDERS_SHORTCUT,
  type ShopMeta,
  type StoreId,
} from '@/lib/shopStores';
import { dateKey, startOfWeek, weekDays, weekRangeLabel } from '@/lib/week';
import { webPersist } from '@/lib/db/webStore';
import {
  consolidateSmart,
  consolidateLocalSmart,
  instacartText,
  CATEGORY_ORDER,
  categorizeIngredient,
  isDeliberateExtra,
  MANUAL_ACTIVE,
  MANUAL_STAPLE,
  PLAN_WIZARD,
  type ShoppingLine,
  type ShoppingSource,
} from '@/lib/shopping';
import { formatAmount } from '@/lib/format';
import {
  sendToInstacart,
  toJobItems,
  jobStatus,
  INSTACART_AVAILABLE,
  type JobStatus,
  type Retailer,
} from '@/lib/instacart';
import type { Recipe, ShoppingCategory } from '@/types';

const CAT_LABEL: Record<ShoppingCategory, string> = {
  produce: 'Produce',
  meat: 'Meat',
  dairy: 'Dairy',
  bakery: 'Bakery',
  pantry: 'Pantry',
  frozen: 'Frozen',
  other: 'Other',
};

const srcQty = (s: ShoppingSource) =>
  s.amount == null ? 'some' : s.unit && s.unit !== 'pc' ? `${s.amount} ${s.unit}` : `×${s.amount}`;

// Graceful fallback (Expo Router route boundary) instead of a blank screen.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        padding: 24,
        gap: 12,
        backgroundColor: colors.bg,
        justifyContent: 'center',
      }}>
      <Heading variant="screenTitle">Shopping list hit an error</Heading>
      <Text color="textMuted">{String(error?.message ?? error)}</Text>
      <Pressable onPress={retry}>
        <Text color="accent">Tap to retry</Text>
      </Pressable>
    </View>
  );
}

/**
 * `embedded` renders the list inside another screen (the Pantry tab's "Shop"
 * segment) rather than as a standalone modal: no top safe-area inset (the host
 * already owns it) and no "Done" back button (a tab has nowhere to go back to).
 */
export default function ShoppingList({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const params = useLocalSearchParams<{ weekStart?: string; entryIds?: string }>();
  const weekStart = useMemo(
    () => (params.weekStart ? new Date(params.weekStart) : startOfWeek(new Date())),
    [params.weekStart],
  );
  // Launched from the confirm step: scope to the chosen plan meals instead
  // of a calendar week. (Param name kept `entryIds` for route stability; the
  // ids are now meal ids.)
  const selectedEntryIds = useMemo(
    () =>
      params.entryIds ? new Set(params.entryIds.split(',').filter(Boolean)) : null,
    [params.entryIds],
  );
  const planMeals = usePlanStore((s) => s.meals);
  const recipes = useRecipeStore((s) => s.recipes);
  const extras = useExtrasStore((s) => s.items);
  const removeExtra = useExtrasStore((s) => s.remove);
  const addExtra = useExtrasStore((s) => s.add);
  const updateExtra = useExtrasStore((s) => s.update);
  const pushedItems = usePushedStore((s) => s.items);
  const pushToPushed = usePushedStore((s) => s.push);
  const restorePushed = usePushedStore((s) => s.restore);
  const clearPushed = usePushedStore((s) => s.clear);
  const hydratePushed = usePushedStore((s) => s.hydrate);
  const startCartFill = useCartFillStore((s) => s.start);
  useEffect(() => {
    void hydratePushed();
  }, [hydratePushed]);
  // Subscribe to have-state so rows re-render on tap (we use the Map directly
  // for derived booleans below, but the selector keeps us reactive).
  const haveChecked = useHaveStore((s) => s.checked);
  const alwaysHaveMap = useHaveStore((s) => s.alwaysHave);
  const markHave = useHaveStore((s) => s.mark);
  const unmarkHave = useHaveStore((s) => s.unmark);
  const setAlways = useHaveStore((s) => s.setAlways);

  // Phase D: per-name suppression (deleted plan-derived items stay gone across
  // regen — note 7a) + optional store tag / detail (note 3).
  const suppressedMap = useShopMetaStore((s) => s.suppressed);
  const suppress = useShopMetaStore((s) => s.suppress);
  const unsuppress = useShopMetaStore((s) => s.unsuppress);
  const shopMetaMap = useShopMetaStore((s) => s.meta);
  const setShopMeta = useShopMetaStore((s) => s.setMeta);
  const isSuppressed = (name: string) => suppressedMap[alwaysHaveKey(name)] === true;
  const metaFor = (name: string): ShopMeta => shopMetaMap[alwaysHaveKey(name)] ?? {};

  // Pantry-status lookup (spec §5 pantry-status integration). Builds a map
  // keyed on the canonical-match key so a row's name matches even when the
  // exact string differs ("kosher salt" vs "salt").
  const pantryItems = usePantryStore((s) => s.items);
  // The buy loop: checking a bought item off the list feeds it into the pantry
  // (restock-merge — sets it 'fine', extends the cycle). Shopping leads; the
  // pantry is downstream of it.
  const applyPaste = usePantryStore((s) => s.applyPaste);
  const toggleStaple = usePantryStore((s) => s.toggleStaple);
  const setPantryStatus = usePantryStore((s) => s.setStatus);
  const statusByKey = useMemo(() => {
    const m = new Map<string, { status: PantryStatus; name: string }>();
    for (const p of pantryItems) {
      const s = p.status ?? 'fine';
      if (s === 'fine') continue; // skip the default; only flag interesting states
      m.set(matchKey(p.canonicalName), { status: s, name: p.canonicalName });
    }
    return m;
  }, [pantryItems]);
  const statusFor = (name: string): PantryStatus | undefined => {
    const k = matchKey(name);
    if (statusByKey.has(k)) return statusByKey.get(k)!.status;
    // Allow loose match: pantry record's key is a prefix of the shopping
    // canonical (or vice versa). Mirrors the applyPaste/restock logic — but skip
    // a pair the user DECLINED as a fuzzy match, so "apple cider" doesn't inherit
    // the low/out tag from "apple cider vinegar".
    for (const [pk, v] of statusByKey) {
      if ((pk.startsWith(k) || k.startsWith(pk)) && !areApart(name, v.name)) return v.status;
    }
    return undefined;
  };

  /** session-only dismissals — consolidated rows can be swiped off this run. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Apple Reminders-style multi-select. Checking rows builds a selection
  // (matchKey-keyed); a push action bar pops up while ≥1 is selected. Session-
  // local — reselect each visit.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Inline row editor (Reminders-style tap-to-edit): matchKey of the row being
  // edited, plus the working name/qty. Session rename/qty overrides for recipe
  // + restock rows live in `overrides` (extras write straight to their store).
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const [overrides, setOverrides] = useState<
    Record<string, { name: string; qty: string }>
  >({});
  const [pushedOpen, setPushedOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  // Active is the default view. Staples = the tucked-away pile ("we need it,
  // but not soon") you toggle to when you want it.
  const [listView, setListView] = useState<'active' | 'staples'>('active');
  // Reminders-style inline add row lives at the bottom of the flat list.
  const addInputRef = useRef<TextInput>(null);
  const [haveOpen, setHaveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealText, setRevealText] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Inline edit mode (spec §10 manual add + edit). Tapping "Edit list" swaps
  // the buy list for an editable view: recipe-derived quantities become
  // editable, extras get full name/qty edit + delete, and a "+ Add item" row
  // appends user items via the extras store. The bottom action becomes
  // "Confirm" while editing.
  const [editing, setEditing] = useState(false);
  const [addName, setAddName] = useState('');
  const [addQty, setAddQty] = useState('');
  /** {name, isExtraId?} for the long-press detail sheet. Null = closed. */
  /** The row the long-press sheet is open on. Holds the whole row (not just a
   *  name) so the sheet can edit the item itself, not only its metadata. */
  const [menu, setMenu] = useState<FlatRow | null>(null);

  /** The Instacart fill we're waiting on. The Beelink agent claims the queued
   *  job and drives a real browser, so it takes a minute or two — poll it and
   *  tell the user what actually landed in the cart instead of a blind "sent!". */
  const [job, setJob] = useState<{
    id: string;
    status: JobStatus;
    /** Exactly the rows we handed the agent — so we can settle up against them
     *  when it's done, without trying to reverse-map Wegmans product names. */
    rows: FlatRow[];
    /** Which storefront this job targets (drives the result wording). */
    retailer: Retailer;
  } | null>(null);
  const [jobResult, setJobResult] = useState<{
    ok: boolean;
    /** False when the agent couldn't read the cart back — it knows nothing. */
    verified?: boolean;
    addedCount: number;
    added: { name: string; qty: number }[];
    /** In the cart, but Instacart says it isn't available in your area. */
    unavailable?: string[];
    /** Our names for what the agent couldn't get. These STAY on the list. */
    missing: string[];
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'error') return;
    let cancelled = false;
    const poll = async () => {
      const s = await jobStatus(job.id);
      if (cancelled || !s) return;
      if (s.status !== 'done' && s.status !== 'error') {
        if (s.status !== job.status) setJob({ ...job, status: s.status });
        return;
      }

      if (s.status === 'error') {
        // Nothing reached the cart — keep every item on the list.
        setJobResult({
          ok: false,
          addedCount: 0,
          added: [],
          missing: [],
          error: s.error ?? 'The cart agent errored.',
        });
        setHint(null);
        setJob({ ...job, status: s.status });
        return;
      }

      type AgentItem = { name?: string; core?: string; qty?: number };
      const r = (s.result ?? {}) as {
        verified?: boolean;
        added?: AgentItem[];
        unavailable?: AgentItem[];
        failed?: AgentItem[];
        unverified?: AgentItem[];
        unresolved?: unknown[];
      };

      // TRUST ONLY WHAT THE AGENT CONFIRMED.
      //
      // The agent used to report every item it *tried* to add as added — even
      // ones Instacart accepted and then flagged "not available in your area".
      // Stock took that at face value and dropped them off the list, so they
      // never got bought. It now names every outcome, and ONLY `added` (in the
      // cart AND available) is safe to clear.
      //
      // `verified: false` means it couldn't read the cart back — so it knows
      // nothing, and nothing leaves the list.
      const verified = r.verified !== false;
      const added = verified ? (r.added ?? []) : [];

      // Everything the agent could not deliver, by OUR name for it. Each of
      // these stays on the shopping list.
      const kept: AgentItem[][] = [
        r.unavailable ?? [],
        r.failed ?? [],
        r.unverified ?? [],
      ];
      const keptKeys = new Set(
        kept
          .flat()
          .map((i) => matchKey(String(i.core ?? i.name ?? '')))
          .filter(Boolean),
      );
      for (const u of r.unresolved ?? []) keptKeys.add(matchKey(String(u)));

      // Match the agent's confirmed items back to our rows; a row only clears if
      // it isn't in the kept set AND the agent actually confirmed something.
      const addedKeys = new Set(
        added.map((a) => matchKey(String(a.core ?? a.name ?? ''))).filter(Boolean),
      );
      const gotRows = job.rows.filter((row) => {
        const k = matchKey(row.baseName);
        if (keptKeys.has(k)) return false;
        // If the agent gave us names we can match, require a match. If it gave
        // us nothing usable, clear nothing — silence isn't success.
        return addedKeys.size > 0 ? addedKeys.has(k) : false;
      });
      const missRows = job.rows.filter((row) => !gotRows.includes(row));

      if (gotRows.length > 0) {
        pushToPushed(
          gotRows.map((row) => row.baseName),
          job.retailer,
        );
      }

      const unavailNames = (r.unavailable ?? [])
        .map((i) => String(i.core ?? i.name ?? ''))
        .filter(Boolean);
      setJobResult({
        ok: true,
        verified,
        addedCount: added.length,
        added: added.map((a) => ({ name: String(a.name ?? a.core ?? ''), qty: a.qty ?? 1 })),
        unavailable: unavailNames,
        missing: missRows.map((row) => row.name),
      });
      setHint(null);
      setJob({ ...job, status: s.status });
    };
    const iv = setInterval(poll, 4000);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [job?.id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const filling = job?.status === 'queued' || job?.status === 'running';
  // Keys currently being filled — off Active, in the "Pending" folder, until the
  // job completes (then they settle into Pushed, or return if unavailable).
  const pendingKeys = useMemo(
    () => new Set(filling && job ? job.rows.map((r) => matchKey(r.baseName)) : []),
    [filling, job],
  );
  /** Buy-confirm sheet (the buy loop). Checking a row off opens this to place
   *  the item into the pantry (location + qty) before it leaves the list. */
  const [buying, setBuying] = useState<{ name: string; qty: string } | null>(null);
  /** Shop view grouping: by shelf category (default) or by store tag (note 3). */
  /** How the list is grouped. 'none' (a flat list) is the default; by store, or
   *  by the recipe that asked for each item. Persisted so it stays where you
   *  leave it. Store grouping earns its keep on Staples; recipe grouping only
   *  makes sense on Active, where the rows actually come from recipes. */
  type GroupBy = 'none' | 'store' | 'recipe';
  const GROUP_KEY = 'stock:shopping-group-by';
  const [groupBy, setGroupByState] = useState<GroupBy>(() => {
    if (typeof window === 'undefined') return 'none';
    try {
      const v = window.localStorage?.getItem(GROUP_KEY);
      return v === 'store' || v === 'recipe' ? v : 'none';
    } catch {
      return 'none';
    }
  });
  const setGroupBy = (v: GroupBy) => {
    setGroupByState(v);
    try {
      window.localStorage?.setItem(GROUP_KEY, v);
    } catch {
      /* ignore */
    }
  };
  /** Tapping an active mode turns it back off. */
  const toggleGroup = (v: Exclude<GroupBy, 'none'>) =>
    setGroupBy(groupBy === v ? 'none' : v);
  /** Bulk store assignment for the checked rows. */
  const [storeSheet, setStoreSheet] = useState(false);

  // First-run polarity hint (spec §5). Dismissed automatically the first time
  // the user toggles any row — the action teaches itself once performed.
  // localStorage-keyed so the dismissal survives reloads without needing the
  // async IndexedDB store.
  const ONBOARDING_KEY = 'stock:shopping-onboarding-seen';
  const [showOnboard, setShowOnboard] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage?.getItem(ONBOARDING_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const dismissOnboard = () => {
    setShowOnboard(false);
    try {
      window.localStorage?.setItem(ONBOARDING_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  // Wide-viewport 2-col layout (spec §5 shopping list). ≥ 1024 px puts the
  // buy list + extras on the left and the Already-have / pantry-stub on the
  // right; below that, classic single-column stack.
  const { width: viewportWidth } = useWindowDimensions();
  const wide = viewportWidth >= 1024;

  // Consolidate the shopping list from plan → meals → dishes → recipes
  // (Phase B model). Every recipe dish in an in-scope, planned meal contributes
  // its ingredients; the downstream consolidation is unchanged.
  const weekRecipes = useMemo(() => {
    const keys = new Set(weekDays(weekStart).map(dateKey));
    const byId = new Map<string, Recipe>(recipes.map((r) => [r.id, r]));
    const out: Recipe[] = [];
    for (const m of planMeals) {
      const inScope = selectedEntryIds
        ? selectedEntryIds.has(m.id)
        : keys.has(dateKey(m.date));
      if (!inScope || (m.status ?? 'planned') !== 'planned') continue;
      for (const d of m.dishes) {
        if (!d.recipeId) continue;
        const r = byId.get(d.recipeId);
        if (r) out.push(r);
      }
    }
    return out;
  }, [planMeals, recipes, weekStart, selectedEntryIds]);

  // Render the local merge instantly, then upgrade with Claude's fuzzier
  // estimate when it resolves (graceful — consolidateSmart self-falls-back).
  //
  // STABILITY: the Claude consolidation is non-deterministic, and the web AI
  // cache is session-only — so on every reload it re-ran and could RENAME items
  // ("scallions"→"green onions", split a merged line…). Every exclusion here is
  // keyed by item NAME (checked / pushed / suppressed), so a rename made handled
  // items reappear as "new" rows — the "groceries I already ordered are back"
  // bug. Fix: persist the consolidation keyed by a signature of the plan, and
  // reuse it while the plan is unchanged, so names stay put across reloads and
  // exclusions keep matching. A real plan change (new signature) re-consolidates.
  const [items, setItems] = useState<ShoppingLine[]>([]);
  const [refining, setRefining] = useState(false);
  const planSig = useMemo(
    () =>
      weekRecipes
        .map((r) => `${r.id}:${new Date(r.modifiedAt).getTime()}`)
        .sort()
        .join('|'),
    [weekRecipes],
  );
  useEffect(() => {
    let cancelled = false;
    setItems(consolidateLocalSmart(weekRecipes));
    if (weekRecipes.length === 0) {
      setRefining(false);
      void webPersist.save('shop-consolidation', { sig: planSig, items: [] });
      return;
    }
    setRefining(true);
    void (async () => {
      // Same plan as last time → reuse the frozen result; do NOT re-run Claude
      // (that's what churned the names). Only re-consolidate when the plan changed.
      const cached = await webPersist.load<{ sig: string; items: ShoppingLine[] }>(
        'shop-consolidation',
      );
      if (!cancelled && cached && cached.sig === planSig && cached.items.length) {
        setItems(cached.items);
        setRefining(false);
        return;
      }
      try {
        const r = await consolidateSmart(weekRecipes);
        if (cancelled) return;
        setItems(r);
        void webPersist.save('shop-consolidation', { sig: planSig, items: r });
      } catch {
        /* keep the local merge already shown */
      } finally {
        if (!cancelled) setRefining(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSig]);

  // Cart-combine review (note 5) — DISTINCT from the Cook combine timeline.
  // The consolidation groups the SAME ingredient from several recipes into one
  // buy line; rather than trust that silently, surface each multi-recipe group
  // for a one-at-a-time decision: Combine (default) / Keep separate / Edit qty.
  /** Combining is MANUAL now (check rows → Combine) plus a non-blocking
   *  suggestion at the bottom. The old "Combine duplicates?" modal is gone: it
   *  interrupted, it re-asked, and it asked about the wrong things.
   *
   *  `merges` (alias matchKey → target matchKey) is the persisted rule; `combine`
   *  now just records which suggestions you've dismissed. */
  const mergesMap = useShopMetaStore((s) => s.merges);
  const mergeInto = useShopMetaStore((s) => s.mergeInto);
  const unmerge = useShopMetaStore((s) => s.unmerge);
  const combineMap = useShopMetaStore((s) => s.combine);
  const setCombine = useShopMetaStore((s) => s.setCombine);

  // Suppressed (deleted plan-derived) items are filtered here — the single
  // consolidation funnel every path reads from — so a delete survives regen
  // (note 7a). Session `dismissed` still handles same-run pantry-restock drops.
  const visibleItems = useMemo(
    () =>
      items.filter((i) => !dismissed.has(`item:${i.name}`) && !isSuppressed(i.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, dismissed, suppressedMap],
  );

  /** Should this canonical name appear in the Already-have bucket? True if
   *  the user marked it this run OR they've pinned it (or its base staple) as
   *  "always have" — via the ONE canonical isAlwaysHave predicate, so "Salt" /
   *  "salt" / "kosher salt" all resolve to a single pinned staple across every
   *  path. Pantry-status 'low'/'out' overrides everything else — a staple you
   *  flagged running-low or out is auto-promoted to the buy list even if it's
   *  an always-have, because "always have" stops being true the moment you
   *  flag it (spec §5 × §10). 'out' also locks the have toggle; 'low' stays
   *  togglable so you can drop it if you've got enough. */
  /** Is this name off the Active list?
   *
   *  A staple NEVER appears on Active — not even when it runs low. Running low
   *  is what makes a staple worth buying, so it surfaces inside the STAPLES
   *  list (flagged low/out, sorted to the top), which is the staples shopping
   *  list. Active stays the "get this now" list and is never invaded.
   *
   *  Low/out still auto-surfaces NON-staple pantry items onto Active — that's
   *  the ordinary restock path. */
  /** Staples you keep in the PANTRY. The always-have pin and pantry `isStaple`
   *  were two disconnected stores: pinning created a pantry item (one direction),
   *  but a pantry staple you already owned still landed on the buy list — which
   *  is why salt and black pepper showed up in Active and then got combined.
   *  Read BOTH stores, so "staple" means the same thing everywhere. */
  const pantryStapleKeys = useMemo(
    () =>
      new Set(
        pantryItems.filter((p) => p.isStaple).map((p) => matchKey(p.canonicalName)),
      ),
    [pantryItems],
  );
  const isPantryStaple = (name: string) => {
    const k = matchKey(name);
    if (pantryStapleKeys.has(k)) return true;
    const b = baseIngredient(name);
    for (const key of pantryStapleKeys) {
      if (key.startsWith(k) || k.startsWith(key)) return true;
      if (baseIngredient(key) === b) return true;
    }
    return false;
  };

  const inHave = (name: string) => {
    // A staple never appears on Active — whether it's pinned always-have on the
    // list, or simply a staple sitting in your pantry.
    if (isAlwaysHave(name, alwaysHaveMap) || isPantryStaple(name)) return true;
    const ps = statusFor(name);
    if (ps === 'out' || ps === 'low') return false; // non-staple restock → Active
    return isMarked(haveChecked, name);
  };

  /**
   * The ONE way to move an item to Staples / back to Active. "Staple" lives in
   * TWO stores — the always-have pin and the pantry's `isStaple` — so both ends
   * have to move together, or the item is half-in / half-out.
   */
  const pinStaple = (name: string, on: boolean) => {
    setAlways(name, on);

    if (!on) {
      // Removing a staple has to clear the PANTRY flag too. Clearing only the
      // pin left `isStaple` set, so the item was still a staple in the other
      // store and the row never left the list — "Remove didn't work".
      // Once it's cleared, it's an ordinary item again: if it's low/out it
      // surfaces on Active as a normal restock line, which is right.
      for (const p of pantryItems) {
        if (p.isStaple && looksLikeSameItem(p.canonicalName, name)) {
          void toggleStaple(p.id);
        }
      }
      return;
    }

    // Marking something "always have" makes it a pantry staple — so put it IN
    // the pantry if it isn't there already.
    //
    // Only create when absent: applyPaste on an existing item records a PURCHASE
    // (extends purchaseHistory, refreshes the restock cycle), and declaring
    // something a staple isn't the same as buying it. If it IS already there but
    // isn't flagged a staple, just flip the flag.
    const existing = pantryItems.find((p) =>
      looksLikeSameItem(p.canonicalName, name),
    );
    if (!existing) {
      void applyPaste([{ canonicalName: name, isStaple: true }]);
    } else if (!existing.isStaple) {
      void toggleStaple(existing.id);
    }
  };

  /** Multi-select (matchKey-normalized so "kosher salt" / "salt" collapse). */
  const isSelected = (name: string) => selected.has(matchKey(name));
  const toggleSelect = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = matchKey(name);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  /** Names the user pushed to a channel in the last 24h — dropped from the
   *  active list, parked in the collapsed "Pushed" section. */
  const pushedSet = useMemo(
    () => new Set(pushedItems.map((e) => e.key)),
    [pushedItems],
  );
  /**
   * Was this name pushed? Matched LOOSELY, the same way the pantry matches.
   * Exact keys don't work: the list says "shallot" but the cart got "shallots",
   * "basil leaves" vs "basil", "ripe tomatoes" vs "tomatoes" — so pushed items
   * kept sitting on the list. Prefix covers shallot/shallots and basil leaves/
   * basil; head-noun covers ripe tomatoes/tomatoes and cooked chickpeas/chickpeas.
   */
  const wasPushed = (name: string): boolean => {
    const k = matchKey(name);
    if (pushedSet.has(k)) return true;
    const b = baseIngredient(name);
    for (const key of pushedSet) {
      if (key.startsWith(k) || k.startsWith(key)) return true;
      if (baseIngredient(key) === b) return true;
    }
    return false;
  };

  /** Pantry restock rows: items you've flagged low/out in the pantry that no
   *  planned-recipe row or extra already covers. Surfaced as their own buy
   *  lines so flagging a staple low/out always lands it on the shopping list,
   *  recipe or not — the user's "I'm running low on salt → put it on my list"
   *  (spec §10). Recipe-listed staples are promoted in-place via inHave above,
   *  so they're filtered out here to avoid a duplicate row. */
  const pantryRestockLines = useMemo<ShoppingLine[]>(() => {
    const flagged = pantryItems.filter(
      (p) => p.status === 'low' || p.status === 'out',
    );
    if (flagged.length === 0) return [];
    const covered = new Set<string>();
    for (const i of visibleItems) covered.add(matchKey(i.name));
    for (const e of extras) covered.add(matchKey(e.canonicalName));
    const isCovered = (k: string) => {
      if (covered.has(k)) return true;
      for (const c of covered) if (c.startsWith(k) || k.startsWith(c)) return true;
      return false;
    };
    const seen = new Set<string>();
    const out: ShoppingLine[] = [];
    for (const p of flagged) {
      const k = matchKey(p.canonicalName);
      if (seen.has(k) || isCovered(k)) continue;
      seen.add(k);
      out.push({
        name: p.canonicalName,
        category: categorizeIngredient(p.canonicalName),
        // 'as needed' renders cleanly on the row and is omitted from the
        // Instacart copy text (no quantity known for a restock).
        buy: 'as needed',
        math: '',
        sources: [],
        confidence: 'summed' as const,
      });
    }
    return out;
  }, [pantryItems, visibleItems, extras]);

  /** Lines actually destined for the cart — everything visible (consolidated
   *  + extras + pantry restocks) minus what's routed to Already-have. Both the
   *  Copy-for-Instacart text and the "To buy" counter read from this list, so
   *  they always agree. */
  const buyLines = useMemo<ShoppingLine[]>(() => {
    const fromItems = visibleItems.filter((i) => !inHave(i.name));
    const fromExtras: ShoppingLine[] = extras
      .filter((e) => isDeliberateExtra(e.originId) || !inHave(e.canonicalName))
      .map((e) => ({
        name: e.canonicalName,
        category: categorizeIngredient(e.canonicalName),
        buy: extraQty(e),
        math: '',
        sources: [],
        confidence: 'summed' as const,
      }));
    const fromPantry = pantryRestockLines.filter(
      (p) => !dismissed.has(`item:${p.name}`),
    );
    return [...fromItems, ...fromExtras, ...fromPantry];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, haveChecked, alwaysHaveMap, pantryRestockLines, dismissed]);

  /** The active list, folded flat (minimalist, Reminders-style). Recipe items,
   *  manual adds, and low/out restock staples in one ordered list — no category
   *  or store sections. Items marked "have" (swiped right) or pushed in the last
   *  24h drop out. `name`/`qty` reflect any inline-edit override; `baseName`
   *  is the stable key the override + selection hang off. */
  type FlatRow = {
    key: string;
    /** Display name (post inline-edit override). */
    name: string;
    /** Original name — stable key for overrides/selection/push. */
    baseName: string;
    qty: string;
    extraId: string | null;
    origin?: string | null;
    pantryStatus?: PantryStatus;
    kind: 'recipe' | 'extra' | 'restock';
    /** Which recipes asked for this — drives the group-by-recipe view. Empty for
     *  things you added by hand. */
    recipes?: string[];
    /** Set when this row is a manual merge — the rows folded into it. Delete
     *  removes them all; the long-press sheet offers to split them back out. */
    members?: FlatRow[];
  };
  /** Recipe titles an extra is for. New plan-wizard items carry a structured
   *  `recipes` array; older ones only have the "for A · B" origin label, so parse
   *  that as a fallback. Manual / pipeline adds have neither → no recipes. */
  const recipesForExtra = (ex: {
    recipes?: string[];
    originLabel: string | null;
  }): string[] => {
    if (ex.recipes?.length) return ex.recipes;
    const l = ex.originLabel ?? '';
    if (l.startsWith('for ')) {
      return l.slice(4).split(' · ').map((s) => s.trim()).filter(Boolean);
    }
    return [];
  };
  /**
   * Which list does a hand-added row live on? New adds record it on the extra
   * itself (MANUAL_ACTIVE / MANUAL_STAPLE). Rows written before that split carry
   * a null origin, so they fall back to the OLD rule — a staple pin meant
   * Staples — and nothing jumps views on upgrade. Returns null for rows that
   * weren't added by hand.
   */
  const manualHome = (ex: {
    originId: string | null;
    canonicalName: string;
  }): 'active' | 'staples' | null => {
    if (ex.originId === MANUAL_STAPLE) return 'staples';
    if (ex.originId === MANUAL_ACTIVE) return 'active';
    if (ex.originId == null)
      return isAlwaysHave(ex.canonicalName, alwaysHaveMap) ? 'staples' : 'active';
    return null;
  };

  const allRows = useMemo<FlatRow[]>(() => {
    // MATERIALIZED LIST (PLAN-SHOP-FLOW.md phase 4). Active is no longer
    // live-derived from the week's planned recipes — that was the source of the
    // whole "items reappear / delete doesn't stick" class (a name-keyed
    // suppression fighting a re-derivation that renamed items). The list is now
    // just the EXTRAS store: concrete rows with stable ids, written by the
    // "Build shopping list" wizard (its combined shop-for items) and by manual
    // "+ Add". Delete removes a row by id (removeExtra) — nothing regenerates it.
    //
    // Pantry restocks still surface in STAPLES (stapleRows), unchanged. The push
    // surface reads from these rows, so it's unaffected.
    const rows: FlatRow[] = [];
    const gone = (base: string) => inHave(base) || wasPushed(base);
    for (const ex of extras) {
      // In-flight items (pushed to Wegmans/Costco, agent still filling) leave
      // Active immediately for the collapsed "Pending" folder — they only land
      // in "Pushed" once the fill completes.
      if (pendingKeys.has(matchKey(ex.canonicalName))) continue;
      // Plan-wizard items ALWAYS live on Active, never Staples — even if the
      // item is a pantry staple. You put it on your shopping list on purpose;
      // it only leaves once you buy it or push it. (Nate: "anything generated
      // from the plan wizard needs to end up in Active. Never Staples.")
      const fromWizard = ex.originId === PLAN_WIZARD;
      const home = manualHome(ex);
      // Added by hand while on Staples → it belongs over there, not here.
      if (home === 'staples') continue;
      // Wizard items and manual adds are both DELIBERATE — you put them on this
      // list on purpose. They leave only when you check them off or push them.
      // Nothing automatic may hide them: not an always-have pin, not a pantry
      // `isStaple` flag, not a check-off left over from a previous shop. That
      // last one was the bug — `checked` is permanent, so a name Nate had ever
      // bought before (pine nuts) was swallowed the instant he re-added it.
      //
      // A staple pin still hides a NON-manual, non-wizard row from Active; that
      // IS "Move to Staples".
      const drop =
        fromWizard || home === 'active'
          ? wasPushed(ex.canonicalName) || isMarked(haveChecked, ex.canonicalName)
          : gone(ex.canonicalName);
      if (drop) continue;
      rows.push({
        key: `e:${ex.id}`,
        name: ex.canonicalName,
        baseName: ex.canonicalName,
        qty: extraQty(ex),
        extraId: ex.id,
        origin: ex.originLabel,
        pantryStatus: statusFor(ex.canonicalName),
        kind: 'extra',
        recipes: recipesForExtra(ex),
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extras, overrides, pushedSet, pendingKeys, haveChecked, alwaysHaveMap, statusByKey, shopMetaMap]);

  /** Active = the dominant "get this now" list, with manual merges folded in. */
  const activeRows = useMemo(() => {
    const groups = new Map<string, FlatRow[]>();
    for (const r of allRows) {
      const k = mergesMap[matchKey(r.baseName)] ?? matchKey(r.baseName);
      const g = groups.get(k);
      if (g) g.push(r);
      else groups.set(k, [r]);
    }
    const out: FlatRow[] = [];
    for (const [k, group] of groups) {
      if (group.length === 1) {
        out.push(group[0]!);
        continue;
      }
      // The merge target keeps its name; if it isn't on the list this week, fall
      // back to the simplest name in the group (Nate's rule).
      const target =
        group.find((r) => matchKey(r.baseName) === k) ?? simplestRow(group);
      out.push({
        ...target,
        key: `m:${k}`,
        qty: sumQtyStrings(group.map((r) => r.qty)),
        // A merged row belongs to every recipe its members came from.
        recipes: [...new Set(group.flatMap((r) => r.recipes ?? []))],
        members: group,
      });
    }
    return out;
  }, [allRows, mergesMap]);

  /**
   * One non-blocking suggestion at a time: two rows on the list that look like
   * the same thing ("shallot" + "shallots", "tomatoes" + "ripe tomatoes").
   * Dismissals persist, so it won't nag about the same pair twice.
   */
  const suggestion = useMemo(() => {
    for (let i = 0; i < activeRows.length; i++) {
      for (let j = i + 1; j < activeRows.length; j++) {
        const a = activeRows[i]!;
        const b = activeRows[j]!;
        if (!looksLikeSameItem(a.baseName, b.baseName)) continue;
        const sig = [matchKey(a.baseName), matchKey(b.baseName)].sort().join('~');
        if (combineMap[sig]) continue; // already dismissed
        return { a, b, sig };
      }
    }
    return null;
  }, [activeRows, combineMap]);

  /** Tag every checked row with a store in one go — tagging a staples list one
   *  long-press at a time is miserable, and sort-by-store is useless untagged. */
  const assignStoreToSelected = (store: StoreId | null) => {
    for (const row of selectedRows) setShopMeta(row.baseName, { store });
    setStoreSheet(false);
    clearSelection();
  };

  /** Merge the checked rows into one. Shortest/simplest name wins. */
  const combineSelected = () => {
    if (selectedRows.length < 2) return;
    const target = simplestRow(selectedRows);
    mergeInto(
      matchKey(target.baseName),
      selectedRows.map((r) => matchKey(r.baseName)),
    );
    clearSelection();
  };
  const acceptSuggestion = () => {
    if (!suggestion) return;
    const target = simplestRow([suggestion.a, suggestion.b]);
    mergeInto(matchKey(target.baseName), [
      matchKey(suggestion.a.baseName),
      matchKey(suggestion.b.baseName),
    ]);
    setCombine(suggestion.sig, 'combine');
  };
  const dismissSuggestion = () => {
    if (suggestion) setCombine(suggestion.sig, 'separate');
  };

  /** Staples = the tucked-away pile you toggle to. "We need pine nuts — but not
   *  soon." Pinning an item (long-press) parks it here, out of Active, for as
   *  long as it needs; the pin persists (always-have, IndexedDB).
   *
   *  This is ALSO the staples shopping list: when a staple runs low/out it does
   *  NOT jump to Active — it surfaces right here, flagged low/out and sorted to
   *  the top, because that's what makes it worth buying. */
  const stapleRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    // An item lives in exactly ONE view.
    const onActive = new Set(activeRows.map((r) => matchKey(r.baseName)));

    // The Staples shopping list is what you NEED TO BUY, not a mirror of what's
    // pinned or what's in the pantry.
    //
    //  - Pantry = everything you currently have.
    //  - "Always have" is a PANTRY property (pinStaple puts it in the pantry as
    //    a staple). Marking it does NOT put it on this list — you just said you
    //    have it.
    //  - A staple lands here ONLY when it runs low/out, i.e. there's actually
    //    something to buy. Have plenty → it stays in the pantry, off this list.
    //
    // Both sources (the always-have pin and the pantry's own isStaple) collapse
    // to the same rule: show it only when it's low/out.
    const pinnedKeys = new Set(
      Object.keys(alwaysHaveMap).filter((k) => alwaysHaveMap[k]),
    );
    const pantryKeys = pantryItems.map((p) => matchKey(p.canonicalName));
    // Anything you added directly to this list is an EXTRA — include its key
    // even if it isn't pinned/in the pantry, so a hand-added staple is never
    // dropped for lack of a pin.
    const extraKeys = extras.map((e) => matchKey(e.canonicalName));
    // Plan-wizard items never belong on Staples — they're forced onto Active.
    const wizardKeys = new Set(
      extras.filter((e) => e.originId === PLAN_WIZARD).map((e) => matchKey(e.canonicalName)),
    );
    // Added by hand WHILE ON STAPLES. Unconditional residents: no pantry status,
    // no missing pin, and no already-on-Active collision gets to drop them.
    const manualStapleKeys = new Set(
      extras
        .filter((e) => manualHome(e) === 'staples')
        .map((e) => matchKey(e.canonicalName)),
    );
    // Added by hand while on ACTIVE — those live over there, never here.
    const manualActiveKeys = new Set(
      extras
        .filter((e) => manualHome(e) === 'active')
        .map((e) => matchKey(e.canonicalName)),
    );
    // Extras first, in the order they were typed — the list should read like the
    // order you built it, not like a dictionary.
    const stapleKeys = new Set<string>([...extraKeys, ...pantryKeys, ...pinnedKeys]);
    for (const key of stapleKeys) {
      if (wizardKeys.has(key) || manualActiveKeys.has(key)) continue;
      const manual = manualStapleKeys.has(key);
      if (wasPushed(key)) continue;
      if (!manual && onActive.has(key)) continue;
      const ex = extras.find((e) => matchKey(e.canonicalName) === key);
      const it = visibleItems.find((i) => matchKey(i.name) === key);
      const pan = pantryItems.find((p) => matchKey(p.canonicalName) === key);
      const base = ex?.canonicalName ?? it?.name ?? pan?.canonicalName ?? key;
      // Bought/checked → it's handled, drop it (same as elsewhere).
      if (isMarked(haveChecked, base)) continue;
      // A manually-added item (an EXTRA you put on this list) STAYS regardless of
      // stock status — you explicitly added it. A pantry-derived staple only
      // shows when it's actually low/out (else it's just stuff you already have).
      const st = statusFor(key);
      if (!ex && st !== 'low' && st !== 'out') continue;
      const o = overrides[matchKey(base)];
      rows.push({
        key: `s:${key}`,
        name: o?.name || base.charAt(0).toUpperCase() + base.slice(1),
        baseName: base,
        qty: o?.qty ?? (ex ? extraQty(ex) : (it?.buy ?? '')),
        extraId: ex?.id ?? null,
        pantryStatus: statusFor(base),
        kind: ex ? 'extra' : 'recipe',
      });
    }
    // Needs-buying first (out, then low) so what you're actually out of isn't
    // buried. Within a rank the order is the order things arrived — sort() is
    // stable, so no alphabetical tiebreak. (Nate: the A-Z shuffle just moved
    // rows around under him for no reason.)
    const rank = (s?: PantryStatus) => (s === 'out' ? 0 : s === 'low' ? 1 : 2);
    return rows.sort((a, b) => rank(a.pantryStatus) - rank(b.pantryStatus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysHaveMap, extras, visibleItems, overrides, pushedSet, statusByKey, activeRows, pantryItems]);


  /** Rows for whichever view you're on; selection + push read from these. */
  const currentRows = listView === 'active' ? activeRows : stapleRows;

  /**
   * Rows bucketed by the recipe (from the plan) that asked for them — "what do I
   * need for the tofu?". Three kinds of bucket, in order:
   *   - one bucket per recipe, for items exactly ONE recipe needs (alpha order);
   *   - a single "Multiple" bucket for items 2+ recipes share (lemon, broccoli)
   *     — they buy once, so listing them under every recipe was noise;
   *   - "Added by me" for one-off manual/pipeline adds (no recipe).
   * Selection is keyed by item, so checking anywhere checks everywhere.
   */
  const recipeGroups = useMemo(() => {
    if (groupBy !== 'recipe' || listView !== 'active') return null;
    const byRecipe = new Map<string, FlatRow[]>();
    const multiple: FlatRow[] = [];
    const loose: FlatRow[] = [];
    for (const r of currentRows) {
      const names = r.recipes ?? [];
      if (names.length === 0) loose.push(r);
      else if (names.length === 1) {
        const n = names[0]!;
        const g = byRecipe.get(n);
        if (g) g.push(r);
        else byRecipe.set(n, [r]);
      } else {
        multiple.push(r);
      }
    }
    const out = [...byRecipe.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, rows]) => ({ label, rows }));
    if (multiple.length > 0) out.push({ label: 'Multiple', rows: multiple });
    if (loose.length > 0) out.push({ label: 'Added by me', rows: loose });
    return out;
  }, [groupBy, listView, currentRows]);

  /** Rows bucketed by store tag — only when sort-by-store is on. */
  const storeGroups = useMemo(() => {
    if (groupBy !== 'store') return null;
    const buckets: { id: StoreId | null; label: string; rows: FlatRow[] }[] = [
      ...STORES.map((s) => ({
        id: s.id as StoreId | null,
        label: s.label,
        rows: [] as FlatRow[],
      })),
      { id: null as StoreId | null, label: 'Unassigned', rows: [] as FlatRow[] },
    ];
    for (const r of currentRows) {
      const st = metaFor(r.baseName).store ?? null;
      const b = buckets.find((x) => x.id === st) ?? buckets[buckets.length - 1]!;
      b.rows.push(r);
    }
    return buckets.filter((b) => b.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, currentRows, shopMetaMap]);


  /** The current selection, resolved to rows (drives the pop-up push bar). */
  const selectedRows = useMemo(
    () => currentRows.filter((r) => selected.has(matchKey(r.baseName))),
    [currentRows, selected],
  );
  const allSelected =
    currentRows.length > 0 &&
    currentRows.every((r) => selected.has(matchKey(r.baseName)));

  /** A push label per row: "Name, qty" (qty omitted when 'as needed'/blank). */
  const rowLabel = (r: FlatRow) => {
    const q = r.qty && r.qty !== 'as needed' ? r.qty : '';
    const base = r.name.charAt(0).toUpperCase() + r.name.slice(1);
    return q ? `${base}, ${q}` : base;
  };
  const text = useMemo(
    () =>
      instacartText(
        selectedRows.map((r) => ({
          name: r.name,
          category: categorizeIngredient(r.name),
          buy: r.qty,
          math: '',
          sources: [],
          confidence: 'summed' as const,
        })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedRows],
  );

  // Fulfillment routing (note 4). Store tag = channel: Wegmans → Instacart /
  // Beelink (external, not wired from the app — items just group under
  // Wegmans); everything NOT tagged Wegmans (Stop One + Costco + unassigned)
  // → the Apple Reminders list "Shared Groceries" via the installed Shortcut.
  // Push the SELECTED rows to the Apple Reminders list "Shared Groceries" via
  // the installed Shortcut, then park them in the Pushed section and clear the
  // selection. iOS-only (the shortcuts:// scheme no-ops on desktop).
  const pushToReminders = async () => {
    const rows = selectedRows;
    const url = remindersDeepLink(rows.map(rowLabel));
    if (!url) {
      setHint('Select some items first.');
      return;
    }
    try {
      if (Platform.OS === 'web') window.location.href = url;
      else await Linking.openURL(url);
      setHint(
        `Sent ${rows.length} to the "${REMINDERS_SHORTCUT}" Shortcut → Reminders "Shared Groceries."`,
      );
      pushToPushed(rows.map((r) => r.baseName), 'reminders');
      clearSelection();
    } catch {
      setHint(`Install the "${REMINDERS_SHORTCUT}" Shortcut first — see SHORTCUTS.md.`);
    }
  };

  /** Always-have names NOT already represented by a row in the week's plan
   *  or extras. We surface these as ghost rows in the Already-have bucket
   *  so the user can verify the pinned set and remove pins from items the
   *  current week doesn't touch. */
  const ghostAlways = useMemo(() => {
    const seen = new Set<string>();
    for (const i of visibleItems) seen.add(i.name.toLowerCase().trim());
    for (const e of extras) seen.add(e.canonicalName.toLowerCase().trim());
    return Object.keys(alwaysHaveMap)
      .filter((k) => !seen.has(k) && statusFor(k) === undefined)
      .sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, alwaysHaveMap, statusByKey]);

  const haveCount = useMemo(() => {
    let n = ghostAlways.length;
    for (const i of visibleItems) if (inHave(i.name)) n++;
    for (const e of extras)
      if (!isDeliberateExtra(e.originId) && inHave(e.canonicalName)) n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, haveChecked, alwaysHaveMap, ghostAlways]);

  const buyCount = buyLines.length;

  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleHave = (name: string) => {
    if (isMarked(haveChecked, name)) {
      unmarkHave(name);
    } else {
      markHave(name);
      // Same reason as skipBuy: a low/out flag outranks the check-off, so
      // without this the row would strike through and then come straight back.
      void clearLowOut(name);
    }
    // First toggle teaches the polarity — kill the onboarding banner the
    // moment the user has performed the action it describes.
    if (showOnboard) dismissOnboard();
  };

  /** Open the buy-confirm sheet for a row (checkbox / swipe-right on a buy
   *  row). Pre-fills the quantity from the line when it's a real amount. */
  const openBuy = (name: string) => {
    const line = buyLines.find((l) => l.name === name);
    const q = line && line.buy && line.buy !== 'as needed' ? line.buy : '';
    setBuying({ name, qty: q });
  };

  /** Confirm a buy: restock-merge it into the pantry at the chosen location,
   *  then drop it off the buy list (into Already-have). Closes the loop —
   *  bought → pantry → depletes → resurfaces on Shop. */
  const commitBuy = async (location: PantryLocation, qtyStr: string) => {
    if (!buying) return;
    const { amount, unit } = parseQty(qtyStr);
    await applyPaste([
      {
        canonicalName: buying.name,
        location,
        amount: amount ?? undefined,
        unit: unit ?? undefined,
      },
    ]);
    markHave(buying.name);
    if (showOnboard) dismissOnboard();
    setBuying(null);
  };

  /**
   * "Already had it": clear the row without restocking the pantry.
   *
   * A low/out pantry flag outranks the check-off in `inHave` (that's the
   * depletion loop that legitimately brings things back). But saying "I already
   * have it" contradicts that flag — so clear it, or the row is un-check-off-able
   * and reappears on the very next render.
   */
  const skipBuy = () => {
    if (!buying) return;
    markHave(buying.name);
    void clearLowOut(buying.name);
    if (showOnboard) dismissOnboard();
    setBuying(null);
  };

  /** Reset any low/out pantry flag matching this shopping-list name back to fine. */
  const clearLowOut = async (name: string) => {
    const k = matchKey(name);
    for (const p of pantryItems) {
      const s = p.status ?? 'fine';
      if (s !== 'low' && s !== 'out') continue;
      const pk = matchKey(p.canonicalName);
      if (pk === k || pk.startsWith(k) || k.startsWith(pk)) {
        await setPantryStatus(p.id, 'fine');
      }
    }
  };

  // Pushed-row actions. RESTORE just drops the pushed marker so the item returns
  // to Active (its extra stays). CLEAR = delete it for good — also remove the
  // underlying extra, else dropping the marker bounces it right back onto Active
  // (that was the "Clear moved it back to the list" bug).
  const deletePushedItem = (key: string) => {
    const ex = extras.find((e) => matchKey(e.canonicalName) === key);
    if (ex) removeExtra(ex.id);
    restorePushed(key); // drop the pushed marker (extra already gone)
  };
  const clearAllPushed = () => {
    for (const e of pushedItems) {
      const ex = extras.find((x) => matchKey(x.canonicalName) === e.key);
      if (ex) removeExtra(ex.id);
    }
    clearPushed();
  };

  /** Dismiss a consolidated row for this run (session-local). */
  const dismissItem = (name: string) =>
    setDismissed((prev) => new Set(prev).add(`item:${name}`));

  /** Delete a plan-derived row: session-hide it AND suppress it so it stays
   *  gone across future plan → shopping regen (note 7a). */
  const deleteItem = (name: string) => {
    suppress(name);
    dismissItem(name);
  };

  /** Bulk "clear checked": remove every row the user checked off (marked have)
   *  this run. Extras go for good; plan-derived rows suppress (note 7). */
  const checkedNames = useMemo(() => {
    const out: { name: string; extraId: string | null }[] = [];
    for (const i of visibleItems)
      if (isMarked(haveChecked, i.name) && !isAlwaysHave(i.name, alwaysHaveMap))
        out.push({ name: i.name, extraId: null });
    for (const e of extras)
      if (isMarked(haveChecked, e.canonicalName) && !isAlwaysHave(e.canonicalName, alwaysHaveMap))
        out.push({ name: e.canonicalName, extraId: e.id });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, haveChecked, alwaysHaveMap]);
  const clearChecked = () => {
    for (const c of checkedNames) {
      if (c.extraId) removeExtra(c.extraId);
      else deleteItem(c.name);
    }
  };

  /** Inline-edit a recipe-derived line's quantity (session-local override —
   *  `buy` is already a free-form string, so no reparse needed). */
  const editItemQty = (name: string, qty: string) =>
    setItems((prev) => prev.map((i) => (i.name === name ? { ...i, buy: qty } : i)));

  /**
   * Add a manual item to the list (spec §10).
   *
   * A manual add is absolute. What you type lands on whichever list you're
   * looking at and STAYS there until you check it off, push it, or delete it.
   * So every piece of sticky state that could silently swallow the new row is
   * cleared first:
   *   - the PERMANENT check-off in have.ts (`checked`) — this was the bug: it
   *     never expires, so any name Nate had bought once before was dropped the
   *     instant he re-added it ("I can't add pine nuts");
   *   - a pushed marker, matched as loosely as `wasPushed` hides things;
   *   - a plan-row suppression and this run's session dismissal.
   */
  const submitAdd = () => {
    const name = addName.trim();
    if (!name) return;
    const { amount, unit } = parseQty(addQty);
    const toStaples = listView === 'staples';

    unmarkHave(name);
    unsuppress(name);
    const k = matchKey(name);
    const b = baseIngredient(name);
    for (const p of pushedItems) {
      if (!p.key) continue;
      if (p.key === k || p.key.startsWith(k) || k.startsWith(p.key) || baseIngredient(p.key) === b)
        restorePushed(p.key);
    }
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(`item:${name}`);
      return next;
    });

    addExtra([
      {
        canonicalName: name,
        amount,
        unit,
        originLabel: 'added by you',
        originId: toStaples ? MANUAL_STAPLE : MANUAL_ACTIVE,
      },
    ]);
    // Which list it lives on is the extra's own origin now, not a side effect of
    // the staple pin. Adding on Staples still marks it always-have (that's what
    // a staple IS in the pantry); adding on Active no longer needs to un-pin
    // anything, because a pin can't hide a manual row any more.
    if (toStaples) pinStaple(name, true);
    setAddName('');
    setAddQty('');
  };

  /** Delete ONE row. A merged row deletes every row folded into it, or you'd
   *  delete the visible line and its members would pop straight back out.
   *  On Staples, "delete" means "don't need to buy now" (clears the low/out
   *  flag, stays a staple); extras go for good, restock rows drop for the run,
   *  plan rows suppress so they stay gone across regen. */
  const deleteRow = (row: FlatRow) => {
    if (listView === 'staples') {
      // A hand-added staple is an extra — delete actually removes it.
      if (row.extraId) {
        removeExtra(row.extraId);
        return;
      }
      // For a pantry-derived staple, deleting means "handled it / don't need to
      // buy now" — NOT "stop being a staple". It appears here only when low/out,
      // so clear that flag: it leaves the buy list and stays a pantry staple
      // (off Active, because inHave keeps staples off Active).
      //
      // This used to call pinStaple(false), which un-pinned the item — and an
      // un-pinned item the week's recipes still need bounced straight back onto
      // Active. That was the "I delete it from Staples and it reappears in
      // Active" loop. To genuinely un-staple something, use "Remove always have"
      // in the long-press menu.
      void clearLowOut(row.baseName);
      return;
    }
    if (row.members) {
      unmerge(matchKey(row.baseName));
      for (const m of row.members) deleteRow(m);
      return;
    }
    if (row.extraId) removeExtra(row.extraId);
    else if (row.kind === 'restock') dismissItem(row.baseName);
    else deleteItem(row.baseName);
  };
  const deleteSelected = () => {
    for (const row of selectedRows) deleteRow(row);
    clearSelection();
  };

  /** Switch Active/Staples — clear the selection so it can't leak across views. */
  const switchView = (v: 'active' | 'staples') => {
    setListView(v);
    setSelected(new Set());
    setEditKey(null);
  };

  // Shortcut Instacart path (spec §11 cross-app integrations — Developer
  // Platform path replaced with a copy-and-open until the API actually
  // accepts a key): copy the consolidated buy list to the clipboard, then
  // open Instacart so the user pastes the list into its Shopping List.
  //
  // Instacart's Shopping List (the bulk-paste surface) is iOS-app only —
  // there is NO web URL for it, so any https link either 404s or shows
  // Instacart's "something went wrong" page. So on iOS we deep-link into the
  // installed app via its custom scheme (lands on the app home; the user
  // taps Shopping List and pastes). On desktop web there's no app, so we
  // open the storefront — which at least never errors. The only way to skip
  // the manual paste entirely is the IDP "create shopping list page" API,
  // which needs a key we don't have yet.
  const INSTACART_APP = 'instacart://';
  const INSTACART_WEB = 'https://www.instacart.com';
  const isIOSWeb =
    typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const copyAndOpen = async () => {
    const clip =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as {
            clipboard?: { writeText(t: string): Promise<void> };
          }).clipboard
        : undefined;
    let didCopy = false;
    if (Platform.OS === 'web' && clip?.writeText) {
      try {
        await clip.writeText(text);
        didCopy = true;
      } catch {
        // Clipboard blocked (e.g. permissions) — fall through to reveal.
      }
    }
    if (!didCopy && Platform.OS !== 'web') {
      // Native v1 has no clipboard dep — reveal the selectable text so
      // the user can long-press copy before we punch out to Instacart.
      setRevealText(true);
    }
    // Open Instacart even if the copy failed — the user can paste from
    // the revealed text or re-tap once they grant clipboard access.
    if (Platform.OS === 'web') {
      if (isIOSWeb) {
        // Custom scheme launches the installed app. Navigating the PWA to it
        // backgrounds Stock and foregrounds Instacart; if the app isn't
        // installed iOS no-ops, so leave a hint either way.
        setHint('Opening Instacart — go to Shopping List and paste your list.');
        try {
          window.location.href = INSTACART_APP;
        } catch {
          setHint('Open the Instacart app, go to Shopping List, and paste.');
        }
      } else {
        try {
          window.open(INSTACART_WEB, '_blank', 'noopener');
        } catch {
          setHint(`Couldn't open Instacart — go to ${INSTACART_WEB}.`);
        }
      }
    } else {
      await Linking.openURL(INSTACART_APP).catch(() =>
        Linking.openURL(INSTACART_WEB).catch(() =>
          setHint('Open the Instacart app, go to Shopping List, and paste.')),
      );
    }
    if (didCopy) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Push the SELECTED rows to the Wegmans cart via the Instacart auto-fill agent
  // (queues a job the Beelink poller claims and fills the cart with; checkout
  // stays manual, Pickup). Requires sign-in — if not signed in, fall back to
  // Copy → Instacart (paste manually). On success the rows move to Pushed and
  // the selection clears.
  const pushToWegmans = async () => {
    const rows = selectedRows;
    if (rows.length === 0) return;
    if (!INSTACART_AVAILABLE()) {
      // No job to watch on this path, so settle up immediately.
      setHint('Not signed in — copying the list and opening Instacart to paste.');
      await copyAndOpen();
      pushToPushed(rows.map((r) => r.baseName), 'wegmans');
      clearSelection();
      return;
    }
    try {
      setSending(true);
      setJobResult(null);
      setHint('Pushing to your Wegmans cart…');
      const id = await sendToInstacart(
        toJobItems(
          rows.map((r) => ({
            name: r.name,
            category: categorizeIngredient(r.name),
            buy: r.qty,
            math: '',
            sources: [],
            confidence: 'summed' as const,
          })),
        ),
      );
      // Nothing is "pushed" yet — this only QUEUED a job. The Beelink agent
      // still has to drive a real browser, and it may not find everything.
      // Rows only leave the list once the agent confirms it added them (see the
      // poll effect); whatever it can't get STAYS, so it doesn't get silently
      // dropped and never bought.
      setJob({ id, status: 'queued', rows, retailer: 'wegmans' });
      // Background status banner (visible from any tab).
      startCartFill({ jobId: id, retailer: 'wegmans', total: rows.length, startedAtMs: Date.now() });
      setHint('Filling your Wegmans cart… this takes a minute.');
      clearSelection();
    } catch (e) {
      setHint(`Couldn't push: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  // ── Staples-section pushes (Amazon + Costco) ───────────────────────────────

  /**
   * Push to Amazon: open an Amazon search for each selected staple. Multiple
   * items → multiple tabs (Nate's ask). Fully client-side — no agent, no queue.
   * The window.open calls run synchronously inside this click handler, which is
   * what lets the browser open more than one tab (async opens get blocked).
   */
  const pushToAmazon = () => {
    const rows = selectedRows;
    if (rows.length === 0) {
      setHint('Select some staples first.');
      return;
    }
    const urls = rows.map(
      (r) => `https://www.amazon.com/s?k=${encodeURIComponent(r.name)}`,
    );
    const n = urls.length;
    if (Platform.OS === 'web') {
      let blocked = 0;
      for (const u of urls) {
        const w = window.open(u, '_blank', 'noopener');
        if (!w) blocked++;
      }
      setHint(
        blocked
          ? `Opened ${n - blocked} of ${n} — allow pop-ups for this site to open the rest.`
          : `Opened ${n} Amazon search${n === 1 ? '' : 'es'} in new tabs.`,
      );
    } else {
      urls.forEach((u) => void Linking.openURL(u));
      setHint(`Opened ${n} Amazon search${n === 1 ? '' : 'es'}.`);
    }
    pushToPushed(rows.map((r) => r.baseName), 'amazon');
    clearSelection();
  };

  /**
   * Push to Costco: same Instacart auto-fill pipeline as Wegmans, retailer
   * switched to Costco. The app side is complete; it needs the backend to honor
   * the `retailer` field — a `retailer` column on `instacart_jobs` AND the
   * Beelink instacart-agent taught to drive the Costco storefront. Until then
   * this errors cleanly (see sendToInstacart) rather than filling a Wegmans cart.
   */
  const pushToCostco = async () => {
    const rows = selectedRows;
    if (rows.length === 0) return;
    if (!INSTACART_AVAILABLE()) {
      setHint('Sign in to push to Costco.');
      return;
    }
    try {
      setSending(true);
      setJobResult(null);
      setHint('Pushing to your Costco cart…');
      const id = await sendToInstacart(
        toJobItems(
          rows.map((r) => ({
            name: r.name,
            category: categorizeIngredient(r.name),
            buy: r.qty,
            math: '',
            sources: [],
            confidence: 'summed' as const,
          })),
        ),
        'costco',
      );
      setJob({ id, status: 'queued', rows, retailer: 'costco' });
      startCartFill({ jobId: id, retailer: 'costco', total: rows.length, startedAtMs: Date.now() });
      setHint('Filling your Costco cart… this takes a minute.');
      clearSelection();
    } catch (e) {
      setHint(
        `Couldn't push to Costco: ${(e as Error).message}. (Costco needs the backend retailer setup — the Wegmans push is unaffected.)`,
      );
    } finally {
      setSending(false);
    }
  };

  /** Select every row in the current view / clear (the "Select all" toggle). */
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(currentRows.map((r) => matchKey(r.baseName))));

  /** Enter inline edit for a row (Reminders-style tap-to-edit). */
  const startEdit = (row: FlatRow) => {
    setEditKey(row.key);
    setEditName(row.name);
    setEditQty(row.qty === 'as needed' ? '' : row.qty);
  };
  const cancelEdit = () => setEditKey(null);
  /** The ONE way an item's name/qty gets written. Shared by the single-tap quick
   *  edit and the long-press sheet, so they can't drift apart. Extras write
   *  through to their store; recipe/restock rows keep a session override. */
  const saveRowEdit = (row: FlatRow, rawName: string, rawQty: string) => {
    const name = rawName.trim() || row.name;
    const qty = rawQty.trim();
    if (row.extraId) {
      const { amount, unit } = parseQty(qty);
      updateExtra(row.extraId, { canonicalName: name, amount, unit });
    } else {
      setOverrides((prev) => ({
        ...prev,
        [matchKey(row.baseName)]: { name, qty },
      }));
    }
  };
  const commitEdit = (row: FlatRow) => {
    saveRowEdit(row, editName, editQty);
    setEditKey(null);
  };

  /** One list row — shared by the Active list and the collapsed Costco pile, so
   *  a deferred row keeps the full behaviour (select, tap-to-edit, swipe,
   *  long-press options). Renders the inline editor when it's the row you tapped. */
  const renderRow = (row: FlatRow) =>
    editKey === row.key ? (
      // Inline edit (tap-to-edit). Enter or the check commits; tapping another
      // row abandons the in-progress edit.
      <View key={row.key} style={styles.editRow}>
        <TextInput
          value={editName}
          onChangeText={setEditName}
          autoFocus
          placeholder="Item name"
          placeholderTextColor={colors.textFaint}
          style={[styles.editInput, styles.editName]}
          onSubmitEditing={() => commitEdit(row)}
          returnKeyType="done"
        />
        <TextInput
          value={editQty}
          onChangeText={setEditQty}
          placeholder="Qty"
          placeholderTextColor={colors.textFaint}
          style={[styles.editInput, styles.editQtyInput]}
          onSubmitEditing={() => commitEdit(row)}
          returnKeyType="done"
        />
        <Pressable
          onPress={() => commitEdit(row)}
          hitSlop={8}
          style={styles.editSave}
          accessibilityRole="button"
          accessibilityLabel={`Save ${row.name}`}>
          <Glyph name="done" size={20} color="bg" />
        </Pressable>
      </View>
    ) : (
      <ShoppingRow
        key={row.key}
        name={row.name}
        qty={row.qty}
        math={null}
        origin={row.origin}
        onTap={() => startEdit(row)}
        onToggleHave={() => openBuy(row.baseName)}
        onCheck={() => toggleSelect(row.baseName)}
        checked={isSelected(row.baseName)}
        onDelete={() => deleteRow(row)}
        onLongPress={() => setMenu(row)}
        marked={false}
        always={false}
        likely={false}
        pantryStatus={row.pantryStatus}
      />
    );

  return (
    <SafeAreaView style={styles.root} edges={embedded ? [] : ['top']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Heading variant="screenTitle">Shopping list</Heading>
          <Text color="textMuted">
            {weekRecipes.length} recipes
            {selectedEntryIds ? '' : ` · ${weekRangeLabel(weekStart)}`}
            {refining ? ' · estimating…' : ''}
          </Text>
        </View>
        {embedded ? null : (
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text variant="bodyStrong" color="textMuted">
              Done
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {editing ? (
          <View style={styles.section}>
            <SectionLabel color="textMuted">Add an item</SectionLabel>
            <View style={styles.editAddRow}>
              <TextInput
                value={addName}
                onChangeText={setAddName}
                placeholder="Item name"
                placeholderTextColor={colors.textFaint}
                style={[styles.editInput, styles.editName]}
                onSubmitEditing={submitAdd}
                returnKeyType="done"
              />
              <TextInput
                value={addQty}
                onChangeText={setAddQty}
                placeholder="Qty"
                placeholderTextColor={colors.textFaint}
                style={[styles.editInput, styles.editQtyInput]}
                onSubmitEditing={submitAdd}
                returnKeyType="done"
              />
              <Button label="Add" glyph="add" onPress={submitAdd} disabled={!addName.trim()} />
            </View>

            {visibleItems.length > 0 ? (
              <>
                <SectionLabel color="textMuted" style={styles.editGroupLabel}>
                  From your recipes
                </SectionLabel>
                {visibleItems.map((item) => (
                  <View key={`edit:${item.name}`} style={styles.editRow}>
                    <Text style={styles.editName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <TextInput
                      value={item.buy}
                      onChangeText={(t) => editItemQty(item.name, t)}
                      placeholder="Qty"
                      placeholderTextColor={colors.textFaint}
                      style={[styles.editInput, styles.editQtyInput]}
                    />
                    <Pressable
                      onPress={() => deleteItem(item.name)}
                      hitSlop={8}
                      style={styles.editDelete}
                      accessibilityLabel={`Remove ${item.name}`}>
                      <Glyph name="close" size={16} color="textMuted" />
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}

            {extras.length > 0 ? (
              <>
                <SectionLabel color="textMuted" style={styles.editGroupLabel}>
                  Added items
                </SectionLabel>
                {extras.map((ex) => (
                  <View key={`edit-extra:${ex.id}`} style={styles.editRow}>
                    <TextInput
                      defaultValue={ex.canonicalName}
                      onEndEditing={(e) => {
                        const t = e.nativeEvent.text.trim();
                        if (t) updateExtra(ex.id, { canonicalName: t });
                      }}
                      placeholder="Item name"
                      placeholderTextColor={colors.textFaint}
                      style={[styles.editInput, styles.editName]}
                    />
                    <TextInput
                      defaultValue={extraQty(ex)}
                      onEndEditing={(e) => {
                        const { amount, unit } = parseQty(e.nativeEvent.text);
                        updateExtra(ex.id, { amount, unit });
                      }}
                      placeholder="Qty"
                      placeholderTextColor={colors.textFaint}
                      style={[styles.editInput, styles.editQtyInput]}
                    />
                    <Pressable
                      onPress={() => removeExtra(ex.id)}
                      hitSlop={8}
                      style={styles.editDelete}
                      accessibilityLabel={`Remove ${ex.canonicalName}`}>
                      <Glyph name="close" size={16} color="textMuted" />
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}

            {visibleItems.length === 0 && extras.length === 0 ? (
              <Text color="textMuted" style={styles.empty}>
                Nothing on the list yet. Add items above.
              </Text>
            ) : null}
          </View>
        ) : (
          <>

        <View style={styles.viewSegment}>
          <SegmentedControl
            segments={[
              // Each count is simply how many rows are in that list — a Staples
              // count of 1 while 5 staples sit there reads as a bug. The
              // low/out ones are surfaced by sorting them to the top instead.
              { key: 'active', label: 'Active', count: activeRows.length },
              { key: 'staples', label: 'Staples', count: stapleRows.length },
            ]}
            value={listView}
            onChange={(k) => switchView(k as 'active' | 'staples')}
          />
        </View>

        {currentRows.length > 0 ? (
          <View style={styles.selectAllRow}>
            {/* Grouping is opt-in — the flat list stays the default. Tapping an
                active mode turns it back off. Recipe grouping is Active-only:
                staples don't come from recipes. */}
            <View style={styles.groupToggles}>
              <Pressable
                onPress={() => toggleGroup('store')}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ selected: groupBy === 'store' }}>
                <Text
                  variant="sectionLabel"
                  color={groupBy === 'store' ? 'accent' : 'textFaint'}>
                  By store
                </Text>
              </Pressable>
              {listView === 'active' ? (
                <Pressable
                  onPress={() => toggleGroup('recipe')}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ selected: groupBy === 'recipe' }}>
                  <Text
                    variant="sectionLabel"
                    color={groupBy === 'recipe' ? 'accent' : 'textFaint'}>
                    By recipe
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Pressable onPress={toggleSelectAll} hitSlop={6} accessibilityRole="button">
              <Text variant="sectionLabel" color="accent">
                {allSelected ? 'Deselect all' : 'Select all'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {recipeGroups
          ? recipeGroups.map((g) => (
              <View key={`rg:${g.label}`} style={styles.section}>
                <SectionLabel color="text">
                  {g.label} · {g.rows.length}
                </SectionLabel>
                {/* An item wanted by two recipes renders under both, so the row
                    key has to be scoped to the group or React sees a duplicate. */}
                {g.rows.map((row) =>
                  renderRow({ ...row, key: `${g.label}:${row.key}` }),
                )}
              </View>
            ))
          : storeGroups
            ? storeGroups.map((g) => (
                <View key={g.label} style={styles.section}>
                  <SectionLabel color={g.id ? 'text' : 'textMuted'}>
                    {g.label} · {g.rows.length}
                  </SectionLabel>
                  {g.rows.map(renderRow)}
                </View>
              ))
            : currentRows.map(renderRow)}

        {/* Reminders-style inline add: tap the blank row and type. Enter keeps
            the keyboard up so you can add several in a row. */}
        <Pressable
          style={styles.addRow}
          onPress={() => addInputRef.current?.focus()}
          accessibilityRole="button"
          accessibilityLabel={listView === 'staples' ? 'Add a staple' : 'Add an item'}>
          <View style={styles.addBullet} />
          <TextInput
            ref={addInputRef}
            value={addName}
            onChangeText={setAddName}
            onSubmitEditing={submitAdd}
            blurOnSubmit={false}
            returnKeyType="done"
            placeholder={listView === 'staples' ? 'Add a staple' : 'Add an item'}
            placeholderTextColor={colors.textFaint}
            style={styles.addInput}
          />
        </Pressable>

        {/* Pushed: what went out to Wegmans/Reminders in the last 24h.
            Collapsed by default; tap a row to pull it back onto the list. */}
        {/* Pending — in-flight items (agent filling the cart). They leave Active
            the moment you push, and move to Pushed once the fill completes. */}
        {filling && job && job.rows.length > 0 ? (
          <View style={styles.pushedSection}>
            <Pressable
              onPress={() => setPendingOpen((v) => !v)}
              style={styles.pushedHeaderMain}
              accessibilityRole="button"
              accessibilityLabel={pendingOpen ? 'Collapse pending list' : 'Expand pending list'}>
              <Text variant="sectionLabel" color="accent">
                Pending · {job.rows.length} · filling {job.retailer === 'costco' ? 'Costco' : 'Wegmans'} cart…
              </Text>
              <Glyph
                name="expand"
                size={13}
                color="accent"
                style={pendingOpen ? undefined : styles.pushedCaretClosed}
              />
            </Pressable>
            {pendingOpen
              ? job.rows.map((r) => (
                  <View key={`pending:${r.key}`} style={styles.pushedRow}>
                    <Text color="textFaint" style={styles.pushedName} numberOfLines={1}>
                      {r.name}
                    </Text>
                  </View>
                ))
              : null}
          </View>
        ) : null}

        {pushedItems.length > 0 ? (
          <View style={styles.pushedSection}>
            <View style={styles.pushedHeader}>
              <Pressable
                onPress={() => setPushedOpen((v) => !v)}
                style={styles.pushedHeaderMain}
                accessibilityRole="button"
                accessibilityLabel={pushedOpen ? 'Collapse pushed list' : 'Expand pushed list'}>
                <Text variant="sectionLabel" color="textFaint">
                  Pushed · {pushedItems.length}
                </Text>
                <Glyph
                  name="expand"
                  size={13}
                  color="textFaint"
                  style={pushedOpen ? undefined : styles.pushedCaretClosed}
                />
              </Pressable>
              {/* Clear all = delete every pushed item for good (removes their
                  extras too, so they don't bounce back onto Active). */}
              <Pressable
                onPress={clearAllPushed}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Delete all pushed items">
                <Text variant="sectionLabel" color="accent">
                  Clear all
                </Text>
              </Pressable>
            </View>
            {pushedOpen
              ? pushedItems.map((e) => (
                  <View key={`pushed:${e.key}`} style={styles.pushedRow}>
                    <Text color="textFaint" style={styles.pushedName} numberOfLines={1}>
                      {e.name}
                    </Text>
                    <Text color="textFaint" style={styles.pushedDest}>
                      {e.dest === 'wegmans'
                        ? 'Wegmans'
                        : e.dest === 'costco'
                          ? 'Costco'
                          : e.dest === 'amazon'
                            ? 'Amazon'
                            : 'Reminders'}
                    </Text>
                    {/* Restore = back to Active. Clear = delete for good. */}
                    <Pressable
                      onPress={() => restorePushed(e.key)}
                      hitSlop={8}
                      style={styles.pushedAction}
                      accessibilityRole="button"
                      accessibilityLabel={`Restore ${e.name} to the active list`}>
                      <Text variant="sectionLabel" color="textMuted">
                        Restore
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => deletePushedItem(e.key)}
                      hitSlop={8}
                      style={styles.pushedAction}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${e.name}`}>
                      <Text variant="sectionLabel" color="accent">
                        Clear
                      </Text>
                    </Pressable>
                  </View>
                ))
              : null}
          </View>
        ) : null}

          </>
        )}

        {revealText ? (
          <Card style={styles.revealCard}>
            <SectionLabel color="textMuted">
              Select & copy (clipboard wiring deferred on native — spec §13)
            </SectionLabel>
            <TextInput
              value={text}
              editable={false}
              multiline
              style={styles.revealText}
            />
          </Card>
        ) : null}

        {hint ? (
          <Text color="textMuted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </ScrollView>

      <Overlay visible={menu !== null} onClose={() => setMenu(null)}>
        {menu ? (
          <RowDetailSheet
            name={menu.name}
            qty={menu.qty === 'as needed' ? '' : menu.qty}
            extraId={menu.extraId}
            meta={metaFor(menu.baseName)}
            isAlways={isExactAlwaysHave(menu.baseName, alwaysHaveMap)}
            // Edit the item itself, through the same path as the single-tap
            // quick edit — the two can't drift apart.
            onSaveEdit={(name, qty) => {
              saveRowEdit(menu, name, qty);
              setMenu(null);
            }}
            // Picking a store is a discrete action, so close the sheet on it.
            onSetStore={(store) => {
              setShopMeta(menu.baseName, { store });
              setMenu(null);
            }}
            onSetField={(patch) => setShopMeta(menu.baseName, patch)}
            onToggleAlways={() => {
              const turningOn = !isExactAlwaysHave(menu.baseName, alwaysHaveMap);
              pinStaple(menu.baseName, turningOn);
              // The materialized list keeps plan-wizard extras on Active even
              // once they're staples (you put them there on purpose). But marking
              // "always have" is the explicit "this is a standing staple, not
              // this week's buy" — so drop the concrete row off Active. pinStaple
              // has already put it in the pantry.
              if (turningOn) {
                if (menu.members) {
                  for (const m of menu.members) if (m.extraId) removeExtra(m.extraId);
                } else if (menu.extraId) {
                  removeExtra(menu.extraId);
                }
              }
              setMenu(null);
            }}
            // Only offered on a merged row — undoes the combine.
            onSplit={
              menu.members
                ? () => {
                    unmerge(matchKey(menu.baseName));
                    setMenu(null);
                  }
                : undefined
            }
            onDelete={() => {
              deleteRow(menu);
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        ) : null}
      </Overlay>

      <Overlay visible={buying !== null} onClose={() => setBuying(null)}>
        {buying ? (
          <BuySheet
            name={buying.name}
            defaultQty={buying.qty}
            defaultLoc={locForName(buying.name)}
            onConfirm={commitBuy}
            onSkip={skipBuy}
            onClose={() => setBuying(null)}
          />
        ) : null}
      </Overlay>

      {/* Instacart result — fires once the Beelink agent has actually filled the
          cart, so this is a real report, not an optimistic "sent!". Shows the
          product it matched each item to, plus anything it couldn't find. */}
      <Overlay visible={jobResult !== null} onClose={() => setJobResult(null)}>
        {jobResult ? (
          <View style={styles.combineSheet}>
            <Heading variant="recipeTitle">
              {jobResult.ok ? 'Cart filled' : "Cart didn't fill"}
            </Heading>
            {!jobResult.ok ? (
              <Text color="accent">{jobResult.error} Nothing left your list.</Text>
            ) : jobResult.verified === false ? (
              // The agent couldn't read the cart back, so it doesn't actually
              // know what landed. Say so instead of inventing a number.
              <Text color="warn">
                Couldn’t confirm what made it into the cart, so nothing was
                cleared. Check Instacart, then clear anything you did get.
              </Text>
            ) : (
              <Text color="textMuted">
                {jobResult.addedCount} item
                {jobResult.addedCount === 1 ? '' : 's'} added
                {jobResult.missing.length > 0
                  ? `; ${jobResult.missing.join(', ')} not available — kept on your list.`
                  : '.'}
              </Text>
            )}

            <ScrollView style={styles.combineScroll}>
              {jobResult.added.map((a, i) => (
                <View key={`${a.name}-${i}`} style={styles.jobRow}>
                  <Glyph name="done" size={13} color="ok" />
                  <Text color="textMuted" style={styles.flex} numberOfLines={2}>
                    {a.name}
                    {a.qty > 1 ? ` ×${a.qty}` : ''}
                  </Text>
                </View>
              ))}
              {jobResult.missing.map((u, i) => {
                // Distinguish "Instacart put it in the cart then said it isn't
                // available in your area" from "couldn't find it at all" — they
                // mean different things to you.
                const unavail = (jobResult.unavailable ?? []).some(
                  (n) => matchKey(n) === matchKey(u),
                );
                // verified:false = the agent couldn't READ the cart, not that the
                // add failed — the items likely ARE in the cart. Don't call that
                // "couldn't be added" (reads as a failure of all 14).
                const unconfirmed = jobResult.verified === false;
                return (
                  <View key={`u-${u}-${i}`} style={styles.jobRow}>
                    <Glyph
                      name={unconfirmed ? 'expand' : 'close'}
                      size={13}
                      color={unconfirmed ? 'textMuted' : 'warn'}
                    />
                    <Text color="textFaint" style={styles.flex} numberOfLines={2}>
                      {u} —{' '}
                      {unconfirmed
                        ? 'couldn’t auto-confirm, still on your list'
                        : `${unavail ? 'not available in your area' : 'couldn’t be added'}, still on your list`}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>

            <Button
              label="Open Instacart"
              glyph="next"
              flex
              onPress={() => {
                setJobResult(null);
                // Just open it — the cart is already filled, nothing to paste.
                if (Platform.OS === 'web') {
                  if (isIOSWeb) window.location.href = INSTACART_APP;
                  else window.open(INSTACART_WEB, '_blank', 'noopener');
                } else {
                  void Linking.openURL(INSTACART_APP).catch(() =>
                    Linking.openURL(INSTACART_WEB),
                  );
                }
              }}
            />
            <Pressable
              style={styles.menuCancel}
              onPress={() => setJobResult(null)}
              accessibilityRole="button">
              <Text color="textMuted">Done</Text>
            </Pressable>
          </View>
        ) : null}
      </Overlay>

      {/* Bulk store assignment for the checked rows. */}
      <Overlay visible={storeSheet} onClose={() => setStoreSheet(false)}>
        <View style={styles.menu}>
          <Text variant="bodyStrong" style={styles.menuTitle}>
            Assign a store to {selectedRows.length} item
            {selectedRows.length === 1 ? '' : 's'}
          </Text>
          <View style={styles.storeChips}>
            <Pressable
              onPress={() => assignStoreToSelected(null)}
              style={styles.storeChip}
              accessibilityRole="button">
              <Text variant="sectionLabel" color="textMuted">
                Unassigned
              </Text>
            </Pressable>
            {STORES.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => assignStoreToSelected(s.id)}
                style={styles.storeChip}
                accessibilityRole="button">
                <Text variant="sectionLabel" color="textMuted">
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.menuCancel}
            onPress={() => setStoreSheet(false)}
            accessibilityRole="button">
            <Text color="textMuted">Cancel</Text>
          </Pressable>
        </View>
      </Overlay>

      {/* Suggestion bar — non-blocking, one at a time, only when you're not
          mid-selection. Replaces the "Combine duplicates?" modal. */}
      {suggestion && selectedRows.length === 0 ? (
        <BottomActionBar
          meta={
            <Text color="textMuted">
              “{suggestion.a.name}” and “{suggestion.b.name}” look like the same
              thing.
            </Text>
          }>
          <Button
            label="Dismiss"
            variant="secondary"
            flex
            onPress={dismissSuggestion}
          />
          <Button label="Combine" glyph="done" flex onPress={acceptSuggestion} />
        </BottomActionBar>
      ) : null}

      {/* Push bar pops up only while ≥1 row is selected (Reminders-style). */}
      {selectedRows.length > 0 ? (
        <BottomActionBar
          meta={
            <View style={styles.selectMeta}>
              <Pressable onPress={clearSelection} hitSlop={6} accessibilityRole="button">
                <Text color="textFaint">{selectedRows.length} selected</Text>
              </Pressable>
              {/* Bulk store tag — sort-by-store is useless if tagging is a
                  long-press at a time. */}
              <Pressable
                onPress={() => setStoreSheet(true)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Assign a store to ${selectedRows.length} items`}>
                <Text variant="sectionLabel" color="textMuted">
                  Store
                </Text>
              </Pressable>
              {/* Manual combine: check two look-alikes, fold them into one. */}
              {selectedRows.length >= 2 && listView === 'active' ? (
                <Pressable
                  onPress={combineSelected}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Combine ${selectedRows.length} items into one`}>
                  <Text variant="sectionLabel" color="ok">
                    Combine · {selectedRows.length}
                  </Text>
                </Pressable>
              ) : null}
              {/* Destructive, so it sits up here away from the push buttons. */}
              <Pressable
                onPress={deleteSelected}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={
                  listView === 'staples'
                    ? `Remove ${selectedRows.length} from Staples`
                    : `Delete ${selectedRows.length} items`
                }>
                <Text variant="sectionLabel" color="accent">
                  {listView === 'staples' ? 'Remove' : 'Delete'} · {selectedRows.length}
                </Text>
              </Pressable>
            </View>
          }>
          {listView === 'staples' ? (
            <>
              {/* Staples go to the bulk stores. Amazon = per-item search tabs;
                  Costco = the same Instacart auto-fill as Wegmans. */}
              <Button
                label={`Push to Amazon · ${selectedRows.length}`}
                variant="secondary"
                flex
                onPress={pushToAmazon}
              />
              <Button
                label={
                  filling
                    ? 'Filling cart…'
                    : sending
                      ? 'Pushing…'
                      : `Push to Costco · ${selectedRows.length}`
                }
                glyph="next"
                flex
                disabled={sending || filling}
                onPress={pushToCostco}
              />
            </>
          ) : (
            <>
              <Button
                label={`Push to Reminders · ${selectedRows.length}`}
                variant="secondary"
                flex
                onPress={pushToReminders}
              />
              <Button
                label={
                  filling
                    ? 'Filling cart…'
                    : sending
                      ? 'Pushing…'
                      : `Push to Wegmans · ${selectedRows.length}`
                }
                glyph="next"
                flex
                disabled={sending || filling}
                onPress={pushToWegmans}
              />
            </>
          )}
        </BottomActionBar>
      ) : null}
    </SafeAreaView>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

type RowProps = {
  name: string;
  qty: string;
  math: string | null;
  sources?: ShoppingSource[];
  origin?: string | null;
  expanded?: boolean;
  marked: boolean;
  /** Pinned by the user as "always have." Forces the row into the Already-
   *  have bucket regardless of session state, and shows a small tag. */
  always: boolean;
  likely: boolean;
  /** Spec §5 pantry-status: 'out' auto-promotes + locks the toggle, 'low' just renders a tag. */
  pantryStatus?: PantryStatus;
  /** Store tag label (note 3) — shown as a chip when set. */
  storeName?: string | null;
  /** Checkbox is filled (skip-cart on a buy row). Independent of `marked`. */
  checked?: boolean;
  /** Render the row dimmed — used for skip-cart rows that stay on the list. */
  dim?: boolean;
  onTap: () => void;
  onToggleHave: () => void;
  /** Checkbox tap. Falls back to onToggleHave when not supplied (Have rows). */
  onCheck?: () => void;
  onDelete: () => void;
  onLongPress?: () => void;
};

function ShoppingRow({
  name,
  qty,
  math,
  sources,
  origin,
  expanded,
  marked,
  always,
  likely,
  pantryStatus,
  storeName,
  checked,
  dim,
  onTap,
  onToggleHave,
  onCheck,
  onDelete,
  onLongPress,
}: RowProps) {
  // Gesture model (Nate's spec):
  // - Checkbox tap → skip-cart toggle (stay on the list, out of the cart).
  // - Swipe right  → "you have it" — commit-on-open, snap closed.
  // - Swipe left   → reveals a tappable Delete button; requires a second tap
  //   because delete is destructive (consolidated rows lose group context,
  //   Extras rows go for good).
  // - Long-press   → the options sheet (store, qty, brand, note, Always, Delete).
  const swipeRef = useRef<SwipeableMethods | null>(null);
  // onSwipeableOpen reports the drag direction: a rightward drag reveals the
  // left actions (Have), a leftward drag reveals the right actions (Delete).
  const handleOpen = (dir: 'left' | 'right') => {
    if (dir === 'right') {
      // Swipe right → "you have it" — commit-on-open, snap closed.
      swipeRef.current?.close();
      onToggleHave();
    }
    // dir === 'left' → Delete panel revealed; user must tap the Delete button.
  };
  const handleDeletePress = () => {
    swipeRef.current?.close();
    onDelete();
  };
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={1.5}
      leftThreshold={48}
      rightThreshold={48}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableOpen={handleOpen}
      renderLeftActions={() => (
        <View
          style={styles.haveAction}
          accessibilityLabel={
            marked
              ? `Swipe to move ${name} back to the shopping list`
              : `Swipe to drop ${name} — already have it`
          }>
          <Text color="bg" variant="bodyStrong" style={styles.deleteLabel}>
            {marked ? 'To buy' : 'Have'}
          </Text>
        </View>
      )}
      renderRightActions={() => (
        <View style={styles.rightActions}>
          <GHPressable
            onPress={handleDeletePress}
            style={styles.deleteAction}
            accessibilityRole="button"
            accessibilityLabel={`Confirm delete ${name}`}>
            <Text color="bg" variant="bodyStrong" style={styles.deleteLabel}>
              Delete
            </Text>
          </GHPressable>
        </View>
      )}>
      <View style={styles.rowSurface}>
        <View style={styles.item}>
          {/* Checkbox and body are SIBLINGS, not nested — tapping the box
              selects; tapping the row body edits. (Nested, both fired.) */}
          {/* Plain RN Pressable, NOT the gesture-handler one: nested inside the
              swipeable's pan gesture, a 20x20 gesture-handler target loses the
              tap to the pan on the slightest pointer drift, so presses never
              fired. A real press/click handler sidesteps the gesture system.
              Wrapped in a padded hit area so the box is easy to hit. */}
          <Pressable
            hitSlop={12}
            onPress={onCheck ?? onToggleHave}
            style={styles.checkHit}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!checked }}
            accessibilityLabel={
              marked
                ? `Move ${name} back to the shopping list`
                : checked
                  ? `Deselect ${name}`
                  : `Select ${name}`
            }>
            {/* Empty = unselected. Filled = selected (part of the push). */}
            <View style={[styles.check, checked && styles.checkOn]}>
              {checked ? <Glyph name="done" size={12} color="bg" /> : null}
            </View>
          </Pressable>
          <GHPressable
            style={styles.rowBody}
            onPress={onTap}
            onLongPress={onLongPress}
            delayLongPress={350}
            accessibilityLabel={`Edit ${name}`}>
          <View style={styles.flex}>
            <View style={styles.nameRow}>
              <Text color={marked || dim ? 'textFaint' : 'text'}>
                {name}
              </Text>
              {pantryStatus === 'out' ? (
                <Text color="accent" style={styles.outTag}>
                  out
                </Text>
              ) : pantryStatus === 'low' ? (
                <Text color="warn" style={styles.lowTag}>
                  low
                </Text>
              ) : null}
              {always ? (
                <Text color="ok" style={styles.alwaysTag}>
                  always
                </Text>
              ) : likely && !marked ? (
                <Text color="textFaint" style={styles.likelyTag}>
                  likely already have
                </Text>
              ) : null}
              {storeName ? (
                <Text color="textMuted" style={styles.storeTag}>
                  {storeName}
                </Text>
              ) : null}
            </View>
            {origin ? (
              <Text color="textFaint" style={styles.origin}>
                {origin}
              </Text>
            ) : null}
            {sources && sources.length > 0 && !expanded ? (
              // Recipe names only — unit-free, since qty is on the right
              // and the full breakdown is one tap away.
              <Text color="textFaint" style={styles.recipeList} numberOfLines={2}>
                {dedupeRecipes(sources).join(' · ')}
              </Text>
            ) : null}
            {expanded && sources ? (
              <View style={styles.sources}>
                {math ? (
                  <Numeric color="textFaint" style={styles.breakdown}>
                    {math}
                  </Numeric>
                ) : null}
                {sources.map((s, i) => (
                  <Text
                    key={`${s.recipe}-${i}`}
                    color="textFaint"
                    style={styles.sourceLine}>
                    · {srcQty(s)} {s.text} — {s.recipe}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
          <Numeric color={marked ? 'textFaint' : 'text'} style={styles.qty}>
            {qty}
          </Numeric>
          </GHPressable>
        </View>
      </View>
    </ReanimatedSwipeable>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strikethrough state: the user checked this off, and it STAYS checked.
 *
 * This used to be "marked within the last 6 hours", inferred from a timestamp.
 * Six hours after a shop, every checked-off row silently came back — which is
 * what "items keep adding themselves to my list" actually was. Checking off is
 * now an explicit, persisted fact; the pantry going low/out is what brings an
 * item back (see `inHave`), not the clock.
 */
function isMarked(checked: Record<string, true>, name: string): boolean {
  return checked[name.toLowerCase().trim()] === true;
}

/** Pre-shop hint: "you’ve marked this name ≥ 3× in the last 60 days." */
function isLikelyHave(
  byName: Record<string, { count: number; lastAt: Date }>,
  name: string,
): boolean {
  const r = byName[name.toLowerCase().trim()];
  if (!r) return false;
  const at = r.lastAt instanceof Date ? r.lastAt.getTime() : new Date(r.lastAt).getTime();
  const ageDays = (Date.now() - at) / 86_400_000;
  return r.count >= 3 && ageDays <= 60;
}

/** Recipe names contributing to a row, in original order, deduped. */
function dedupeRecipes(sources: ShoppingSource[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.recipe)) continue;
    seen.add(s.recipe);
    out.push(s.recipe);
  }
  return out;
}

function extraQty(ex: ExtraItem): string {
  return formatAmount(ex.amount, ex.unit) || 'some';
}


/** The cleanest shopping name in a group — fewest words, then shortest. */
function simplestRow<T extends { name: string; baseName: string }>(rows: T[]): T {
  return [...rows].sort((x, y) => {
    const wx = matchKey(x.baseName).split(' ').length;
    const wy = matchKey(y.baseName).split(' ').length;
    return wx - wy || x.baseName.length - y.baseName.length;
  })[0]!;
}

/**
 * Add up the quantities of merged rows. Sums when the units agree (or there are
 * none); otherwise keeps the distinct parts side by side rather than inventing a
 * conversion — "1 lb + 2 cups" is honest, a made-up total isn't.
 */
/** Unit aliases, so "1 teaspoon + 1 tsp" sums to "2 tsp" instead of sitting
 *  side by side looking broken. Same unit spelled two ways is still one unit. */
const UNIT_ALIAS: Record<string, string> = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
  cups: 'cup',
  gram: 'g', grams: 'g',
  kilogram: 'kg', kilograms: 'kg',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml',
  liter: 'l', liters: 'l',
  cloves: 'clove',
  bunches: 'bunch',
  cans: 'can',
};
const normUnit = (u: string): string => {
  const k = u.trim().toLowerCase();
  return UNIT_ALIAS[k] ?? k;
};

function sumQtyStrings(qtys: string[]): string {
  const real = qtys.map((q) => q.trim()).filter((q) => q && q !== 'as needed');
  if (real.length === 0) return qtys.some((q) => q === 'as needed') ? 'as needed' : '';
  const buckets = new Map<string, number>();
  const freeform: string[] = [];
  for (const q of real) {
    const { amount, unit } = parseQty(q);
    if (amount == null) {
      freeform.push(q);
      continue;
    }
    const u = normUnit(unit ?? '');
    buckets.set(u, (buckets.get(u) ?? 0) + amount);
  }
  const parts = [...buckets.entries()].map(([u, a]) => {
    const n = `${+a.toFixed(2)}`;
    return u ? `${n} ${u}` : n;
  });
  return [...parts, ...freeform].join(' + ');
}

/** Loose "2 cups" / "3" / "a pinch" → {amount, unit} parse for manual adds and
 *  inline qty edits. A leading number splits into amount + unit; anything else
 *  is kept whole as the unit (so "a pinch" / "to taste" survive). */
function parseQty(raw: string): { amount: number | null; unit: string | null } {
  const t = raw.trim();
  if (!t) return { amount: null, unit: null };
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (m) {
    const amount = Number(m[1]);
    return {
      amount: Number.isFinite(amount) ? amount : null,
      unit: (m[2] ?? '').trim() || null,
    };
  }
  return { amount: null, unit: t };
}

// ─── Long-press detail sheet (note 3) ────────────────────────────────────────

function RowDetailSheet({
  name,
  extraId,
  qty,
  meta,
  isAlways,
  onSaveEdit,
  onSetStore,
  onSetField,
  onToggleAlways,
  onSplit,
  onDelete,
  onClose,
}: {
  name: string;
  qty: string;
  extraId: string | null;
  meta: ShopMeta;
  isAlways: boolean;
  onSaveEdit: (name: string, qty: string) => void;
  onSetStore: (store: StoreId | null) => void;
  onSetField: (patch: ShopMeta) => void;
  onToggleAlways: () => void;
  /** Only set on a merged row. */
  onSplit?: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Local draft so typing doesn't rewrite the list under you; committed by Save.
  const [draftName, setDraftName] = useState(name);
  const [draftQty, setDraftQty] = useState(qty);
  const dirty = draftName.trim() !== name || draftQty.trim() !== qty;

  return (
    <ScrollView style={styles.detailScroll}>
      <View style={styles.menu}>
        {/* Edit the item itself here, not just its metadata — same as the
            single-tap quick edit, for people who long-press first. */}
        <SectionLabel color="textMuted">Item</SectionLabel>
        <View style={styles.detailEditRow}>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Item name"
            placeholderTextColor={colors.textFaint}
            style={[styles.editInput, styles.flex]}
            onSubmitEditing={() => onSaveEdit(draftName, draftQty)}
            returnKeyType="done"
            accessibilityLabel="Item name"
          />
          <TextInput
            value={draftQty}
            onChangeText={setDraftQty}
            placeholder="Qty"
            placeholderTextColor={colors.textFaint}
            style={[styles.editInput, styles.editQtyInput]}
            onSubmitEditing={() => onSaveEdit(draftName, draftQty)}
            returnKeyType="done"
            accessibilityLabel="Quantity"
          />
        </View>
        {dirty ? (
          <Button
            label="Save"
            glyph="done"
            variant="secondary"
            onPress={() => onSaveEdit(draftName, draftQty)}
          />
        ) : null}

        <SectionLabel color="textMuted" style={styles.detailFieldLabel}>
          Store
        </SectionLabel>
        <View style={styles.storeChips}>
          <Pressable
            onPress={() => onSetStore(null)}
            style={[styles.storeChip, !meta.store && styles.storeChipOn]}
            accessibilityRole="button">
            <Text
              variant="sectionLabel"
              color={!meta.store ? 'bg' : 'textMuted'}>
              Unassigned
            </Text>
          </Pressable>
          {STORES.map((s) => {
            const on = meta.store === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => onSetStore(s.id)}
                style={[styles.storeChip, on && styles.storeChipOn]}
                accessibilityRole="button">
                <Text variant="sectionLabel" color={on ? 'bg' : 'textMuted'}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <SectionLabel color="textMuted" style={styles.detailFieldLabel}>
          Brand
        </SectionLabel>
        <TextInput
          defaultValue={meta.brand ?? ''}
          onEndEditing={(e) => onSetField({ brand: e.nativeEvent.text })}
          placeholder="optional"
          placeholderTextColor={colors.textFaint}
          style={styles.editInput}
        />
        <SectionLabel color="textMuted" style={styles.detailFieldLabel}>
          Note
        </SectionLabel>
        <TextInput
          defaultValue={meta.note ?? ''}
          onEndEditing={(e) => onSetField({ note: e.nativeEvent.text })}
          placeholder="optional"
          placeholderTextColor={colors.textFaint}
          style={styles.editInput}
        />

        <Pressable
          style={styles.menuItem}
          onPress={onToggleAlways}
          accessibilityRole="button">
          <Text variant="bodyStrong" color={isAlways ? 'accent' : 'text'}>
            {isAlways ? 'Remove “always have”' : 'Always have'}
          </Text>
          <Text color="textFaint" style={styles.menuItemHint}>
            {isAlways
              ? 'Back on the active list as a regular buy item.'
              : 'Keeps it off the active list — it lives in Staples, and shows up there to buy when it runs low.'}
          </Text>
        </Pressable>
        {onSplit ? (
          <Pressable
            style={styles.menuItem}
            onPress={onSplit}
            accessibilityRole="button">
            <Text variant="bodyStrong">Split back apart</Text>
            <Text color="textFaint" style={styles.menuItemHint}>
              Undo the combine — these go back to separate lines.
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.menuItem}
          onPress={onDelete}
          accessibilityRole="button">
          <Text variant="bodyStrong" color="accent">
            {extraId ? 'Delete from extras' : 'Delete'}
          </Text>
          <Text color="textFaint" style={styles.menuItemHint}>
            {extraId
              ? 'Permanent — removes the row from your Extras store.'
              : 'Removes it and keeps it off future plan → shopping lists.'}
          </Text>
        </Pressable>
        <Pressable style={styles.menuCancel} onPress={onClose}>
          <Text color="textMuted">Done</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ─── Buy-confirm sheet (the buy loop) ────────────────────────────────────────

/** Sensible default pantry location for a bought item, from its category —
 *  mirrors the pantry store's defaultLocation so the picker starts where the
 *  item usually lives. */
function locForName(name: string): PantryLocation {
  const c = categorizeIngredient(name);
  if (c === 'frozen') return 'freezer';
  if (c === 'dairy' || c === 'meat' || c === 'produce') return 'fridge';
  return 'pantry';
}

function BuySheet({
  name,
  defaultQty,
  defaultLoc,
  onConfirm,
  onSkip,
  onClose,
}: {
  name: string;
  defaultQty: string;
  defaultLoc: PantryLocation;
  onConfirm: (loc: PantryLocation, qty: string) => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const [loc, setLoc] = useState<PantryLocation>(defaultLoc);
  const [qty, setQty] = useState(defaultQty);
  const pretty = name.charAt(0).toUpperCase() + name.slice(1);
  return (
    <View style={styles.menu}>
      <Text variant="bodyStrong" style={styles.menuTitle}>
        Got {pretty}?
      </Text>
      <Text color="textFaint" style={styles.menuHint}>
        Add it to your pantry so it tracks — or just clear it off the list.
      </Text>

      <SectionLabel color="textMuted">Where</SectionLabel>
      <View style={styles.locRow}>
        {(['pantry', 'fridge', 'freezer'] as PantryLocation[]).map((l) => {
          const on = loc === l;
          return (
            <Pressable
              key={l}
              onPress={() => setLoc(l)}
              style={[styles.locBtn, on && styles.locBtnOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}>
              <Text variant="bodyStrong" color={on ? 'bg' : 'text'}>
                {l === 'pantry' ? 'Shelf' : l === 'fridge' ? 'Fridge' : 'Freezer'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SectionLabel color="textMuted" style={styles.detailFieldLabel}>
        Quantity
      </SectionLabel>
      <TextInput
        value={qty}
        onChangeText={setQty}
        placeholder="optional — e.g. 2 lbs"
        placeholderTextColor={colors.textFaint}
        style={styles.editInput}
        returnKeyType="done"
        onSubmitEditing={() => onConfirm(loc, qty)}
      />

      <View style={styles.buyConfirm}>
        <Button label="Add to pantry" glyph="done" flex onPress={() => onConfirm(loc, qty)} />
      </View>
      <Pressable style={styles.menuItem} onPress={onSkip} accessibilityRole="button">
        <Text variant="bodyStrong">Already had it</Text>
        <Text color="textFaint" style={styles.menuItemHint}>
          Clears it off the list without adding to the pantry.
        </Text>
      </Pressable>
      <Pressable style={styles.menuCancel} onPress={onClose}>
        <Text color="textMuted">Cancel</Text>
      </Pressable>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  tone = 'text',
}: {
  label: string;
  value: string;
  tone?: 'text' | 'ok' | 'accent';
}) {
  return (
    <View style={styles.summaryRow}>
      <Text color="textMuted">{label}</Text>
      <Numeric color={tone}>{value}</Numeric>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // minWidth: 0 lets the middle column actually shrink on narrow viewports —
  // RN/web flex children default to min-content sizing, so without this a
  // single long ingredient name pushes the qty off-screen and overlaps the
  // check on the left. This fixes the mobile overlap (#10).
  flex: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 12,
  },
  body: { padding: layout.screenPadding, paddingBottom: 30, gap: 16 },
  summary: { gap: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { gap: 4 },

  // Phase D controls: group toggle + clear-checked.
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  groupToggle: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: colors.bg2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 3,
  },
  groupBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  groupBtnOn: { backgroundColor: colors.accent },
  storeTag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    backgroundColor: colors.bg3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  routeCard: { gap: 8 },
  routeCaption: { fontSize: 12, fontStyle: 'italic', lineHeight: 17 },

  // Cart-combine review sheet.
  combineSheet: { gap: 12, maxHeight: 480 },
  combineScroll: { maxHeight: 340 },
  combineCard: {
    gap: 4,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  combineSources: { fontSize: 12, lineHeight: 16 },
  combineSuggest: { fontSize: 13, fontWeight: '600', paddingTop: 2 },
  combineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    paddingTop: 6,
  },
  combineBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
  },
  combineBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  combineQty: { flexGrow: 1, minWidth: 110, paddingVertical: 6 },

  // Detail sheet: store chips + fields.
  detailScroll: { maxHeight: 460 },
  storeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 2 },
  storeChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
  },
  storeChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  detailFieldLabel: { marginTop: 8 },
  // Buy-confirm sheet: location picker + confirm.
  locRow: { flexDirection: 'row', gap: 8, paddingTop: 2 },
  locBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
    alignItems: 'center',
  },
  locBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  buyConfirm: { flexDirection: 'row', paddingTop: 12 },
  rightActions: { flexDirection: 'row' },
  alwaysAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ok,
    paddingHorizontal: 18,
  },
  editAddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  editGroupLabel: { marginTop: 14 },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  editInput: {
    backgroundColor: colors.bg2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontFamily: fonts.sans,
  },
  editName: { flex: 2 },
  editQtyInput: { flex: 1 },
  editDelete: { padding: 6 },
  // Prominent save button — a filled green check, so it's obvious the edit needs
  // committing (tapping another row abandons it).
  editSave: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowSurface: { backgroundColor: colors.bg },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },
  addBullet: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.line,
    marginTop: 1,
  },
  addInput: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
  },
  reminderBtn: { marginTop: 20 },
  viewSegment: { paddingBottom: 12 },
  detailEditRow: { flexDirection: 'row', gap: 8 },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  selectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  groupToggles: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  selectAllRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 6,
  },
  pushedSection: { marginTop: 24 },
  pushedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  pushedHeaderMain: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pushedCaretClosed: { transform: [{ rotate: '-90deg' }] },
  pushedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    opacity: 0.7,
  },
  pushedName: { flex: 1, textDecorationLine: 'line-through' },
  pushedDest: { fontSize: 12 },
  pushedAction: { paddingHorizontal: 4, paddingVertical: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  // Padded tap target around the 20x20 box so it's comfortably hittable.
  checkHit: { paddingRight: 4, paddingVertical: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  origin: { fontSize: 11, fontStyle: 'italic', paddingTop: 2 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  breakdown: { fontSize: 12, paddingTop: 2, lineHeight: 16 },
  sources: { paddingTop: 6, gap: 3 },
  sourceLine: { fontSize: 12, lineHeight: 16 },
  recipeList: { fontSize: 12, paddingTop: 2, lineHeight: 16 },
  qty: { fontSize: 14, fontWeight: '700', marginTop: 1, flexShrink: 0, marginLeft: 8 },
  pantryCard: { gap: 6 },
  empty: { textAlign: 'center', paddingVertical: 40 },
  revealCard: { gap: 8 },
  revealText: {
    fontFamily: fonts.mono,
    minHeight: 140,
    color: colors.text,
    fontSize: 13,
  },
  hint: { fontStyle: 'italic', textAlign: 'center' },
  extrasCaption: { fontSize: 11, fontStyle: 'italic', paddingBottom: 4 },
  twoCol: { flexDirection: 'row', gap: 36, alignItems: 'flex-start' },
  colLeft: { flex: 6, minWidth: 0, gap: 16 },
  colRight: { flex: 4, minWidth: 0, gap: 16 },
  onboard: {
    backgroundColor: colors.bg2,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  onboardText: { lineHeight: 19 },
  haveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  haveCaretClosed: { transform: [{ rotate: '-90deg' }] },
  likelyTag: {
    fontSize: 11,
    fontStyle: 'italic',
    backgroundColor: colors.lineSoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  outTag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    backgroundColor: colors.bg3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    textTransform: 'uppercase',
  },
  lowTag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    backgroundColor: colors.bg3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    textTransform: 'uppercase',
  },
  deleteAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 22,
    gap: 6,
  },
  haveAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ok,
    paddingHorizontal: 22,
    gap: 6,
  },
  deleteLabel: { fontSize: 13 },
  alwaysTag: {
    fontSize: 11,
    fontStyle: 'italic',
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.ok,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  menu: { gap: 6, paddingTop: 4 },
  menuTitle: { fontSize: 16, paddingBottom: 2 },
  menuHint: { fontStyle: 'italic', lineHeight: 18, paddingBottom: 6 },
  menuItem: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: 2,
  },
  menuItemHint: { fontSize: 12, fontStyle: 'italic' },
  menuCancel: {
    paddingTop: 16,
    paddingBottom: 2,
    alignItems: 'center',
  },
});
