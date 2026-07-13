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
import type { PantryLocation, PantryStatus } from '@/types';
import { matchKey } from '@/lib/pantry';
import { alwaysHaveKey, isAlwaysHave } from '@/lib/alwaysHave';
import {
  STORES,
  storeLabel,
  remindersDeepLink,
  REMINDERS_SHORTCUT,
  type ShopMeta,
  type StoreId,
} from '@/lib/shopStores';
import { reviewGroups } from '@/lib/cartCombine';
import { dateKey, startOfWeek, weekDays, weekRangeLabel } from '@/lib/week';
import {
  consolidateSmart,
  consolidateLocalSmart,
  splitMerged,
  instacartText,
  CATEGORY_ORDER,
  categorizeIngredient,
  type ShoppingLine,
  type ShoppingSource,
} from '@/lib/shopping';
import { formatAmount } from '@/lib/format';
import { sendToInstacart, toJobItems, INSTACART_AVAILABLE } from '@/lib/instacart';
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
  const hydratePushed = usePushedStore((s) => s.hydrate);
  const prunePushed = usePushedStore((s) => s.prune);
  useEffect(() => {
    void hydratePushed();
    prunePushed();
  }, [hydratePushed, prunePushed]);
  // Subscribe to have-state so rows re-render on tap (we use the Map directly
  // for derived booleans below, but the selector keeps us reactive).
  const haveByName = useHaveStore((s) => s.byName);
  const alwaysHaveMap = useHaveStore((s) => s.alwaysHave);
  const markHave = useHaveStore((s) => s.mark);
  const unmarkHave = useHaveStore((s) => s.unmark);
  const setAlways = useHaveStore((s) => s.setAlways);

  // Phase D: per-name suppression (deleted plan-derived items stay gone across
  // regen — note 7a) + optional store tag / detail (note 3).
  const suppressedMap = useShopMetaStore((s) => s.suppressed);
  const suppress = useShopMetaStore((s) => s.suppress);
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
  const statusByKey = useMemo(() => {
    const m = new Map<string, PantryStatus>();
    for (const p of pantryItems) {
      const s = p.status ?? 'fine';
      if (s === 'fine') continue; // skip the default; only flag interesting states
      m.set(matchKey(p.canonicalName), s);
    }
    return m;
  }, [pantryItems]);
  /** When each low/out flag was raised — so we can tell a FRESH flag from one
   *  that was already standing when the user deferred the item to Staples. */
  const statusAtByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pantryItems) {
      const s = p.status ?? 'fine';
      if (s === 'fine') continue;
      const at = p.statusUpdatedAt ? new Date(p.statusUpdatedAt).getTime() : 0;
      m.set(matchKey(p.canonicalName), at);
    }
    return m;
  }, [pantryItems]);
  const statusFor = (name: string): PantryStatus | undefined => {
    const k = matchKey(name);
    if (statusByKey.has(k)) return statusByKey.get(k);
    // Allow loose match: pantry record's key is a substring of the shopping
    // canonical (or vice versa). Mirrors the applyPaste/restock logic.
    for (const [pk, s] of statusByKey) {
      if (pk.startsWith(k) || k.startsWith(pk)) return s;
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
  const [menu, setMenu] = useState<{
    name: string;
    extraId: string | null;
  } | null>(null);
  /** Buy-confirm sheet (the buy loop). Checking a row off opens this to place
   *  the item into the pantry (location + qty) before it leaves the list. */
  const [buying, setBuying] = useState<{ name: string; qty: string } | null>(null);
  /** Shop view grouping: by shelf category (default) or by store tag (note 3). */
  const [groupByStore, setGroupByStore] = useState(false);

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
  const [items, setItems] = useState<ShoppingLine[]>([]);
  const [refining, setRefining] = useState(false);
  useEffect(() => {
    setItems(consolidateLocalSmart(weekRecipes));
    if (weekRecipes.length === 0) {
      setRefining(false);
      return;
    }
    let cancelled = false;
    setRefining(true);
    consolidateSmart(weekRecipes)
      .then((r) => !cancelled && setItems(r))
      .catch(() => {})
      .finally(() => !cancelled && setRefining(false));
    return () => {
      cancelled = true;
    };
  }, [weekRecipes]);

  // Cart-combine review (note 5) — DISTINCT from the Cook combine timeline.
  // The consolidation groups the SAME ingredient from several recipes into one
  // buy line; rather than trust that silently, surface each multi-recipe group
  // for a one-at-a-time decision: Combine (default) / Keep separate / Edit qty.
  const combineGroups = useMemo(() => reviewGroups(items), [items]);
  const [combineReviewed, setCombineReviewed] = useState(false);
  const [combineOpen, setCombineOpen] = useState(false);
  /** per-group decision, persisted for the session: absent/'combine' = merged. */
  const [combineDecisions, setCombineDecisions] = useState<
    Record<string, 'combine' | 'separate'>
  >({});
  useEffect(() => {
    if (!refining && !combineReviewed && combineGroups.length > 0) setCombineOpen(true);
  }, [refining, combineReviewed, combineGroups.length]);
  const decideCombine = (name: string, choice: 'combine' | 'separate') =>
    setCombineDecisions((prev) => ({ ...prev, [name]: choice }));
  const applyCombineReview = () => {
    const separate = Object.entries(combineDecisions)
      .filter(([, c]) => c === 'separate')
      .map(([n]) => n);
    if (separate.length > 0) {
      const set = new Set(separate);
      setItems((prev) =>
        prev.flatMap((line) => (set.has(line.name) ? splitMerged(line) : [line])),
      );
    }
    setCombineReviewed(true);
    setCombineOpen(false);
  };

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
  /** When was this name flagged low/out (0 if not flagged)? Mirrors statusFor's
   *  loose matching so the two always agree about the same pantry row. */
  const statusAtFor = (name: string): number => {
    const k = matchKey(name);
    const direct = statusAtByKey.get(k);
    if (direct !== undefined) return direct;
    for (const [pk, at] of statusAtByKey) {
      if (pk.startsWith(k) || k.startsWith(pk)) return at;
    }
    return 0;
  };

  /** Is this name off the Active list?
   *
   *  A staple pin (= "Move to Staples") hides it. The wrinkle is low/out: we
   *  auto-surface a staple onto Active when it runs low — but that rule used to
   *  beat the pin outright, so you could NEVER park something that was already
   *  low (pine nuts: flagged low, so "Move to Staples" appeared to do nothing).
   *
   *  So an EXPLICIT defer wins over a low/out flag that was already standing
   *  when you deferred. A flag raised AFTER the defer is fresh news and still
   *  pulls the item back onto Active. */
  const inHave = (name: string) => {
    const pinned = isAlwaysHave(name, alwaysHaveMap);
    const ps = statusFor(name);
    if (ps === 'out' || ps === 'low') {
      if (!pinned) return false;
      const deferredAt = metaFor(name).deferredAt;
      // Pinned but never explicitly deferred → the auto-surface rule applies.
      if (!deferredAt) return false;
      // Flagged again since you deferred it → surface it.
      if (statusAtFor(name) > new Date(deferredAt).getTime()) return false;
      // Stale flag + explicit defer → stay parked in Staples.
      return true;
    }
    return isMarked(haveByName, name) || pinned;
  };

  /** The ONE way to move an item to Staples / back to Active. Stamps the defer
   *  time on the way in (so a standing low/out flag can't drag it straight back
   *  out) and clears it on the way back. Every pin path goes through here. */
  const pinStaple = (name: string, on: boolean) => {
    setAlways(name, on);
    setShopMeta(name, { deferredAt: on ? new Date().toISOString() : undefined });
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

  /** Names the user pushed to a channel in the last ~2 days — dropped from the
   *  active list, parked in the collapsed "Pushed" section. */
  const pushedSet = useMemo(
    () => new Set(pushedItems.map((e) => e.key)),
    [pushedItems],
  );

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
      .filter((e) => !inHave(e.canonicalName))
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
  }, [visibleItems, extras, haveByName, alwaysHaveMap, pantryRestockLines, dismissed]);

  /** The active list, folded flat (minimalist, Reminders-style). Recipe items,
   *  manual adds, and low/out restock staples in one ordered list — no category
   *  or store sections. Items marked "have" (swiped right) or pushed in the last
   *  ~2 days drop out. `name`/`qty` reflect any inline-edit override; `baseName`
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
  };
  const allRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    const ov = (base: string, qty: string) => {
      const o = overrides[matchKey(base)];
      return { name: o?.name || base, qty: o?.qty ?? qty };
    };
    const gone = (base: string) => inHave(base) || pushedSet.has(matchKey(base));
    for (const i of visibleItems) {
      if (gone(i.name)) continue;
      const e = ov(i.name, i.buy);
      rows.push({
        key: `r:${i.name}`,
        name: e.name,
        baseName: i.name,
        qty: e.qty,
        extraId: null,
        pantryStatus: statusFor(i.name),
        kind: 'recipe',
      });
    }
    for (const ex of extras) {
      // A staple pin hides the row from Active — that IS "Move to Staples", and
      // it has to apply to manual adds too, or the row lives in both views at
      // once. Adding a name on Active that's currently pinned un-pins it (see
      // submitAdd), so an explicit "I want this now" still lands here.
      if (gone(ex.canonicalName)) continue;
      rows.push({
        key: `e:${ex.id}`,
        name: ex.canonicalName,
        baseName: ex.canonicalName,
        qty: extraQty(ex),
        extraId: ex.id,
        origin: ex.originLabel,
        pantryStatus: statusFor(ex.canonicalName),
        kind: 'extra',
      });
    }
    for (const p of pantryRestockLines) {
      // `gone` (not just dismissed/pushed): a low/out staple you explicitly
      // deferred must not sneak back in through the restock door.
      if (dismissed.has(`item:${p.name}`) || gone(p.name)) continue;
      const e = ov(p.name, p.buy);
      rows.push({
        key: `p:${p.name}`,
        name: e.name,
        baseName: p.name,
        qty: e.qty,
        extraId: null,
        pantryStatus: statusFor(p.name),
        kind: 'restock',
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, pantryRestockLines, dismissed, overrides, pushedSet, haveByName, alwaysHaveMap, statusByKey, statusAtByKey, shopMetaMap]);

  /** Active = the dominant "get this now" list. `allRows` already excludes
   *  staples (the always-have pin hides them via inHave) EXCEPT when they're
   *  flagged low/out, which auto-surfaces them here. */
  const activeRows = allRows;

  /** Staples = the tucked-away pile you toggle to. "We need pine nuts — but not
   *  soon." Pinning an item a staple (long-press) parks it here, out of Active,
   *  for as long as it needs; the pin persists (always-have, IndexedDB). It
   *  comes back to Active on its own when flagged low/out. */
  const stapleRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    // An item lives in exactly ONE view. A staple that's flagged low/out is
    // auto-surfaced onto Active as a restock line — don't also list it here, or
    // it reads as a duplicate.
    const onActive = new Set(activeRows.map((r) => matchKey(r.baseName)));
    for (const key of Object.keys(alwaysHaveMap)) {
      if (!alwaysHaveMap[key] || pushedSet.has(key) || onActive.has(key)) continue;
      const ex = extras.find((e) => matchKey(e.canonicalName) === key);
      const it = visibleItems.find((i) => matchKey(i.name) === key);
      const base = ex?.canonicalName ?? it?.name ?? key;
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
    return rows.sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysHaveMap, extras, visibleItems, overrides, pushedSet, statusByKey, activeRows]);

  /** Rows for whichever view you're on; selection + push read from these. */
  const currentRows = listView === 'active' ? activeRows : stapleRows;

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
  const displayLabel = (l: ShoppingLine): string => {
    const m = metaFor(l.name);
    const qty = m.qty || (l.buy && l.buy !== 'as needed' ? l.buy : '');
    const base = l.name.charAt(0).toUpperCase() + l.name.slice(1);
    return qty ? `${base}, ${qty}` : base;
  };
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
    for (const e of extras) if (inHave(e.canonicalName)) n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, haveByName, alwaysHaveMap, ghostAlways]);

  const buyCount = buyLines.length;

  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleHave = (name: string) => {
    if (isMarked(haveByName, name)) unmarkHave(name);
    else markHave(name);
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

  /** "Already had it": clear the row without touching the pantry. */
  const skipBuy = () => {
    if (!buying) return;
    markHave(buying.name);
    if (showOnboard) dismissOnboard();
    setBuying(null);
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
      if (isMarked(haveByName, i.name) && !isAlwaysHave(i.name, alwaysHaveMap))
        out.push({ name: i.name, extraId: null });
    for (const e of extras)
      if (isMarked(haveByName, e.canonicalName) && !isAlwaysHave(e.canonicalName, alwaysHaveMap))
        out.push({ name: e.canonicalName, extraId: e.id });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, haveByName, alwaysHaveMap]);
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

  /** Add a manual item to the list via the extras store (spec §10). */
  const submitAdd = () => {
    const name = addName.trim();
    if (!name) return;
    const { amount, unit } = parseQty(addQty);
    addExtra([
      { canonicalName: name, amount, unit, originLabel: 'added by you', originId: null },
    ]);
    // Adding while on Staples pins it, so it lands there instead of Active —
    // "note the pine nuts, don't put them in my face." Adding on Active is the
    // opposite intent ("I want this now"), so it UN-pins a name that's currently
    // a staple; otherwise the new row would be hidden by its own pin.
    pinStaple(name, listView === 'staples');
    setAddName('');
    setAddQty('');
  };

  /** Delete every checked row. Routes each one the same way a single-row swipe
   *  delete does: on Staples it un-pins (back to Active) rather than destroying;
   *  extras go for good, restock rows drop for the run, plan rows suppress so
   *  they stay gone across regen. */
  const deleteSelected = () => {
    for (const row of selectedRows) {
      if (listView === 'staples') pinStaple(row.baseName, false);
      else if (row.extraId) removeExtra(row.extraId);
      else if (row.kind === 'restock') dismissItem(row.baseName);
      else deleteItem(row.baseName);
    }
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
    const markPushed = () => {
      pushToPushed(rows.map((r) => r.baseName), 'wegmans');
      clearSelection();
    };
    if (!INSTACART_AVAILABLE()) {
      setHint('Not signed in — copying the list and opening Instacart to paste.');
      await copyAndOpen();
      markPushed();
      return;
    }
    try {
      setSending(true);
      setHint('Pushing to your Wegmans cart…');
      await sendToInstacart(
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
      setHint('Pushed. The cart is filling — open Instacart in ~30s, review, pick Pickup.');
      markPushed();
    } catch (e) {
      setHint(`Couldn't push: ${(e as Error).message}`);
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
  const commitEdit = (row: FlatRow) => {
    const name = editName.trim() || row.name;
    const qty = editQty.trim();
    if (row.extraId) {
      const { amount, unit } = parseQty(qty);
      updateExtra(row.extraId, { canonicalName: name, amount, unit });
    } else {
      setOverrides((prev) => ({
        ...prev,
        [matchKey(row.baseName)]: { name, qty },
      }));
    }
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
          style={styles.editDelete}
          accessibilityLabel={`Save ${row.name}`}>
          <Glyph name="done" size={18} color="ok" />
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
        onDelete={() =>
          listView === 'staples'
            ? pinStaple(row.baseName, false) // unpin → back to the active list
            : row.extraId
              ? removeExtra(row.extraId)
              : row.kind === 'restock'
                ? dismissItem(row.baseName)
                : deleteItem(row.baseName)
        }
        onLongPress={() => setMenu({ name: row.baseName, extraId: row.extraId })}
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
              { key: 'active', label: 'Active', count: activeRows.length },
              { key: 'staples', label: 'Staples', count: stapleRows.length },
            ]}
            value={listView}
            onChange={(k) => switchView(k as 'active' | 'staples')}
          />
        </View>

        {currentRows.length > 0 ? (
          <View style={styles.selectAllRow}>
            <Pressable onPress={toggleSelectAll} hitSlop={6} accessibilityRole="button">
              <Text variant="sectionLabel" color="accent">
                {allSelected ? 'Deselect all' : 'Select all'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {currentRows.map(renderRow)}

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

        {/* Pushed: what went out to Wegmans/Reminders in the last ~2 days.
            Collapsed by default; tap a row to pull it back onto the list. */}
        {listView === 'active' && pushedItems.length > 0 ? (
          <View style={styles.pushedSection}>
            <Pressable
              onPress={() => setPushedOpen((v) => !v)}
              style={styles.pushedHeader}
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
            {pushedOpen
              ? pushedItems.map((e) => (
                  <Pressable
                    key={`pushed:${e.key}`}
                    style={styles.pushedRow}
                    onPress={() => restorePushed(e.key)}
                    accessibilityRole="button"
                    accessibilityLabel={`Move ${e.name} back to the list`}>
                    <Text color="textFaint" style={styles.pushedName} numberOfLines={1}>
                      {e.name}
                    </Text>
                    <Text color="textFaint" style={styles.pushedDest}>
                      {e.dest === 'wegmans' ? 'Wegmans' : 'Reminders'}
                    </Text>
                  </Pressable>
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
            extraId={menu.extraId}
            meta={metaFor(menu.name)}
            isAlways={isAlwaysHave(menu.name, alwaysHaveMap)}
            // Picking a store is a discrete action — and picking Costco DEFERS
            // the row into the collapsed Costco pile, so it vanishes from the
            // active list. Close the sheet so you see that happen.
            onSetStore={(store) => {
              setShopMeta(menu.name, { store });
              setMenu(null);
            }}
            onSetField={(patch) => setShopMeta(menu.name, patch)}
            onToggleAlways={() => {
              pinStaple(menu.name, !isAlwaysHave(menu.name, alwaysHaveMap));
              setMenu(null);
            }}
            onDelete={() => {
              if (menu.extraId) removeExtra(menu.extraId);
              else deleteItem(menu.name);
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

      <Overlay visible={combineOpen} onClose={applyCombineReview}>
        <View style={styles.combineSheet}>
          <Heading variant="recipeTitle">Combine duplicates?</Heading>
          <Text color="textMuted">
            The same item showed up in more than one recipe. Combine, or keep
            them separate.
          </Text>
          <ScrollView style={styles.combineScroll}>
            {combineGroups.map((g) => {
              const choice = combineDecisions[g.name] ?? 'combine';
              return (
                <View key={g.name} style={styles.combineCard}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {g.name}
                  </Text>
                  <Text color="textFaint" style={styles.combineSources} numberOfLines={3}>
                    {g.perSource.join(' · ')}
                  </Text>
                  <Text color={g.convertible ? 'ok' : 'warn'} style={styles.combineSuggest}>
                    {choice === 'separate'
                      ? 'Keeping separate'
                      : `→ Combine to ${g.suggestion}`}
                    {!g.convertible && choice !== 'separate' ? ' (mixed units)' : ''}
                  </Text>
                  <View style={styles.combineActions}>
                    <Pressable
                      onPress={() => decideCombine(g.name, 'combine')}
                      style={[
                        styles.combineBtn,
                        choice === 'combine' && styles.combineBtnOn,
                      ]}
                      accessibilityRole="button">
                      <Text
                        variant="sectionLabel"
                        color={choice === 'combine' ? 'bg' : 'textMuted'}>
                        Combine
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => decideCombine(g.name, 'separate')}
                      style={[
                        styles.combineBtn,
                        choice === 'separate' && styles.combineBtnOn,
                      ]}
                      accessibilityRole="button">
                      <Text
                        variant="sectionLabel"
                        color={choice === 'separate' ? 'bg' : 'textMuted'}>
                        Keep separate
                      </Text>
                    </Pressable>
                    <TextInput
                      defaultValue={g.suggestion}
                      onEndEditing={(e) => {
                        const t = e.nativeEvent.text.trim();
                        if (t) {
                          editItemQty(g.name, t);
                          decideCombine(g.name, 'combine');
                        }
                      }}
                      placeholder="Edit qty"
                      placeholderTextColor={colors.textFaint}
                      style={[styles.editInput, styles.combineQty]}
                      accessibilityLabel={`Edit combined quantity for ${g.name}`}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Button label="Done" glyph="done" flex onPress={applyCombineReview} />
        </View>
      </Overlay>

      {/* Push bar pops up only while ≥1 row is selected (Reminders-style). */}
      {selectedRows.length > 0 ? (
        <BottomActionBar
          meta={
            <View style={styles.selectMeta}>
              <Pressable onPress={clearSelection} hitSlop={6} accessibilityRole="button">
                <Text color="textFaint">{selectedRows.length} selected · tap to deselect</Text>
              </Pressable>
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
          <Button
            label={`Push to Reminders · ${selectedRows.length}`}
            variant="secondary"
            flex
            onPress={pushToReminders}
          />
          <Button
            label={sending ? 'Pushing…' : `Push to Wegmans · ${selectedRows.length}`}
            glyph="next"
            flex
            disabled={sending}
            onPress={pushToWegmans}
          />
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

/** Strikethrough state: "marked" within the current shop run (last 6h). */
function isMarked(
  byName: Record<string, { count: number; lastAt: Date }>,
  name: string,
): boolean {
  const r = byName[name.toLowerCase().trim()];
  if (!r) return false;
  const at = r.lastAt instanceof Date ? r.lastAt.getTime() : new Date(r.lastAt).getTime();
  return Date.now() - at < 6 * 60 * 60 * 1000;
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
  meta,
  isAlways,
  onSetStore,
  onSetField,
  onToggleAlways,
  onDelete,
  onClose,
}: {
  name: string;
  extraId: string | null;
  meta: ShopMeta;
  isAlways: boolean;
  onSetStore: (store: StoreId | null) => void;
  onSetField: (patch: ShopMeta) => void;
  onToggleAlways: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <ScrollView style={styles.detailScroll}>
      <View style={styles.menu}>
        <Text variant="bodyStrong" style={styles.menuTitle}>
          {name}
        </Text>

        <SectionLabel color="textMuted">Store</SectionLabel>
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
          Quantity
        </SectionLabel>
        <TextInput
          defaultValue={meta.qty ?? ''}
          onEndEditing={(e) => onSetField({ qty: e.nativeEvent.text })}
          placeholder="e.g. 2 bags"
          placeholderTextColor={colors.textFaint}
          style={styles.editInput}
        />
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
            {isAlways ? 'Move back to Active' : 'Move to Staples'}
          </Text>
          <Text color="textFaint" style={styles.menuItemHint}>
            {isAlways
              ? 'Back on the active list as a regular buy item.'
              : 'Off the active list — parked in Staples until you want it, or until it runs low.'}
          </Text>
        </Pressable>
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
  selectMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  selectAllRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingBottom: 6 },
  pushedSection: { marginTop: 24 },
  pushedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
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
