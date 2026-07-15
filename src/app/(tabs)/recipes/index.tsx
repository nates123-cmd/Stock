import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  SectionLabel,
  SearchBar,
  FilterChip,
  ChipRow,
  RecipeCard,
  SegmentedControl,
  Pill,
  CookPlanCard,
  Fab,
  Overlay,
} from '@/components';
import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { useCookPlanStore } from '@/store/cookPlans';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';
import { isModified } from '@/lib/recipe';
import { canMakeNow, recipeCoverage } from '@/lib/pantry';
import type { PipelineIdea, Recipe } from '@/types';

const FILTERS = ['All', 'Cook plans', 'Have it', 'Weeknight', 'Baking', 'Project', 'Modified'] as const;
type Filter = (typeof FILTERS)[number];

const TAG_FILTER: Partial<Record<Filter, string>> = {
  Weeknight: 'weeknight',
  Baking: 'baking',
  Project: 'project',
};

type Segment = 'favorites' | 'totry' | 'all';

export default function RecipesLibrary() {
  const router = useRouter();
  const recipes = useRecipeStore((s) => s.recipes);
  const toggleFavorite = useRecipeStore((s) => s.toggleFavorite);
  const toggleToTry = useRecipeStore((s) => s.toggleToTry);
  /** The + sheet: recipe or idea (or a cook plan, in plans mode). */
  const [addOpen, setAddOpen] = useState(false);
  const cookPlans = useCookPlanStore((s) => s.plans);
  const pantry = usePantryStore((s) => s.items);
  const ideas = usePipelineStore((s) => s.ideas);
  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  // Multiple user-tags can be active at once; a recipe must carry ALL of them
  // (AND), matching how the tag filter already ANDs with the canned filter
  // (patch #f5f6d434).
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const toggleTag = (t: string) =>
    setActiveTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  // User-tag chips, generated from the library. Ordered by frequency desc
  // (spec §6). Excludes the canned filter tags so the two strips don't
  // duplicate labels.
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
      if (q && !r.title.toLowerCase().includes(q) && !r.tags.some((t) => t.includes(q)))
        return false;
      if (filter === 'Modified' && !isModified(r)) return false;
      if (filter === 'Have it' && !canMakeNow(recipeCoverage(r.ingredients, pantry)))
        return false;
      const cannedTag = TAG_FILTER[filter];
      if (cannedTag && !r.tags.includes(cannedTag)) return false;
      // User-tag filter ANDs with the canned filter (spec §6) and across every
      // selected tag — recipe must carry all active tags.
      if (activeTags.length && !activeTags.every((t) => r.tags.includes(t)))
        return false;
      return true;
    });
  }, [recipes, query, filter, activeTags, pantry]);

  // Newest-ADDED first (createdAt, not modifiedAt — editing an old recipe
  // shouldn't shove it to the top of the feed).
  const byNewest = (a: Recipe, b: Recipe) =>
    b.createdAt.getTime() - a.createdAt.getTime();
  // Favorites segment reuses the same search/filter path, then pins to flagged.
  const shown = useMemo(
    () =>
      (segment === 'favorites' ? filtered.filter((r) => r.isFavorite) : filtered)
        .slice()
        .sort(byNewest),
    [filtered, segment],
  );

  // "To Try" holds TWO things now: half-baked idea entries (Pipeline ideas,
  // still-active) AND full recipes you've flagged to-try. Both newest-first.
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

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <View>
            <Heading variant="screenTitle">Recipes</Heading>
            <Text color="textMuted">{recipes.length} saved</Text>
          </View>
        </View>

        <View style={styles.segments}>
          <SegmentedControl
            segments={segments}
            value={segment}
            onChange={(k) => setSegment(k as Segment)}
          />
        </View>

        {segment === 'totry' ? (
          <View style={styles.list}>
            {/* Full recipes you've flagged to-try — real cards, tap through to
                the recipe. The flag toggles right here so you can un-try one. */}
            {toTryRecipes.length > 0 ? (
              <View style={styles.sectionBody}>
                {toTryRecipes.map((r) => (
                  <View key={r.id} style={styles.cardCell}>
                    <RecipeCard
                      recipe={r}
                      onPress={() =>
                        router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
                      }
                      toTry={r.isToTry}
                      onToggleToTry={() => toggleToTry(r.id)}
                    />
                  </View>
                ))}
              </View>
            ) : null}

            {/* Half-baked entries: an idea, an ingredient, a link — tap to flesh
                it out (notes, links, attach a recipe). */}
            {toTryIdeas.map((idea) => (
              <Pressable
                key={idea.id}
                onPress={() =>
                  router.push({ pathname: '/idea/[id]', params: { id: idea.id } })
                }
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
              </Pressable>
            ))}
            {toTryIdeas.length === 0 && toTryRecipes.length === 0 ? (
              <View style={styles.empty}>
                <Text color="textMuted">Nothing to try yet.</Text>
                <Text color="textFaint">
                  Flag a recipe to-try (the ⚐), or tap + to capture an idea, ingredient or link.
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
                  Recipes the pantry already covers (all but at most one
                  ingredient) — spec §10.
                </Text>
              </View>
            ) : null}

            {plansMode ? (
              filteredPlans.length > 0 ? (
                <Section label="Cook plans">
                  {filteredPlans.map((p) => (
                    <View key={p.id} style={styles.cardCell}>
                      <CookPlanCard
                        plan={p}
                        onPress={() =>
                          router.push({ pathname: '/cook-plan/[id]', params: { id: p.id } })
                        }
                      />
                    </View>
                  ))}
                </Section>
              ) : (
                <View style={styles.empty}>
                  <Text color="textMuted">No cook plans yet.</Text>
                  <Text color="textFaint">Tap + to build a whole-meal production.</Text>
                </View>
              )
            ) : (
              <>
                {/* One flat feed, newest-added first. The old Recently-cooked /
                    Library split is gone — "recently added on top" only reads as
                    one continuous list. */}
                {shown.length > 0 ? (
                  <View style={styles.sectionBody}>
                    {shown.map((r) => (
                      <View key={r.id} style={styles.cardCell}>
                        <RecipeCard
                          recipe={r}
                          onPress={() =>
                            router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
                          }
                          favorite={r.isFavorite}
                          onToggleFavorite={() => toggleFavorite(r.id)}
                          toTry={r.isToTry}
                          onToggleToTry={() => toggleToTry(r.id)}
                        />
                      </View>
                    ))}
                  </View>
                ) : null}

                {shown.length === 0 ? (
                  <View style={styles.empty}>
                    <Text color="textMuted">
                      {segment === 'favorites' ? 'No favorites yet.' : 'No recipes match.'}
                    </Text>
                    <Text color="textFaint">
                      {segment === 'favorites'
                        ? 'Star a recipe to pin it here.'
                        : 'Tap + to capture one.'}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </>
        )}
      </Screen>

      {/* The ONE capture entry point, and only on this tab — the old global FAB
          over every tab is gone for good. It asks what you're adding rather than
          guessing from the segment. */}
      <Fab onPress={() => setAddOpen(true)} />

      <Overlay visible={addOpen} onClose={() => setAddOpen(false)}>
        <View style={styles.addSheet}>
          <Heading variant="recipeTitle">Add</Heading>
          <Pressable
            style={styles.addChoice}
            accessibilityRole="button"
            onPress={() => {
              setAddOpen(false);
              router.push('/capture');
            }}>
            <Text variant="bodyStrong">Recipe</Text>
            <Text color="textFaint">
              A full recipe — paste a link or text, or write it out.
            </Text>
          </Pressable>
          <Pressable
            style={styles.addChoice}
            accessibilityRole="button"
            onPress={() => {
              setAddOpen(false);
              router.push('/idea-capture');
            }}>
            <Text variant="bodyStrong">Idea</Text>
            <Text color="textFaint">
              A half-baked idea — a dish, an ingredient, a link. Lands in To Try.
            </Text>
          </Pressable>
          {/* Cook plans are a third thing: a whole-meal production. Only offered
              while that filter is on, so it can't have its own competing FAB. */}
          {plansMode ? (
            <Pressable
              style={styles.addChoice}
              accessibilityRole="button"
              onPress={() => {
                setAddOpen(false);
                router.push('/cook-plan-capture');
              }}>
              <Text variant="bodyStrong">Cook plan</Text>
              <Text color="textFaint">A whole-meal production.</Text>
            </Pressable>
          ) : null}
          <Pressable
            style={styles.addCancel}
            onPress={() => setAddOpen(false)}
            accessibilityRole="button">
            <Text color="textMuted">Cancel</Text>
          </Pressable>
        </View>
      </Overlay>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionLabel style={styles.sectionLabel}>{label}</SectionLabel>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    // 'center', not 'baseline' — the Add button sits next to a two-line title.
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 14,
  },
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
  // On web the library has the full browser width, so lay cards out as a
  // responsive grid (multiple columns side by side). Native stays single
  // column. cardCell carries the per-card sizing so RecipeCard itself stays
  // width-independent.
  sectionBody: {
    gap: 12,
    ...Platform.select({ web: { flexDirection: 'row', flexWrap: 'wrap' }, default: {} }),
  },
  cardCell: Platform.select({
    web: { flexGrow: 1, flexBasis: 320, minWidth: 280 },
    default: {},
  }),
  empty: { paddingTop: 60, alignItems: 'center', gap: 6 },
  addSheet: { gap: 4, paddingBottom: 8 },
  addChoice: {
    paddingVertical: 14,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  addCancel: { paddingVertical: 14, alignItems: 'center' },
});
