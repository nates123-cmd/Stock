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
} from '@/components';
import { colors, fonts, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { useHaveStore } from '@/store/have';
import { useExtrasStore, type ExtraItem } from '@/store/extras';
import { usePantryStore } from '@/store/pantry';
import { useShopMetaStore } from '@/store/shopMeta';
import type { PantryStatus } from '@/types';
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

export default function ShoppingList() {
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
  const statusByKey = useMemo(() => {
    const m = new Map<string, PantryStatus>();
    for (const p of pantryItems) {
      const s = p.status ?? 'fine';
      if (s === 'fine') continue; // skip the default; only flag interesting states
      m.set(matchKey(p.canonicalName), s);
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [haveOpen, setHaveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealText, setRevealText] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
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
  const inHave = (name: string) => {
    const ps = statusFor(name);
    if (ps === 'out' || ps === 'low') return false;
    return isMarked(haveByName, name) || isAlwaysHave(name, alwaysHaveMap);
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

  const text = useMemo(() => instacartText(buyLines), [buyLines]);

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
  const wegmansCount = useMemo(
    () => buyLines.filter((l) => metaFor(l.name).store === 'wegmans').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buyLines, shopMetaMap],
  );
  const remainingLines = useMemo(
    () => buyLines.filter((l) => metaFor(l.name).store !== 'wegmans'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buyLines, shopMetaMap],
  );
  const pushToReminders = async () => {
    const url = remindersDeepLink(remainingLines.map(displayLabel));
    if (!url) {
      setHint('Nothing to send to Reminders.');
      return;
    }
    try {
      if (Platform.OS === 'web') window.location.href = url;
      else await Linking.openURL(url);
      setHint(
        `Sent ${remainingLines.length} to the "${REMINDERS_SHORTCUT}" Shortcut → Reminders "Shared Groceries."`,
      );
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

  /** Dismiss a consolidated row for this run (session-local). */
  const dismissItem = (name: string) =>
    setDismissed((prev) => new Set(prev).add(`item:${name}`));

  /** Delete a plan-derived row: session-hide it AND suppress it so it stays
   *  gone across future plan → shopping regen (note 7a). */
  const deleteItem = (name: string) => {
    suppress(name);
    dismissItem(name);
  };

  /** Mark a name always-have from the swipe action — never returns to any
   *  shopping list (note 7). Writes the ONE always-have source (#1). */
  const alwaysHaveIt = (name: string) => {
    setAlways(name, true);
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
    setAddName('');
    setAddQty('');
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

  const extraIdFor = (name: string): string | null =>
    extras.find((e) => e.canonicalName === name)?.id ?? null;

  /** Unified buy-row renderer (used by the by-store view). Resolves whether a
   *  line is an extra so delete routes correctly (removeExtra vs suppress). */
  const renderBuyRow = (line: ShoppingLine) => {
    const ps = statusFor(line.name);
    const extraId = extraIdFor(line.name);
    const meta = metaFor(line.name);
    return (
      <ShoppingRow
        key={`buy:${line.name}`}
        name={line.name}
        qty={line.buy}
        math={line.math ?? null}
        sources={line.sources}
        expanded={expanded.has(line.name)}
        storeName={meta.store ? storeLabel(meta.store) : null}
        onTap={() => toggleExpand(line.name)}
        onToggleHave={() => {
          if (ps === 'out') return;
          toggleHave(line.name);
        }}
        onDelete={() => (extraId ? removeExtra(extraId) : deleteItem(line.name))}
        onAlwaysHave={() => alwaysHaveIt(line.name)}
        onLongPress={() => setMenu({ name: line.name, extraId })}
        marked={false}
        always={false}
        likely={isLikelyHave(haveByName, line.name)}
        pantryStatus={ps}
      />
    );
  };

  // By-store buckets (note 3): Wegmans · Costco · Stop One · Unassigned.
  const storeBuckets = [
    ...STORES.map((s) => ({ id: s.id as StoreId | null, label: s.label })),
    { id: null as StoreId | null, label: 'Unassigned' },
  ]
    .map((b) => ({
      ...b,
      lines: buyLines.filter((l) => (metaFor(l.name).store ?? null) === b.id),
    }))
    .filter((b) => b.lines.length > 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Heading variant="screenTitle">Shopping list</Heading>
          <Text color="textMuted">
            {weekRecipes.length} recipes
            {selectedEntryIds ? '' : ` · ${weekRangeLabel(weekStart)}`}
            {refining ? ' · estimating…' : ''}
          </Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Done
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.summary}>
          <SummaryRow label="To buy" value={`${buyCount}`} tone="accent" />
          <SummaryRow label="Already have" value={`${haveCount}`} tone="ok" />
        </Card>

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
        {showOnboard && (visibleItems.length > 0 || extras.length > 0) ? (
          <Pressable onPress={dismissOnboard} style={styles.onboard}>
            <Text color="textMuted" style={styles.onboardText}>
              <Text variant="bodyStrong" color="text">
                Tap a row to drop it
              </Text>{' '}
              — “already have.” Swipe left to delete from this run, swipe right
              to mark have.{' '}
              <Text color="textFaint">(tap here to dismiss)</Text>
            </Text>
          </Pressable>
        ) : null}

        {visibleItems.length > 0 || extras.length > 0 ? (
          <View style={styles.controlsRow}>
            <View style={styles.groupToggle}>
              <Pressable
                onPress={() => setGroupByStore(false)}
                style={[styles.groupBtn, !groupByStore && styles.groupBtnOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: !groupByStore }}>
                <Text
                  variant="sectionLabel"
                  color={!groupByStore ? 'bg' : 'textMuted'}>
                  By category
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setGroupByStore(true)}
                style={[styles.groupBtn, groupByStore && styles.groupBtnOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: groupByStore }}>
                <Text
                  variant="sectionLabel"
                  color={groupByStore ? 'bg' : 'textMuted'}>
                  By store
                </Text>
              </Pressable>
            </View>
            {checkedNames.length > 0 ? (
              <Pressable onPress={clearChecked} hitSlop={6} accessibilityRole="button">
                <Text variant="sectionLabel" color="accent">
                  Clear checked · {checkedNames.length}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={wide ? styles.twoCol : undefined}>
          <View style={wide ? styles.colLeft : undefined}>
        {visibleItems.length === 0 && extras.length === 0 ? (
          <Text color="textMuted" style={styles.empty}>
            Nothing planned for this week yet. Pin recipes on the Plan tab.
          </Text>
        ) : groupByStore ? (
          storeBuckets.map((bucket) => (
            <View key={bucket.label} style={styles.section}>
              <SectionLabel color={bucket.id ? 'text' : 'textMuted'}>
                {bucket.label} · {bucket.lines.length}
              </SectionLabel>
              {bucket.lines.map((line) => renderBuyRow(line))}
            </View>
          ))
        ) : (
          CATEGORY_ORDER.filter((c) =>
            visibleItems.some((i) => i.category === c && !inHave(i.name)),
          ).map((cat) => (
            <View key={cat} style={styles.section}>
              <SectionLabel color="textMuted">{CAT_LABEL[cat]}</SectionLabel>
              {visibleItems
                .filter((i) => i.category === cat && !inHave(i.name))
                .map((item) => {
                  const ps = statusFor(item.name);
                  const meta = metaFor(item.name);
                  return (
                    <ShoppingRow
                      key={item.name}
                      name={item.name}
                      qty={item.buy}
                      math={item.math ?? null}
                      sources={item.sources}
                      expanded={expanded.has(item.name)}
                      storeName={meta.store ? storeLabel(meta.store) : null}
                      onTap={() => toggleExpand(item.name)}
                      onToggleHave={() => {
                        // Spec §5: 'out' suppresses the have toggle.
                        if (ps === 'out') return;
                        toggleHave(item.name);
                      }}
                      onDelete={() => deleteItem(item.name)}
                      onAlwaysHave={() => alwaysHaveIt(item.name)}
                      onLongPress={() => setMenu({ name: item.name, extraId: null })}
                      marked={false}
                      always={false}
                      likely={isLikelyHave(haveByName, item.name)}
                      pantryStatus={ps}
                    />
                  );
                })}
            </View>
          ))
        )}

        {!groupByStore && extras.some((e) => !inHave(e.canonicalName)) ? (
          <View style={styles.section}>
            <SectionLabel color="textMuted">Extras</SectionLabel>
            <Text color="textFaint" style={styles.extrasCaption}>
              Items you added outside the week’s recipes (from Pipeline ideas, etc.).
            </Text>
            {extras
              .filter((e) => !inHave(e.canonicalName))
              .slice()
              .sort(
                (a, b) =>
                  CATEGORY_ORDER.indexOf(categorizeIngredient(a.canonicalName)) -
                    CATEGORY_ORDER.indexOf(categorizeIngredient(b.canonicalName)) ||
                  a.canonicalName.localeCompare(b.canonicalName),
              )
              .map((ex) => {
                const ps = statusFor(ex.canonicalName);
                const meta = metaFor(ex.canonicalName);
                return (
                  <ShoppingRow
                    key={ex.id}
                    name={ex.canonicalName}
                    qty={extraQty(ex)}
                    math={null}
                    origin={ex.originLabel}
                    storeName={meta.store ? storeLabel(meta.store) : null}
                    onTap={() => {
                      /* extras are flat — nothing to expand */
                    }}
                    onToggleHave={() => {
                      if (ps === 'out') return;
                      toggleHave(ex.canonicalName);
                    }}
                    onDelete={() => removeExtra(ex.id)}
                    onAlwaysHave={() => alwaysHaveIt(ex.canonicalName)}
                    onLongPress={() =>
                      setMenu({ name: ex.canonicalName, extraId: ex.id })
                    }
                    marked={false}
                    always={false}
                    likely={isLikelyHave(haveByName, ex.canonicalName)}
                    pantryStatus={ps}
                  />
                );
              })}
          </View>
        ) : null}

        {!groupByStore && pantryRestockLines.some((p) => !dismissed.has(`item:${p.name}`)) ? (
          <View style={styles.section}>
            <SectionLabel color="accent">Running low · restock</SectionLabel>
            <Text color="textFaint" style={styles.extrasCaption}>
              Staples you flagged low or out in the pantry. Tap a row to drop it
              if you’ve got enough.
            </Text>
            {pantryRestockLines
              .filter((p) => !dismissed.has(`item:${p.name}`))
              .map((p) => {
                const ps = statusFor(p.name);
                return (
                  <ShoppingRow
                    key={`pantry:${p.name}`}
                    name={p.name}
                    qty={p.buy}
                    math={null}
                    onTap={() => {
                      // 'out' is locked on; 'low' drops for this run on tap.
                      if (ps !== 'out') dismissItem(p.name);
                    }}
                    onToggleHave={() => {
                      if (ps === 'out') return;
                      dismissItem(p.name);
                    }}
                    onDelete={() => dismissItem(p.name)}
                    onLongPress={() => setMenu({ name: p.name, extraId: null })}
                    marked={false}
                    always={false}
                    likely={false}
                    pantryStatus={ps}
                  />
                );
              })}
          </View>
        ) : null}
          </View>
          <View style={wide ? styles.colRight : undefined}>

        {haveCount > 0 ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setHaveOpen((v) => !v)}
              style={styles.haveHeader}
              accessibilityRole="button"
              accessibilityLabel={
                haveOpen
                  ? 'Collapse already-have list'
                  : 'Expand already-have list'
              }>
              <SectionLabel color="ok">
                Already have · {haveCount}
              </SectionLabel>
              <Glyph
                name="expand"
                size={14}
                color="ok"
                style={haveOpen ? undefined : styles.haveCaretClosed}
              />
            </Pressable>
            {haveOpen ? (
              <>
                {visibleItems
                  .filter((i) => inHave(i.name))
                  .map((item) => {
                    const isAlways =
                      alwaysHaveMap[item.name.toLowerCase().trim()] === true;
                    return (
                      <ShoppingRow
                        key={`have:${item.name}`}
                        name={item.name}
                        qty={item.buy}
                        math={null}
                        onTap={() => toggleHave(item.name)}
                        onToggleHave={() => toggleHave(item.name)}
                        onDelete={() => dismissItem(item.name)}
                        onLongPress={() =>
                          setMenu({ name: item.name, extraId: null })
                        }
                        marked
                        always={isAlways}
                        likely={false}
                      />
                    );
                  })}
                {extras
                  .filter((e) => inHave(e.canonicalName))
                  .map((ex) => {
                    const isAlways =
                      alwaysHaveMap[ex.canonicalName.toLowerCase().trim()] === true;
                    return (
                      <ShoppingRow
                        key={`have:${ex.id}`}
                        name={ex.canonicalName}
                        qty={extraQty(ex)}
                        math={null}
                        origin={ex.originLabel}
                        onTap={() => toggleHave(ex.canonicalName)}
                        onToggleHave={() => toggleHave(ex.canonicalName)}
                        onDelete={() => removeExtra(ex.id)}
                        onLongPress={() =>
                          setMenu({ name: ex.canonicalName, extraId: ex.id })
                        }
                        marked
                        always={isAlways}
                        likely={false}
                      />
                    );
                  })}
                {ghostAlways.map((name) => (
                  <ShoppingRow
                    key={`ghost:${name}`}
                    name={name}
                    qty="—"
                    math={null}
                    onTap={() => setMenu({ name, extraId: null })}
                    onToggleHave={() => {
                      // Ghost row toggle = unpin always-have. (Session-mark
                      // would be meaningless here — no buy row exists.)
                      setAlways(name, false);
                    }}
                    onDelete={() => setAlways(name, false)}
                    onLongPress={() => setMenu({ name, extraId: null })}
                    marked
                    always
                    likely={false}
                  />
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        <Card tone="bg2" style={styles.pantryCard}>
          <SectionLabel color="ok">Pantry subtraction (§10)</SectionLabel>
          <Text color="textMuted">
            The Pantry pillar replaces this with tracked stock + expiry —
            “Already have” is its lightweight precursor.
          </Text>
        </Card>
          </View>
        </View>

        {buyLines.length > 0 ? (
          <Card tone="bg2" style={styles.routeCard}>
            <SectionLabel color="textMuted">Fulfillment</SectionLabel>
            <Text color="textFaint" style={styles.routeCaption}>
              Wegmans-tagged items go via Instacart. Everything else (Stop One +
              unassigned) goes to the Apple Reminders list “Shared Groceries.”
            </Text>
            <Button
              label={`Add remaining to Reminders · ${remainingLines.length}`}
              glyph="next"
              variant="secondary"
              disabled={remainingLines.length === 0}
              onPress={pushToReminders}
            />
          </Card>
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
            onSetStore={(store) => setShopMeta(menu.name, { store })}
            onSetField={(patch) => setShopMeta(menu.name, patch)}
            onToggleAlways={() => {
              setAlways(menu.name, !isAlwaysHave(menu.name, alwaysHaveMap));
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

      <BottomActionBar
        meta={
          wegmansCount > 0 ? (
            <Text color="textFaint">
              {wegmansCount} tagged Wegmans — order via Instacart
            </Text>
          ) : undefined
        }>
        {editing ? (
          <Button
            label="Confirm"
            glyph="done"
            flex
            onPress={() => setEditing(false)}
          />
        ) : (
          <>
            <Button
              label="Edit list"
              variant="secondary"
              flex
              onPress={() => setEditing(true)}
            />
            <Button
              label={copied ? 'Copied — Instacart opening' : 'Copy → Instacart'}
              glyph="next"
              flex
              disabled={buyLines.length === 0}
              onPress={copyAndOpen}
            />
          </>
        )}
      </BottomActionBar>
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
  onTap: () => void;
  onToggleHave: () => void;
  onDelete: () => void;
  /** Swipe-left "Always have it" — never returns to any list (note 7). */
  onAlwaysHave?: () => void;
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
  onTap,
  onToggleHave,
  onDelete,
  onAlwaysHave,
  onLongPress,
}: RowProps) {
  // Swipe semantics — asymmetric by direction (spec §5):
  // - Swipe right → commits Have toggle on open (reversible binary toggle).
  // - Swipe left → reveals a tappable Delete button; requires a second tap
  //   to commit because delete is destructive (consolidated rows lose group
  //   context, Extras rows go for good).
  const swipeRef = useRef<SwipeableMethods | null>(null);
  // onSwipeableOpen reports the drag direction: a rightward drag reveals the
  // left actions (Have), a leftward drag reveals the right actions (Delete).
  const handleOpen = (dir: 'left' | 'right') => {
    if (dir === 'right') {
      // Swipe right → Have toggle — commit-on-open, snap closed.
      swipeRef.current?.close();
      onToggleHave();
    }
    // dir === 'left' → Delete panel revealed; user must tap the Delete button.
  };
  const handleDeletePress = () => {
    swipeRef.current?.close();
    onDelete();
  };
  const handleAlwaysPress = () => {
    swipeRef.current?.close();
    onAlwaysHave?.();
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
          {onAlwaysHave ? (
            <GHPressable
              onPress={handleAlwaysPress}
              style={styles.alwaysAction}
              accessibilityRole="button"
              accessibilityLabel={`Always have ${name} — never show it again`}>
              <Text color="bg" variant="bodyStrong" style={styles.deleteLabel}>
                Always
              </Text>
            </GHPressable>
          ) : null}
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
        <GHPressable
          style={styles.item}
          onPress={onTap}
          onLongPress={onLongPress}
          delayLongPress={350}>
          <GHPressable
            hitSlop={10}
            onPress={onToggleHave}
            // Polarity: filled = "shopping for it" (the default), empty =
            // "already have it" (the user dropped it). The list IS the buy
            // list, so the rest state is checked.
            style={[styles.check, !marked && styles.checkOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !marked }}
            accessibilityLabel={
              marked
                ? `Move ${name} back to the shopping list`
                : `Drop ${name} — already have it`
            }>
            {!marked ? <Glyph name="done" size={12} color="bg" /> : null}
          </GHPressable>
          <View style={styles.flex}>
            <View style={styles.nameRow}>
              <Text color={marked ? 'textFaint' : 'text'}>
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
            {isAlways ? 'Remove “always have” pin' : 'Always have'}
          </Text>
          <Text color="textFaint" style={styles.menuItemHint}>
            {isAlways
              ? 'Will surface as a regular buy item again.'
              : 'Never lands on any shopping list again (salt, oil, tahini…).'}
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
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
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
