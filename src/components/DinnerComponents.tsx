import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text, Heading, SectionLabel } from './Text';
import { Glyph } from './Glyph';
import { Button } from './Button';
import { Overlay } from './Overlay';
import { SearchBar } from './SearchBar';
import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { useCookPlanStore } from '@/store/cookPlans';
import {
  addComponent,
  componentRefs,
  dinnersContaining,
  indexRecipes,
  isDinner,
  moveComponent,
  removeComponent,
  resolveRefs,
  wouldCycle,
} from '@/lib/dinners';
import { buildCookPlanFromDinner } from '@/lib/dinnerToCookPlan';
import type { Recipe } from '@/types';

/**
 * The "Includes" block on a recipe — the recipes this one is built from.
 *
 * Two jobs on one surface, because they are the same mechanism (see
 * lib/dinners): linking sub-recipes into a normal recipe, and assembling a
 * **dinner** out of several recipes. The morph button turns the assembled
 * dinner into a Cook Plan — the timed, alarmed version of the same meal.
 */
export function DinnerComponents({
  recipe,
  onSave,
  onHint,
}: {
  recipe: Recipe;
  onSave: (r: Recipe) => void;
  onHint?: (msg: string | null) => void;
}) {
  const router = useRouter();
  const recipes = useRecipeStore((s) => s.recipes);
  const savePlan = useCookPlanStore((s) => s.save);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [building, setBuilding] = useState(false);

  const index = useMemo(() => indexRecipes(recipes), [recipes]);
  const resolved = useMemo(() => resolveRefs(recipe, index), [recipe, index]);
  const partOf = useMemo(
    () => dinnersContaining(recipe.id, recipes),
    [recipe.id, recipes],
  );

  /**
   * What you may link. Anything already linked is out, and so is anything that
   * would make a cycle — refusing at the picker is far clearer than letting the
   * link land and having traversal quietly stop somewhere later.
   */
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes
      .filter((r) => r.id !== recipe.id)
      .filter((r) => !componentRefs(recipe).some((ref) => ref.recipeId === r.id))
      .filter((r) => !wouldCycle(recipe.id, r.id, index))
      .filter((r) => (q ? r.title.toLowerCase().includes(q) : true))
      .slice(0, 60);
  }, [recipes, recipe, index, query]);

  const dinner = isDinner(recipe);
  const count = resolved.length;

  const link = (target: Recipe) => {
    onSave(addComponent(recipe, target, index));
    setPicking(false);
    setQuery('');
  };

  const buildPlan = async () => {
    setBuilding(true);
    onHint?.(null);
    try {
      const { plan, source } = await buildCookPlanFromDinner(recipe, index);
      await savePlan(plan);
      if (source === 'fallback') {
        onHint?.('Built offline — steps are grouped by dish, not timed.');
      }
      router.push({ pathname: '/cook-plan/[id]', params: { id: plan.id } });
    } catch {
      onHint?.("Couldn't build a cook plan from this one.");
    } finally {
      setBuilding(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <SectionLabel>Includes</SectionLabel>
        <Pressable
          onPress={() => setPicking(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Add a recipe to this one">
          <Text color="accent">Add recipe</Text>
        </Pressable>
      </View>

      {count === 0 ? (
        // On a dinner the empty state is the instruction. On a plain recipe the
        // header line alone is the affordance — "Includes / Add recipe" — so
        // linking a sub-recipe is discoverable without a paragraph of prompt on
        // every one of the several hundred recipes that will never use it.
        dinner ? (
          <Text color="textFaint" style={styles.empty}>
            No recipes yet. Add the dishes that make up this dinner.
          </Text>
        ) : null
      ) : (
        <View style={styles.list}>
          {resolved.map(({ ref, recipe: target, title, missing }, i) => (
            <View key={ref.id} style={styles.row}>
              <Pressable
                style={styles.rowMain}
                disabled={missing}
                accessibilityRole="button"
                onPress={() =>
                  target &&
                  router.push({ pathname: '/recipes/[id]', params: { id: target.id } })
                }>
                <Glyph name="next" size={13} color={missing ? 'textFaint' : 'accent'} />
                <View style={styles.rowText}>
                  <Text
                    variant="bodyStrong"
                    color={missing ? 'textFaint' : undefined}
                    numberOfLines={1}>
                    {title}
                  </Text>
                  <Text color="textFaint" numberOfLines={1}>
                    {missing
                      ? 'no longer in your library'
                      : [
                          `${target?.ingredients.length ?? 0} ingredients`,
                          ref.scale && ref.scale !== 1 ? `${ref.scale}× batch` : null,
                          ref.note,
                        ]
                          .filter(Boolean)
                          .join('  ·  ')}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => onSave(moveComponent(recipe, ref.id, -1))}
                disabled={i === 0}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Move ${title} up`}>
                <Text color={i === 0 ? 'textFaint' : 'textMuted'}>↑</Text>
              </Pressable>
              <Pressable
                onPress={() => onSave(removeComponent(recipe, ref.id))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${title}`}>
                <Glyph name="close" size={14} color="textFaint" />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {count > 0 ? (
        <Button
          label={building ? 'Building…' : 'Build cook plan'}
          glyph="plan"
          variant="secondary"
          disabled={building}
          onPress={() => void buildPlan()}
        />
      ) : null}

      {partOf.length > 0 ? <PartOf dinners={partOf} /> : null}

      <Overlay visible={picking} onClose={() => setPicking(false)}>
        <View style={styles.sheet}>
          <Heading variant="recipeTitle">Add a recipe</Heading>
          <SearchBar value={query} onChangeText={setQuery} />
          <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
            {candidates.length === 0 ? (
              <Text color="textFaint" style={styles.empty}>
                Nothing to add. Recipes already here, and anything that would
                reference this one back, are left out.
              </Text>
            ) : (
              candidates.map((r) => (
                <Pressable
                  key={r.id}
                  style={styles.candidate}
                  accessibilityRole="button"
                  onPress={() => link(r)}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text color="textFaint" numberOfLines={1}>
                    {[
                      isDinner(r) ? 'dinner' : null,
                      `${r.ingredients.length} ingredients`,
                      r.cuisine ?? null,
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Overlay>
    </View>
  );
}

/** Reverse link — the dinners that serve this recipe. */
function PartOf({ dinners }: { dinners: Recipe[] }) {
  const router = useRouter();
  return (
    <View style={styles.partOf}>
      <Text color="textFaint">Part of</Text>
      {dinners.map((d) => (
        <Pressable
          key={d.id}
          hitSlop={6}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: d.id } })}>
          <Text color="accent">{d.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginTop: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rowText: { flex: 1, gap: 1 },
  empty: { paddingVertical: 10 },
  partOf: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 },
  sheet: { gap: 12, paddingBottom: 8 },
  sheetList: { maxHeight: 360 },
  candidate: {
    paddingVertical: 12,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});
