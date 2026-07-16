import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text, Heading, Numeric, SectionLabel, Glyph, Button, BottomActionBar, Overlay } from '@/components';
import { colors, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { usePantryStore } from '@/store/pantry';
import { useHaveStore } from '@/store/have';
import { useExtrasStore } from '@/store/extras';
import { dateKey } from '@/lib/week';
import { matchKey, looksLikeSameItem } from '@/lib/pantry';
import { formatAmount } from '@/lib/format';
import { sumQtyStrings, parseQty, isMixedUnits } from '@/lib/qty';
import { reconcileQty } from '@/lib/qtyReconcile';
import type { Ingredient, PantryStatus, Recipe } from '@/types';

/**
 * Build-shopping-list wizard (PLAN-SHOP-FLOW.md). Replaces the passive auto-
 * derive of the Active list with a reviewed, recipe-by-recipe build:
 *
 *   0. pick the recipes you're shopping for (all checked by default)
 *   1..N. per recipe: split ingredients Shop-for / Already-have (low floated to
 *         the top of Have), editable; "always have" writes a pantry staple
 *   N+1. combine duplicates across recipes
 *   -> the result lands on the shopping list; you push from there
 *
 * Phase 1-3 here build the flow + collect the decisions. The final materialize
 * (writing committed rows + retiring the live derive) is phase 4 — for now the
 * combined shop-for items are handed to the shopping list as extras.
 */

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View style={styles.boundary}>
      <Heading variant="screenTitle">Couldn't open the builder</Heading>
      <Text color="textMuted">{String(error?.message ?? error)}</Text>
      <Pressable onPress={retry}>
        <Text color="accent">Tap to retry</Text>
      </Pressable>
    </View>
  );
}

type Section = 'shop' | 'have';
/** Per-ingredient decision, keyed within a recipe by ingredient id. */
type Decision = { section: Section; removed: boolean; name?: string; qty?: string; confirmed?: boolean };

const DAYS_AHEAD = 14;

export default function BuildListScreen() {
  const router = useRouter();
  const planMeals = usePlanStore((s) => s.meals);
  const recipes = useRecipeStore((s) => s.recipes);
  const pantryItems = usePantryStore((s) => s.items);
  const applyPaste = usePantryStore((s) => s.applyPaste);
  const toggleStaple = usePantryStore((s) => s.toggleStaple);
  const setAlways = useHaveStore((s) => s.setAlways);
  const addExtras = useExtrasStore((s) => s.add);

  // Planned recipes in the rolling window, DEDUPED (a recipe planned twice is
  // one shopping decision). Order = plan date.
  const plannedRecipes = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const keys = new Set(
      Array.from({ length: DAYS_AHEAD }, (_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return dateKey(d);
      }),
    );
    const byId = new Map<string, Recipe>(recipes.map((r) => [r.id, r]));
    const seen = new Set<string>();
    const out: Recipe[] = [];
    for (const m of planMeals) {
      if ((m.status ?? 'planned') !== 'planned' || !keys.has(dateKey(m.date))) continue;
      for (const d of m.dishes) {
        if (!d.recipeId || seen.has(d.recipeId)) continue;
        const r = byId.get(d.recipeId);
        if (r) {
          seen.add(r.id);
          out.push(r);
        }
      }
    }
    return out;
  }, [planMeals, recipes]);

  // Pantry status by matchKey — drives the default Shop/Have split.
  const statusByKey = useMemo(() => {
    const m = new Map<string, PantryStatus>();
    for (const p of pantryItems) m.set(matchKey(p.canonicalName), p.status ?? 'fine');
    return m;
  }, [pantryItems]);
  const stapleKeys = useMemo(
    () => new Set(pantryItems.filter((p) => p.isStaple).map((p) => matchKey(p.canonicalName))),
    [pantryItems],
  );
  const statusFor = (name: string): PantryStatus | undefined => statusByKey.get(matchKey(name));
  /** Default section: you HAVE it if it's a staple / always-have, or it's in the
   *  pantry and not out (fine/low). Otherwise you shop for it. Checking the
   *  always-have pin (not just pantry isStaple) is what makes marking an
   *  ingredient always-have in recipe 1 reflect in recipes 2/3/4 — later steps
   *  read the default, which now sees the fresh pin. */
  // FUZZY pantry match. A recipe's "salt" should match kosher/sea/flaky salt in
  // the pantry; "Parmesan or Pecorino Romano" matches parmesan. Uses the shopping
  // list's looksLikeSameItem (single-word + same base-noun catches salt→kosher
  // salt; prefix catches parmesan→grated parmesan), and splits "X or Y" so
  // either alternative can match. Returns the matched pantry item (to show the
  // assumption) or null.
  const pantryMatchFor = (name: string) => {
    const alts = name.split(/\s+or\s+/i).map((a) => a.trim()).filter(Boolean);
    for (const alt of alts.length ? alts : [name]) {
      const hit = pantryItems.find((p) => looksLikeSameItem(alt, p.canonicalName));
      if (hit) return hit;
    }
    return null;
  };
  const defaultSection = (name: string): Section => {
    const k = matchKey(name);
    // PANTRY is the source of truth for "always have" — a staple item that
    // actually exists in the pantry. The old code also OR'd in a separate
    // always-have map (have.ts) that never got cleared when you removed the item
    // from the pantry, so a deleted staple (e.g. chives) kept reading as Have.
    // stapleKeys is derived live from pantryItems, so removal clears it.
    if (stapleKeys.has(k)) return 'have';
    const st = statusByKey.get(k);
    if (st === 'fine' || st === 'low') return 'have';
    // Loose: anything the pantry covers (fuzzy) and isn't out → you have it.
    const hit = pantryMatchFor(name);
    if (hit && (hit.status ?? 'fine') !== 'out') return 'have';
    return 'shop';
  };

  // step: 0 = pick recipes; 1..N = recipe (1-indexed); N+1 = combine
  const [step, setStep] = useState(0);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // decisions[recipeId][ingredientId] = Decision (absent = the default split)
  const [decisions, setDecisions] = useState<Record<string, Record<string, Decision>>>({});
  // Long-press detail sheet — edit title/qty + Delete / Always have / Already have.
  const [detail, setDetail] = useState<{ recipe: Recipe; ing: Ingredient } | null>(null);

  const selected = plannedRecipes.filter((r) => !excluded.has(r.id));

  const decisionFor = (recipe: Recipe, ing: Ingredient): Decision =>
    decisions[recipe.id]?.[ing.id] ?? {
      section: defaultSection(ing.canonicalName),
      removed: false,
    };
  const setDecision = (recipeId: string, ingId: string, patch: Partial<Decision>) =>
    setDecisions((prev) => {
      const cur = prev[recipeId]?.[ingId] ?? { section: 'shop' as Section, removed: false };
      return { ...prev, [recipeId]: { ...prev[recipeId], [ingId]: { ...cur, ...patch } } };
    });

  const markAlwaysHave = async (name: string) => {
    // Always-have = a PANTRY STAPLE. Create the pantry item if it's not there
    // (so it shows up in Pantry), or flip an existing item to staple; and set
    // the always-have pin so it reads as Have for every recipe from now on.
    const existing = pantryItems.find((p) => matchKey(p.canonicalName) === matchKey(name));
    if (!existing) await applyPaste([{ canonicalName: name, isStaple: true }]);
    else if (!existing.isStaple) await toggleStaple(existing.id);
    setAlways(name, true);
  };

  /* ---------- final combined shop-for list ---------- */
  // Combine step: user edits + unmerges.
  const [edits, setEdits] = useState<Record<string, { name?: string; qty?: string }>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // AI cross-unit reconcile: groupKey → single buy quantity ("2 pints"), and the
  // set currently being reconciled (for the "reconciling…" hint).
  const [aiQty, setAiQty] = useState<Record<string, string>>({});
  const [reconciling, setReconciling] = useState<Set<string>>(new Set());
  const aiTried = useRef<Set<string>>(new Set());

  // Every "Shop for" ingredient, grouped by matchKey, carrying WHICH recipes it
  // came from — so the combine step can show its work.
  const groups = useMemo(() => {
    const byKey = new Map<string, { key: string; name: string; sources: { recipe: string; amt: string }[] }>();
    for (const r of selected) {
      for (const ing of r.ingredients) {
        const dec = decisionFor(r, ing);
        if (dec.removed || dec.section !== 'shop') continue;
        // Per-ingredient edits from the detail sheet override the name/qty.
        const name = dec.name ?? ing.canonicalName;
        const k = matchKey(name);
        const amt = dec.qty ?? (ing.amount != null ? formatAmount(ing.amount, ing.unit) : '');
        const g = byKey.get(k) ?? { key: k, name, sources: [] };
        g.sources.push({ recipe: r.title, amt });
        byKey.set(k, g);
      }
    }
    return [...byKey.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, decisions, statusByKey, stapleKeys]);

  // effGroups folds `groups` into merged clusters. Two ways to merge:
  //  - AUTO: look-alikes via looksLikeSameItem — the SAME logic the shopping
  //    list uses (catches "halloumi"/"halloumi cheese", "chickpeas"/"cooked
  //    chickpeas"), unless you've split that group off (keepSeparate).
  //  - MANUAL: check two rows and Merge (mergeOverride) for anything auto misses.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mergeOverride, setMergeOverride] = useState<Record<string, string>>({});
  const [keepSeparate, setKeepSeparate] = useState<Set<string>>(new Set());
  const effGroups = useMemo(() => {
    // Union-find over group keys.
    const parent = new Map(groups.map((g) => [g.key, g.key]));
    const find = (k: string): string => {
      let r = k;
      while (parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    // Auto: merge look-alikes not explicitly kept separate.
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i]!;
        const b = groups[j]!;
        if (keepSeparate.has(a.key) || keepSeparate.has(b.key)) continue;
        if (looksLikeSameItem(a.name, b.name)) union(a.key, b.key);
      }
    }
    // Manual overrides win regardless.
    for (const [k, canon] of Object.entries(mergeOverride)) if (parent.has(k)) union(k, canon);
    // Collect clusters by root.
    const byRoot = new Map<
      string,
      { key: string; name: string; sources: { recipe: string; amt: string }[]; members: string[] }
    >();
    for (const g of groups) {
      const root = find(g.key);
      const e = byRoot.get(root) ?? { key: root, name: g.name, sources: [], members: [] };
      e.sources.push(...g.sources);
      e.members.push(g.key);
      if (g.name.length < e.name.length) e.name = g.name; // simplest name wins
      byRoot.set(root, e);
    }
    return [...byRoot.values()];
  }, [groups, mergeOverride, keepSeparate]);

  const mergeChecked = () => {
    const picked = effGroups.filter((g) => checked.has(g.key));
    if (picked.length < 2) return;
    const canon = picked.reduce((a, b) => (b.name.length < a.name.length ? b : a)).key;
    setMergeOverride((prev) => {
      const next = { ...prev };
      for (const g of picked) for (const m of g.members) next[m] = canon;
      return next;
    });
    // Merging overrides any keep-separate on these members.
    setKeepSeparate((prev) => {
      const next = new Set(prev);
      for (const g of picked) for (const m of g.members) next.delete(m);
      return next;
    });
    setChecked(new Set());
  };

  type CombineRow = {
    id: string;
    groupKey: string;
    name: string;
    qty: string;
    recipes: string[];
    merged: boolean; // combined from >1 source (multiple recipes and/or merge)
  };
  const combineRows = useMemo<CombineRow[]>(() => {
    const rows: CombineRow[] = effGroups.map((g) => {
      const e = edits[g.key];
      // Amount precedence: your edit > AI cross-unit reconcile > local sum.
      // The AI turns mixed units into ONE shoppable total ("2 cup + 600 g" →
      // "3 pints"); same units just add.
      return {
        id: g.key,
        groupKey: g.key,
        name: e?.name ?? g.name,
        qty: e?.qty ?? aiQty[g.key] ?? sumQtyStrings(g.sources.map((s) => s.amt)),
        recipes: [...new Set(g.sources.map((s) => s.recipe))],
        merged: g.sources.length > 1,
      };
    });
    // Merged (your combined duplicates) first — that's the work to eyeball.
    return rows.sort(
      (a, b) => (b.merged ? 1 : 0) - (a.merged ? 1 : 0) || a.name.localeCompare(b.name),
    );
  }, [effGroups, edits, aiQty]);

  /** Break a cluster back into its member groups — clear any manual overrides
   *  AND mark the members keep-separate so the auto look-alike merge doesn't
   *  immediately re-combine them. */
  const splitCluster = (canon: string) => {
    const cluster = effGroups.find((g) => g.key === canon);
    const members = cluster?.members ?? [canon];
    setMergeOverride((prev) => {
      const next = { ...prev };
      for (const m of members) delete next[m];
      return next;
    });
    setKeepSeparate((prev) => {
      const next = new Set(prev);
      for (const m of members) next.add(m);
      return next;
    });
  };

  const editingGroup = effGroups.find((g) => g.key === editingKey) ?? null;

  // AI cross-unit reconcile: when a merged group mixes units ("300 g + 1 pint"),
  // ask Claude for the single buy quantity. Runs once per group when you reach
  // the combine step; falls back to the side-by-side sum if Claude is offline.
  useEffect(() => {
    if (step !== selected.length + 1) return;
    for (const g of effGroups) {
      if (g.sources.length < 2) continue;
      const summed = sumQtyStrings(g.sources.map((s) => s.amt));
      if (!isMixedUnits(summed)) continue; // same-unit sum is already exact
      // Re-run when the cluster's membership changes (manual merge), keyed on
      // the member set — so merging two look-alikes triggers a fresh total.
      const sig = `${g.key}|${g.members.slice().sort().join(',')}`;
      if (aiTried.current.has(sig)) continue;
      aiTried.current.add(sig);
      setReconciling((p) => new Set(p).add(g.key));
      void reconcileQty(g.name, g.sources.map((s) => s.amt))
        .then((r) => {
          if (r) setAiQty((p) => ({ ...p, [g.key]: r }));
        })
        .finally(() =>
          setReconciling((p) => {
            const n = new Set(p);
            n.delete(g.key);
            return n;
          }),
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selected.length, effGroups]);

  const finish = () => {
    // Phase-1 hand-off: add the combined shop-for items to the shopping list as
    // extras (the materialized store). Split rows land as separate items.
    if (combineRows.length > 0) {
      addExtras(
        combineRows.map((c) => {
          // Carry the finalized amount through to the shopping list. A clean
          // single-unit total parses to amount+unit; a mixed one ("300 g +
          // 1 pint") can't, so keep it as the unit text so nothing is lost.
          const p = parseQty(c.qty);
          return {
            canonicalName: c.name,
            amount: p.amount,
            unit: p.amount != null ? p.unit : c.qty || null,
            // Show WHICH recipe(s) it's for on the shopping list — that's the
            // useful context, not a generic "from your plan".
            originLabel: c.recipes.length ? `for ${c.recipes.join(' · ')}` : 'added by you',
            // Sentinel so the shopping list keeps plan-wizard items on ACTIVE and
            // never routes them to Staples, even if the item is also a staple.
            originId: 'plan-wizard',
          };
        }),
      );
    }
    router.replace('/shopping');
  };

  /* ---------- render ---------- */
  const total = selected.length;
  const onCombine = step === total + 1;
  const recipe = step >= 1 && step <= total ? selected[step - 1] : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Heading variant="screenTitle">Build shopping list</Heading>
          <Text color="textMuted">
            {step === 0
              ? 'Pick what you’re shopping for'
              : onCombine
                ? 'Combine duplicates'
                : `Recipe ${step} of ${total}`}
          </Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Cancel
          </Text>
        </Pressable>
      </View>

      {/* ---- Step 0: pick recipes ---- */}
      {step === 0 ? (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            {plannedRecipes.length === 0 ? (
              <Text color="textMuted" style={styles.empty}>
                No planned recipes in the next {DAYS_AHEAD} days.
              </Text>
            ) : (
              plannedRecipes.map((r) => {
                const on = !excluded.has(r.id);
                return (
                  <Pressable
                    key={r.id}
                    style={styles.pickRow}
                    onPress={() =>
                      setExcluded((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.id)) next.delete(r.id);
                        else next.add(r.id);
                        return next;
                      })
                    }>
                    <View style={[styles.box, on && styles.boxOn]}>
                      {on ? <Glyph name="done" size={12} color="bg" /> : null}
                    </View>
                    {r.imageUrl ? (
                      <Image source={{ uri: r.imageUrl }} style={styles.pickThumb} resizeMode="cover" />
                    ) : null}
                    <View style={styles.flex}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text color="textMuted" variant="sectionLabel">
                        {r.ingredients.length} ingredients · serves {r.yield.serves}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <BottomActionBar>
            <Button
              label={`Start · ${selected.length} recipe${selected.length === 1 ? '' : 's'}`}
              glyph="next"
              flex
              disabled={selected.length === 0}
              onPress={() => setStep(1)}
            />
          </BottomActionBar>
        </>
      ) : null}

      {/* ---- Step 1..N: per-recipe Shop / Have ---- */}
      {recipe ? (
        <RecipeStep
          recipe={recipe}
          decisionFor={decisionFor}
          statusFor={statusFor}
          pantryMatchFor={pantryMatchFor}
          isStaple={(name) => stapleKeys.has(matchKey(name))}
          onConfirmCovered={(ing) => setDecision(recipe.id, ing.id, { confirmed: true })}
          onPushToShop={(ing) => setDecision(recipe.id, ing.id, { section: 'shop' })}
          onToggleSection={(ing) =>
            setDecision(recipe.id, ing.id, {
              section: decisionFor(recipe, ing).section === 'shop' ? 'have' : 'shop',
            })
          }
          onRemove={(ing) =>
            setDecision(recipe.id, ing.id, { removed: !decisionFor(recipe, ing).removed })
          }
          onAlwaysHave={(ing) => {
            void markAlwaysHave(ing.canonicalName);
            setDecision(recipe.id, ing.id, { section: 'have' });
          }}
          onOpenDetail={(ing) => setDetail({ recipe, ing })}
          onBack={() => setStep((s) => s - 1)}
          onNext={() => setStep((s) => s + 1)}
          isLast={step === total}
        />
      ) : null}

      {/* Long-press detail sheet — full options for one ingredient. */}
      <Overlay visible={!!detail} onClose={() => setDetail(null)}>
        {detail ? (
          <IngredientDetail
            key={detail.ing.id}
            ing={detail.ing}
            decision={decisionFor(detail.recipe, detail.ing)}
            onSave={(name, qty) => {
              // Preserve the item's current section so editing name/qty keeps a
              // Shop-for item ON the shopping list (it was dropping out).
              const cur = decisionFor(detail.recipe, detail.ing);
              setDecision(detail.recipe.id, detail.ing.id, {
                section: cur.section,
                removed: false,
                name,
                qty,
              });
              setDetail(null);
            }}
            onAlreadyHave={() => {
              setDecision(detail.recipe.id, detail.ing.id, { section: 'have' });
              setDetail(null);
            }}
            onAlwaysHave={() => {
              void markAlwaysHave(detail.ing.canonicalName);
              setDecision(detail.recipe.id, detail.ing.id, { section: 'have' });
              setDetail(null);
            }}
            onDelete={() => {
              setDecision(detail.recipe.id, detail.ing.id, { removed: true });
              setDetail(null);
            }}
            onCancel={() => setDetail(null)}
          />
        ) : null}
      </Overlay>

      {/* ---- Step N+1: combine ---- */}
      {onCombine ? (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            <SectionLabel color="textMuted" style={styles.combineHint}>
              {combineRows.length} item{combineRows.length === 1 ? '' : 's'} to shop for.
              Duplicates across recipes are merged — shown first, so you can see the work.
            </SectionLabel>
            {combineRows.map((row) => {
              const mixed = isMixedUnits(row.qty);
              const isChecked = checked.has(row.groupKey);
              return (
                <View key={row.id} style={styles.combineRow}>
                  {/* Check two look-alikes → Merge (for anything the auto merge
                      missed). */}
                  <Pressable
                    onPress={() =>
                      setChecked((p) => {
                        const n = new Set(p);
                        if (n.has(row.groupKey)) n.delete(row.groupKey);
                        else n.add(row.groupKey);
                        return n;
                      })
                    }
                    hitSlop={8}>
                    <View style={[styles.checkSm, isChecked && styles.boxOn]}>
                      {isChecked ? <Glyph name="done" size={11} color="bg" /> : null}
                    </View>
                  </Pressable>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {row.name.charAt(0).toUpperCase() + row.name.slice(1)}
                      {row.qty ? <Text color="textMuted">  ·  {row.qty}</Text> : null}
                    </Text>
                    {row.recipes.length > 0 ? (
                      <Text color="textFaint" variant="sectionLabel">
                        {row.merged ? 'merged from ' : 'for '}
                        {row.recipes.join(' · ')}
                      </Text>
                    ) : null}
                    {reconciling.has(row.groupKey) ? (
                      <Text color="textFaint" variant="sectionLabel">
                        reconciling units…
                      </Text>
                    ) : aiQty[row.groupKey] && !edits[row.groupKey] ? (
                      <Text color="ok" variant="sectionLabel">
                        reconciled to a shoppable total — tap Edit to adjust
                      </Text>
                    ) : mixed ? (
                      <Text color="warn" variant="sectionLabel">
                        mixed units — edit to set a single total
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.combineActions}>
                    <Pressable onPress={() => setEditingKey(row.groupKey)} hitSlop={6}>
                      <Text color="accent" variant="sectionLabel">
                        Edit
                      </Text>
                    </Pressable>
                    {row.merged ? (
                      <Pressable onPress={() => splitCluster(row.groupKey)} hitSlop={6}>
                        <Text color="textMuted" variant="sectionLabel">
                          Unmerge
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
            {combineRows.length === 0 ? (
              <Text color="textMuted" style={styles.empty}>
                Nothing to shop for — you have everything.
              </Text>
            ) : null}
          </ScrollView>
          <BottomActionBar
            meta={
              checked.size >= 2 ? (
                <Pressable onPress={mergeChecked} hitSlop={6} accessibilityRole="button">
                  <Text color="ok" variant="bodyStrong">
                    Merge · {checked.size}
                  </Text>
                </Pressable>
              ) : checked.size === 1 ? (
                <Text color="textFaint">Check one more to merge</Text>
              ) : undefined
            }>
            <Button
              label="Back"
              variant="secondary"
              flex
              onPress={() => setStep((s) => s - 1)}
            />
            <Button label="Add to shopping list" glyph="done" flex onPress={finish} />
          </BottomActionBar>
        </>
      ) : null}

      {/* Edit a combined item's name / total. */}
      <Overlay visible={!!editingGroup} onClose={() => setEditingKey(null)}>
        {editingGroup ? (
          <EditCombined
            initialName={edits[editingGroup.key]?.name ?? editingGroup.name}
            initialQty={
              edits[editingGroup.key]?.qty ??
              aiQty[editingGroup.key] ??
              sumQtyStrings(editingGroup.sources.map((s) => s.amt))
            }
            sources={editingGroup.sources}
            onSave={(name, qty) => {
              setEdits((p) => ({ ...p, [editingGroup.key]: { name, qty } }));
              setEditingKey(null);
            }}
            onCancel={() => setEditingKey(null)}
          />
        ) : null}
      </Overlay>
    </SafeAreaView>
  );
}

/* ---------- edit a combined item ---------- */
function EditCombined({
  initialName,
  initialQty,
  sources,
  onSave,
  onCancel,
}: {
  initialName: string;
  initialQty: string;
  sources: { recipe: string; amt: string }[];
  onSave: (name: string, qty: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [qty, setQty] = useState(initialQty);
  return (
    <View style={styles.editSheet}>
      <Heading variant="recipeTitle">Edit item</Heading>
      <Text color="textFaint" style={styles.editHint}>
        {sources.map((s) => `${s.amt || '—'} (${s.recipe})`).join('   +   ')}
      </Text>
      <SectionLabel color="textMuted">Name</SectionLabel>
      <TextInput value={name} onChangeText={setName} style={styles.editInput} />
      <SectionLabel color="textMuted">Total to buy</SectionLabel>
      <TextInput
        value={qty}
        onChangeText={setQty}
        placeholder="e.g. 2 pints"
        placeholderTextColor={colors.textFaint}
        style={styles.editInput}
      />
      <View style={styles.editButtons}>
        <Button label="Cancel" variant="secondary" flex onPress={onCancel} />
        <Button label="Save" glyph="done" flex onPress={() => onSave(name.trim() || initialName, qty.trim())} />
      </View>
    </View>
  );
}

/* ---------- per-recipe step ---------- */
/* ---------- long-press ingredient detail sheet ---------- */
function IngredientDetail({
  ing,
  decision,
  onSave,
  onAlreadyHave,
  onAlwaysHave,
  onDelete,
  onCancel,
}: {
  ing: Ingredient;
  decision: Decision;
  onSave: (name: string, qty: string) => void;
  onAlreadyHave: () => void;
  onAlwaysHave: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(decision.name ?? ing.canonicalName);
  const [qty, setQty] = useState(
    decision.qty ?? (ing.amount != null ? formatAmount(ing.amount, ing.unit) : ''),
  );
  return (
    <View style={styles.editSheet}>
      <Heading variant="recipeTitle">Item</Heading>
      <SectionLabel color="textMuted">Name</SectionLabel>
      <TextInput value={name} onChangeText={setName} style={styles.editInput} />
      <SectionLabel color="textMuted">Quantity</SectionLabel>
      <TextInput
        value={qty}
        onChangeText={setQty}
        placeholder="e.g. 2 pints"
        placeholderTextColor={colors.textFaint}
        style={styles.editInput}
      />
      <Button
        label="Save"
        glyph="done"
        onPress={() => onSave(name.trim() || ing.canonicalName, qty.trim())}
      />
      <View style={styles.detailActions}>
        <Button label="Already have" variant="secondary" flex onPress={onAlreadyHave} />
        <Button label="Always have" variant="secondary" flex onPress={onAlwaysHave} />
      </View>
      <Pressable onPress={onDelete} style={styles.detailDelete} accessibilityRole="button">
        <Text color="warn" variant="bodyStrong">
          Delete from list
        </Text>
      </Pressable>
      <Pressable onPress={onCancel} style={styles.detailCancel} accessibilityRole="button">
        <Text color="textMuted">Cancel</Text>
      </Pressable>
    </View>
  );
}

function RecipeStep({
  recipe,
  decisionFor,
  statusFor,
  onToggleSection,
  onRemove,
  onAlwaysHave,
  onOpenDetail,
  pantryMatchFor,
  isStaple,
  onConfirmCovered,
  onPushToShop,
  onBack,
  onNext,
  isLast,
}: {
  recipe: Recipe;
  decisionFor: (r: Recipe, i: Ingredient) => Decision;
  statusFor: (name: string) => PantryStatus | undefined;
  onToggleSection: (ing: Ingredient) => void;
  onRemove: (ing: Ingredient) => void;
  onAlwaysHave: (ing: Ingredient) => void;
  onOpenDetail: (ing: Ingredient) => void;
  pantryMatchFor: (name: string) => { canonicalName: string } | null | undefined;
  isStaple: (name: string) => boolean;
  onConfirmCovered: (ing: Ingredient) => void;
  onPushToShop: (ing: Ingredient) => void;
  onBack: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const active = recipe.ingredients.filter((i) => !decisionFor(recipe, i).removed);
  const shop = active.filter((i) => decisionFor(recipe, i).section === 'shop');
  // Have section: FLAGGED items (running-low OR a fuzzy pantry match) float to
  // the top — those are the assumptions you'll want to eyeball / veto.
  const isFuzzy = (i: Ingredient) => {
    const m = pantryMatchFor(i.canonicalName);
    return !!m && matchKey(m.canonicalName) !== matchKey(i.canonicalName);
  };
  // Order within Already-have: LOW first (you might still need to buy), then
  // FUZZY matches (the assumptions to eyeball), then everything else.
  const rank = (i: Ingredient) =>
    statusFor(i.canonicalName) === 'low' ? 0 : isFuzzy(i) ? 1 : 2;
  const have = active
    .filter((i) => decisionFor(recipe, i).section === 'have')
    .sort((a, b) => rank(a) - rank(b) || a.canonicalName.localeCompare(b.canonicalName));

  // Same interaction model as the shopping list: LONG-PRESS = always have,
  // SWIPE-RIGHT = "have it" (move between Shop for / Already have this build),
  // SWIPE-LEFT reveals Remove (off the list — you have it, don't always-have it).
  const Row = ({ ing, section }: { ing: Ingredient; section: Section }) => {
    // Show the EDITED name/qty (from the long-press detail sheet), not the raw
    // recipe ingredient — otherwise an edit looks like it did nothing here.
    const dec = decisionFor(recipe, ing);
    const displayName = dec.name ?? ing.canonicalName;
    const displayQty = dec.qty ?? (ing.amount != null ? formatAmount(ing.amount, ing.unit) : '');
    const low = statusFor(ing.canonicalName) === 'low';
    // Assumption flag: this row is in "Have" because a DIFFERENTLY-named pantry
    // item fuzzy-matched it (recipe "salt" → your "kosher salt"). Surface it so
    // you can veto (tap to move it to Shop for).
    const match = section === 'have' ? pantryMatchFor(ing.canonicalName) : null;
    const fuzzy = !!(
      match && matchKey(match.canonicalName) !== matchKey(ing.canonicalName)
    );
    const staple = section === 'have' && isStaple(ing.canonicalName);
    // Right-side badge — most-actionable first. LOW / FUZZY MATCH are the
    // assumptions to eyeball; ALWAYS HAVE = a pantry staple; HAVE = you tapped it
    // in (have it for this meal, not a standing staple).
    const badge =
      section !== 'have'
        ? null
        : low
          ? { label: 'LOW', style: styles.badgeLow, color: 'bg' as const }
          : fuzzy
            ? { label: 'FUZZY MATCH', style: styles.badgeFuzzy, color: 'bg' as const }
            : staple
              ? { label: 'ALWAYS HAVE', style: styles.alwaysPill, color: 'textMuted' as const }
              : { label: 'HAVE', style: styles.havePill, color: 'textMuted' as const };
    // Answerable assumption: a LOW or FUZZY Have row asks "covered?" — ✓ keeps it
    // here (and stops asking), ✗ pushes it to Shop for. Confirmed rows go quiet.
    const showPrompt = section === 'have' && (low || fuzzy) && !dec.confirmed;
    const swipeRef = useRef<SwipeableMethods | null>(null);
    const onOpen = (dir: 'left' | 'right') => {
      if (dir === 'right') {
        // Swipe right → always have (commit-on-open). Reliable path that doesn't
        // depend on long-press firing.
        swipeRef.current?.close();
        onAlwaysHave(ing);
      }
      // left → Remove panel revealed; tap the button.
    };
    return (
      <ReanimatedSwipeable
        ref={swipeRef}
        friction={1.5}
        leftThreshold={48}
        rightThreshold={48}
        overshootLeft={false}
        overshootRight={false}
        onSwipeableOpen={onOpen}
        renderLeftActions={() => (
          <View style={styles.haveAction}>
            <Text color="bg" variant="bodyStrong">
              Always have
            </Text>
          </View>
        )}
        renderRightActions={() => (
          <View style={styles.rightActions}>
            <GHPressable
              onPress={() => {
                swipeRef.current?.close();
                onRemove(ing);
              }}
              style={styles.deleteAction}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${ing.canonicalName} from the list`}>
              <Text color="bg" variant="bodyStrong">
                Remove
              </Text>
            </GHPressable>
          </View>
        )}>
        {/* Column: the tappable ingredient row on top, the answerable "covered?"
            prompt (if any) below it — the ✓/✗ live OUTSIDE the Pressable so
            tapping them doesn't also toggle the row's section. */}
        <View style={styles.ingRow}>
          <View style={styles.ingTop}>
            {/* TAP = move Shop↔Have; SWIPE-RIGHT = always have; SWIPE-LEFT =
                delete; LONG-PRESS = full detail sheet (edit + all actions). */}
            <Pressable
              onPress={() => onToggleSection(ing)}
              onLongPress={() => onOpenDetail(ing)}
              delayLongPress={400}
              // @ts-expect-error web-only: stop iOS hijacking the long-press
              style={[styles.ingMain, { userSelect: 'none', WebkitTouchCallout: 'none' }]}
              accessibilityRole="button"
              accessibilityLabel={`${ing.canonicalName}. Tap to move; swipe right to always have; swipe left to remove; long-press for options.`}>
              <Numeric color="textMuted" style={styles.ingAmt} numberOfLines={2}>
                {displayQty}
              </Numeric>
              <View style={styles.flex}>
                <Text numberOfLines={1}>{displayName}</Text>
              </View>
            </Pressable>
            {badge ? (
              <View style={badge.style}>
                <Text variant="sectionLabel" color={badge.color}>
                  {badge.label}
                </Text>
              </View>
            ) : null}
          </View>
          {showPrompt ? (
            <View style={styles.coveredRow}>
              <Text variant="sectionLabel" color="accent" numberOfLines={1} style={styles.flex}>
                {fuzzy && match
                  ? `have “${match.canonicalName}” — covered?`
                  : 'marked low — still have enough?'}
              </Text>
              <GHPressable
                onPress={() => onConfirmCovered(ing)}
                style={[styles.answerBtn, styles.answerYes]}
                accessibilityRole="button"
                accessibilityLabel={`Yes — ${ing.canonicalName} is covered, keep in Already have`}>
                <Text color="bg" variant="bodyStrong">
                  ✓
                </Text>
              </GHPressable>
              <GHPressable
                onPress={() => onPushToShop(ing)}
                style={[styles.answerBtn, styles.answerNo]}
                accessibilityRole="button"
                accessibilityLabel={`No — move ${ing.canonicalName} to Shop for`}>
                <Text color="bg" variant="bodyStrong">
                  ✕
                </Text>
              </GHPressable>
            </View>
          ) : null}
        </View>
      </ReanimatedSwipeable>
    );
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.list}>
        <Heading variant="recipeTitle" style={styles.recipeTitle}>
          {recipe.title}
        </Heading>

        <SectionLabel color="accent" style={styles.section}>
          Shop for · {shop.length}
        </SectionLabel>
        {shop.length === 0 ? (
          <Text color="textFaint" style={styles.sectionEmpty}>
            Nothing — you have it all.
          </Text>
        ) : (
          shop.map((i) => <Row key={i.id} ing={i} section="shop" />)
        )}

        <SectionLabel color="textMuted" style={styles.section}>
          Already have · {have.length}
        </SectionLabel>
        {have.length === 0 ? (
          <Text color="textFaint" style={styles.sectionEmpty}>
            Nothing yet.
          </Text>
        ) : (
          have.map((i) => <Row key={i.id} ing={i} section="have" />)
        )}
        <Text color="textFaint" style={styles.tip}>
          Tap to move between Shop for and Already have. Swipe right to “always
          have” (adds it to your pantry). Swipe left to remove. Long-press for
          the full detail sheet (edit name/qty + all options).
        </Text>
      </ScrollView>
      <BottomActionBar>
        <Button label="Back" variant="secondary" flex onPress={onBack} />
        <Button label={isLast ? 'Combine' : 'Next'} glyph="next" flex onPress={onNext} />
      </BottomActionBar>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  flex: { flex: 1, minWidth: 0 },
  list: { padding: layout.screenPadding, gap: 8, paddingBottom: 30 },
  empty: { textAlign: 'center', paddingVertical: 32, fontStyle: 'italic' },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.bg2,
    borderRadius: 12,
    padding: 14,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pickThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.bg3 },
  recipeTitle: { fontSize: 20, paddingBottom: 4 },
  section: { paddingTop: 14, paddingBottom: 2 },
  sectionEmpty: { fontStyle: 'italic', paddingVertical: 6 },
  ingRow: {
    backgroundColor: colors.bg, // opaque, so the swipe action panels sit behind it
  },
  ingTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 4,
  },
  ingMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start', // top-align so the amount lines up with the name
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    minWidth: 0,
    backgroundColor: colors.bg, // opaque, so the swipe action panels sit behind it
  },
  badgeLow: {
    backgroundColor: colors.warn,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeFuzzy: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  havePill: {
    backgroundColor: colors.bg3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  coveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 108, // align under the name (amount column 92 + gaps)
    paddingRight: 4,
    paddingBottom: 10,
  },
  answerBtn: {
    width: 30,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  answerYes: { backgroundColor: colors.ok },
  answerNo: { backgroundColor: colors.accent },
  ingBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    minWidth: 0,
  },
  alwaysChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.bg3,
  },
  ingAmt: { width: 92, textAlign: 'right', paddingTop: 1 },
  haveAction: {
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    backgroundColor: colors.ok,
  },
  rightActions: { flexDirection: 'row' },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
    backgroundColor: colors.accent,
  },
  lowPill: {
    backgroundColor: colors.bg3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  alwaysPill: {
    backgroundColor: colors.bg3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ingSide: { paddingHorizontal: 6, paddingVertical: 8 },
  tip: { fontStyle: 'italic', lineHeight: 18, paddingTop: 16 },
  combineHint: { paddingBottom: 8, lineHeight: 18 },
  combineActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  checkSm: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitRow: { paddingLeft: 16, opacity: 0.9 },
  editSheet: { gap: 10 },
  editHint: { fontStyle: 'italic', lineHeight: 18 },
  editInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  editButtons: { flexDirection: 'row', gap: 10, paddingTop: 6 },
  detailActions: { flexDirection: 'row', gap: 10 },
  detailDelete: { alignItems: 'center', paddingVertical: 12 },
  detailCancel: { alignItems: 'center', paddingVertical: 6 },
  combineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  boundary: {
    flex: 1,
    padding: 24,
    gap: 12,
    backgroundColor: colors.bg,
    justifyContent: 'center',
  },
});
