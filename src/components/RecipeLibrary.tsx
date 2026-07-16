import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { SearchBar } from './SearchBar';
import { FilterChip, ChipRow } from './Chip';
import { RecipeCard } from './RecipeCard';
import { SegmentedControl } from './SegmentedControl';
import { Pill } from './Badge';
import { CookPlanCard } from './CookPlanCard';
import { SectionLabel } from './Text';
import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { useCookPlanStore } from '@/store/cookPlans';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';
import { isModified } from '@/lib/recipe';
import { canMakeNow, recipeCoverage } from '@/lib/pantry';
import type { CookPlan, PipelineIdea, Recipe } from '@/types';

const BASE_FILTERS = ['All', 'Cook plans', 'Have it', 'Weeknight', 'Baking', 'Project', 'Modified'] as const;
type Filter = (typeof BASE_FILTERS)[number];

const TAG_FILTER: Partial<Record<Filter, string>> = {
  Weeknight: 'weeknight',
  Baking: 'baking',
  Project: 'project',
};

type Segment = 'favorites' | 'totry' | 'all';

/**
 * The recipe library browse UI — segments (To Try / All / Favorites), search,
 * canned + user-tag filters, and the responsive card grid with thumbnails.
 * Shared by the Recipes tab (browse: tap opens the recipe) and the plan picker
 * (`addMode`: cards get a red "+" and tapping adds to the week instead).
 *
 * Renders NON-scrolling content — the parent wraps it in a <Screen> (or other
 * scroll container) and supplies the header.
 */
export function RecipeLibrary({
  addMode = false,
  onSelectRecipe,
  onSelectIdea,
  onSelectPlan,
}: {
  addMode?: boolean;
  /** Browse: open the recipe. Add: add it to the plan. */
  onSelectRecipe: (r: Recipe) => void;
  /** Browse: open the idea. Add: plan it as an experiment. */
  onSelectIdea?: (idea: PipelineIdea) => void;
  /** Browse only — open a cook plan. */
  onSelectPlan?: (plan: CookPlan) => void;
}) {
  const recipes = useRecipeStore((s) => s.recipes);
  const toggleFavorite = useRecipeStore((s) => s.toggleFavorite);
  const toggleToTry = useRecipeStore((s) => s.toggleToTry);
  const cookPlans = useCookPlanStore((s) => s.plans);
  const pantry = usePantryStore((s) => s.items);
  const ideas = usePipelineStore((s) => s.ideas);

  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const toggleTag = (t: string) =>
    setActiveTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  // Cook plans aren't addable to a single day, so drop that filter in add mode.
  const FILTERS = addMode ? BASE_FILTERS.filter((f) => f !== 'Cook plans') : BASE_FILTERS;

  const userTags = useMemo(() => {
    const cannedTagSet = new Set(Object.values(TAG_FILTER));
    const counts = new Map<string, number>();
    for (const r of recipes) {
      if (r.status === 'archived') continue;
      for (const t of r.tags) {
        if (cannedTagSet.has(t)) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [recipes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (
        q &&
        !r.title.toLowerCase().includes(q) &&
        !r.tags.some((t) => t.includes(q)) &&
        !r.ingredients.some((i) => i.canonicalName.toLowerCase().includes(q))
      )
        return false;
      if (filter === 'Modified' && !isModified(r)) return false;
      if (filter === 'Have it' && !canMakeNow(recipeCoverage(r.ingredients, pantry)))
        return false;
      const cannedTag = TAG_FILTER[filter];
      if (cannedTag && !r.tags.includes(cannedTag)) return false;
      if (activeTags.length && !activeTags.every((t) => r.tags.includes(t)))
        return false;
      return true;
    });
  }, [recipes, query, filter, activeTags, pantry]);

  const byNewest = (a: Recipe, b: Recipe) =>
    b.createdAt.getTime() - a.createdAt.getTime();
  const shown = useMemo(
    () =>
      (segment === 'favorites' ? filtered.filter((r) => r.isFavorite) : filtered)
        .slice()
        .sort(byNewest),
    [filtered, segment],
  );

  const toTryIdeas = useMemo(() => {
    const byNew = (a: PipelineIdea, b: PipelineIdea) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return ideas.filter((i) => i.status !== 'promoted').sort(byNew);
  }, [ideas]);
  const toTryRecipes = useMemo(
    () => recipes.filter((r) => r.isToTry).slice().sort(byNewest),
    [recipes],
  );

  const favoriteCount = useMemo(
    () => recipes.filter((r) => r.isFavorite).length,
    [recipes],
  );

  const segments = [
    { key: 'totry', label: 'To Try', count: toTryIdeas.length + toTryRecipes.length },
    { key: 'all', label: 'All' },
    { key: 'favorites', label: 'Favorites', count: favoriteCount },
  ];

  const plansMode = filter === 'Cook plans';
  const filteredPlans = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cookPlans
      .filter((p) => p.status !== 'archived')
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          p.spread.some((s) => s.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  }, [cookPlans, query]);

  // Card props differ by mode: browse shows the flag + star and opens on tap;
  // add shows a red "+" (and tap also adds), no flag/star clutter.
  const cardProps = (r: Recipe) =>
    addMode
      ? { onPress: () => onSelectRecipe(r), onAdd: () => onSelectRecipe(r) }
      : {
          onPress: () => onSelectRecipe(r),
          favorite: r.isFavorite,
          onToggleFavorite: () => toggleFavorite(r.id),
          toTry: r.isToTry,
          onToggleToTry: () => toggleToTry(r.id),
        };

  return (
    <>
      <View style={styles.segments}>
        <SegmentedControl
          segments={segments}
          value={segment}
          onChange={(k) => setSegment(k as Segment)}
        />
      </View>

      {segment === 'totry' ? (
        <View style={styles.list}>
          {toTryRecipes.length > 0 ? (
            <View style={styles.sectionBody}>
              {toTryRecipes.map((r) => (
                <View key={r.id} style={styles.cardCell}>
                  <RecipeCard
                    recipe={r}
                    {...cardProps(r)}
                    toTry={r.isToTry}
                    onToggleToTry={() => toggleToTry(r.id)}
                  />
                </View>
              ))}
            </View>
          ) : null}

          {toTryIdeas.map((idea) => (
            <Pressable
              key={idea.id}
              onPress={() => onSelectIdea?.(idea)}
              style={styles.ideaRow}>
              <View style={styles.ideaHead}>
                <Pill label={idea.kind ?? 'idea'} tone="muted" />
                <Text variant="recipeTitle" numberOfLines={1} style={styles.ideaTitle}>
                  {idea.title}
                </Text>
              </View>
              {idea.note ? (
                <Text color="textMuted" numberOfLines={2} style={styles.ideaNote}>
                  {idea.note}
                </Text>
              ) : null}
              {addMode ? (
                <Text variant="sectionLabel" color="warn">
                  plan as experiment
                </Text>
              ) : null}
            </Pressable>
          ))}
          {toTryIdeas.length === 0 && toTryRecipes.length === 0 ? (
            <View style={styles.empty}>
              <Text color="textMuted">Nothing to try yet.</Text>
              <Text color="textFaint">
                Flag a recipe to-try (the ⚐), or capture an idea, ingredient or link.
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.search}>
            <SearchBar value={query} onChangeText={setQuery} />
          </View>

          <View style={styles.chips}>
            <ChipRow>
              {FILTERS.map((f) => (
                <FilterChip
                  key={f}
                  label={f}
                  active={filter === f}
                  onPress={() => setFilter(f)}
                />
              ))}
            </ChipRow>
          </View>

          {userTags.length > 0 ? (
            <View style={styles.chips}>
              <ChipRow>
                {userTags.map((t) => (
                  <FilterChip
                    key={t}
                    label={t}
                    variant="tag"
                    active={activeTags.includes(t)}
                    onPress={() => toggleTag(t)}
                  />
                ))}
              </ChipRow>
            </View>
          ) : null}

          {filter === 'Have it' ? (
            <View style={styles.notice}>
              <Text color="textMuted">
                Recipes the pantry already covers (all but at most one ingredient).
              </Text>
            </View>
          ) : null}

          {!addMode && plansMode ? (
            filteredPlans.length > 0 ? (
              <View style={styles.section}>
                <SectionLabel style={styles.sectionLabel}>Cook plans</SectionLabel>
                <View style={styles.sectionBody}>
                  {filteredPlans.map((p) => (
                    <View key={p.id} style={styles.cardCell}>
                      <CookPlanCard plan={p} onPress={() => onSelectPlan?.(p)} />
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text color="textMuted">No cook plans yet.</Text>
              </View>
            )
          ) : (
            <>
              {shown.length > 0 ? (
                <View style={styles.sectionBody}>
                  {shown.map((r) => (
                    <View key={r.id} style={styles.cardCell}>
                      <RecipeCard recipe={r} {...cardProps(r)} />
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.empty}>
                  <Text color="textMuted">
                    {segment === 'favorites' ? 'No favorites yet.' : 'No recipes match.'}
                  </Text>
                  <Text color="textFaint">
                    {segment === 'favorites'
                      ? 'Star a recipe to pin it here.'
                      : 'Try a different search or filter.'}
                  </Text>
                </View>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  segments: { paddingBottom: 14 },
  search: { paddingBottom: 12 },
  chips: { marginHorizontal: -20, paddingHorizontal: 20, paddingBottom: 6 },
  list: { paddingTop: 4, gap: 12 },
  ideaRow: {
    backgroundColor: colors.bg2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 6,
    minWidth: 0,
  },
  ideaHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ideaTitle: { flex: 1, minWidth: 0 },
  ideaNote: { lineHeight: 19 },
  notice: { paddingVertical: 10 },
  section: { paddingTop: 14 },
  sectionLabel: { paddingBottom: 10 },
  sectionBody: {
    gap: 12,
    ...Platform.select({ web: { flexDirection: 'row', flexWrap: 'wrap' }, default: {} }),
  },
  cardCell: Platform.select({
    web: { flexGrow: 1, flexBasis: 320, minWidth: 280 },
    default: {},
  }),
  empty: { paddingTop: 60, alignItems: 'center', gap: 6 },
});

export default RecipeLibrary;
