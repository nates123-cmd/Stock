import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text, Heading, Numeric, SectionLabel, Glyph, Button, BottomActionBar } from '@/components';
import { colors, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { usePantryStore } from '@/store/pantry';
import { useHaveStore } from '@/store/have';
import { useExtrasStore } from '@/store/extras';
import { dateKey } from '@/lib/week';
import { matchKey } from '@/lib/pantry';
import { formatAmount } from '@/lib/format';
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
type Decision = { section: Section; removed: boolean };

const DAYS_AHEAD = 14;

export default function BuildListScreen() {
  const router = useRouter();
  const planMeals = usePlanStore((s) => s.meals);
  const recipes = useRecipeStore((s) => s.recipes);
  const pantryItems = usePantryStore((s) => s.items);
  const applyPaste = usePantryStore((s) => s.applyPaste);
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
  /** Default section: you HAVE it if it's in the pantry and not out (fine/low),
   *  or it's a staple. Otherwise you shop for it. */
  const defaultSection = (name: string): Section => {
    const k = matchKey(name);
    const st = statusByKey.get(k);
    if (stapleKeys.has(k)) return 'have';
    if (st === 'fine' || st === 'low') return 'have';
    return 'shop';
  };

  // step: 0 = pick recipes; 1..N = recipe (1-indexed); N+1 = combine
  const [step, setStep] = useState(0);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  // decisions[recipeId][ingredientId] = Decision (absent = the default split)
  const [decisions, setDecisions] = useState<Record<string, Record<string, Decision>>>({});

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
    // Global pantry staple — reads as Have for every recipe from now on.
    const existing = pantryItems.find((p) => matchKey(p.canonicalName) === matchKey(name));
    if (!existing) await applyPaste([{ canonicalName: name, isStaple: true }]);
    setAlways(name, true);
  };

  /* ---------- final combined shop-for list ---------- */
  const combined = useMemo(() => {
    // Every ingredient the user kept in "Shop for", grouped by matchKey.
    const byKey = new Map<string, { name: string; parts: string[] }>();
    for (const r of selected) {
      for (const ing of r.ingredients) {
        const dec = decisionFor(r, ing);
        if (dec.removed || dec.section !== 'shop') continue;
        const k = matchKey(ing.canonicalName);
        const amt = ing.amount != null ? formatAmount(ing.amount, ing.unit) : '';
        const g = byKey.get(k);
        if (g) {
          if (amt) g.parts.push(amt);
        } else {
          byKey.set(k, { name: ing.canonicalName, parts: amt ? [amt] : [] });
        }
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, decisions, statusByKey, stapleKeys]);

  const finish = () => {
    // Phase-1 hand-off: add the combined shop-for items to the shopping list.
    // (Phase 4 will materialize a committed list + retire the live derive.)
    if (combined.length > 0) {
      addExtras(
        combined.map((c) => ({
          canonicalName: c.name,
          amount: null,
          unit: null,
          originLabel: 'from your plan',
          originId: null,
        })),
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
          onBack={() => setStep((s) => s - 1)}
          onNext={() => setStep((s) => s + 1)}
          isLast={step === total}
        />
      ) : null}

      {/* ---- Step N+1: combine ---- */}
      {onCombine ? (
        <>
          <ScrollView contentContainerStyle={styles.list}>
            <SectionLabel color="textMuted" style={styles.combineHint}>
              {combined.length} item{combined.length === 1 ? '' : 's'} to shop for — duplicates
              across recipes are merged.
            </SectionLabel>
            {combined.map((c) => (
              <View key={c.name} style={styles.combineRow}>
                <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                  {c.name.charAt(0).toUpperCase() + c.name.slice(1)}
                </Text>
                {c.parts.length > 0 ? (
                  <Numeric color="textMuted">{c.parts.join(' + ')}</Numeric>
                ) : null}
              </View>
            ))}
            {combined.length === 0 ? (
              <Text color="textMuted" style={styles.empty}>
                Nothing to shop for — you have everything.
              </Text>
            ) : null}
          </ScrollView>
          <BottomActionBar>
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
    </SafeAreaView>
  );
}

/* ---------- per-recipe step ---------- */
function RecipeStep({
  recipe,
  decisionFor,
  statusFor,
  onToggleSection,
  onRemove,
  onAlwaysHave,
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
  onBack: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const active = recipe.ingredients.filter((i) => !decisionFor(recipe, i).removed);
  const shop = active.filter((i) => decisionFor(recipe, i).section === 'shop');
  // Have section: running-LOW floated to the top (you've got it, but barely).
  const rankLow = (i: Ingredient) => (statusFor(i.canonicalName) === 'low' ? 0 : 1);
  const have = active
    .filter((i) => decisionFor(recipe, i).section === 'have')
    .sort((a, b) => rankLow(a) - rankLow(b) || a.canonicalName.localeCompare(b.canonicalName));

  const Row = ({ ing, section }: { ing: Ingredient; section: Section }) => {
    const low = statusFor(ing.canonicalName) === 'low';
    return (
      <View style={styles.ingRow}>
        <Pressable
          onPress={() => onToggleSection(ing)}
          style={styles.ingMain}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={
            section === 'shop'
              ? `Move ${ing.canonicalName} to Already have`
              : `Move ${ing.canonicalName} to Shop for`
          }>
          <Glyph
            name={section === 'shop' ? 'next' : 'back'}
            size={13}
            color="textFaint"
          />
          <Numeric color="textMuted" style={styles.ingAmt}>
            {ing.amount != null ? formatAmount(ing.amount, ing.unit) : ''}
          </Numeric>
          <Text style={styles.flex} numberOfLines={1}>
            {ing.canonicalName}
          </Text>
          {low ? (
            <View style={styles.lowPill}>
              <Text variant="sectionLabel" color="warn">
                low
              </Text>
            </View>
          ) : null}
        </Pressable>
        {section === 'have' ? (
          <Pressable onPress={() => onAlwaysHave(ing)} hitSlop={6} style={styles.ingSide}>
            <Text variant="sectionLabel" color="textFaint">
              always
            </Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => onRemove(ing)} hitSlop={6} style={styles.ingSide}>
            <Glyph name="close" size={13} color="textFaint" />
          </Pressable>
        )}
      </View>
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
          Tap a row to move it between Shop for and Already have. “always” keeps it
          in your pantry so it stays a Have for every recipe.
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
  recipeTitle: { fontSize: 20, paddingBottom: 4 },
  section: { paddingTop: 14, paddingBottom: 2 },
  sectionEmpty: { fontStyle: 'italic', paddingVertical: 6 },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ingMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    minWidth: 0,
  },
  ingAmt: { minWidth: 54 },
  lowPill: {
    backgroundColor: colors.bg3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ingSide: { paddingHorizontal: 6, paddingVertical: 8 },
  tip: { fontStyle: 'italic', lineHeight: 18, paddingTop: 16 },
  combineHint: { paddingBottom: 8, lineHeight: 18 },
  combineRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
