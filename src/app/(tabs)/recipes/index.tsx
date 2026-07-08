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
} from '@/components';
import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';
import { isModified } from '@/lib/recipe';
import { canMakeNow, recipeCoverage } from '@/lib/pantry';
import type { PipelineIdea, Recipe } from '@/types';

const FILTERS = ['All', 'Have it', 'Weeknight', 'Baking', 'Project', 'Modified'] as const;
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

  const byRecent = (a: Recipe, b: Recipe) =>
    b.modifiedAt.getTime() - a.modifiedAt.getTime();
  // Favorites segment reuses the same search/filter path, then pins to flagged.
  const shown = segment === 'favorites' ? filtered.filter((r) => r.isFavorite) : filtered;
  const recentlyCooked = shown.filter((r) => r.cookCount > 0).sort(byRecent);
  const library = shown.filter((r) => r.cookCount === 0).sort(byRecent);

  // To-Try bin = the Pipeline ideas, still-active (unpromoted), newest first.
  const toTry = useMemo(() => {
    const byNew = (a: PipelineIdea, b: PipelineIdea) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return ideas.filter((i) => i.status !== 'promoted').sort(byNew);
  }, [ideas]);

  const favoriteCount = useMemo(
    () => recipes.filter((r) => r.isFavorite).length,
    [recipes],
  );

  const segments = [
    { key: 'totry', label: 'To Try', count: toTry.length },
    { key: 'favorites', label: 'Favorites', count: favoriteCount },
    { key: 'all', label: 'All' },
  ];

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <Heading variant="screenTitle">Recipes</Heading>
          <Text color="textMuted">{recipes.length} saved</Text>
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
            {toTry.map((idea) => (
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
            {toTry.length === 0 ? (
              <View style={styles.empty}>
                <Text color="textMuted">Nothing to try yet.</Text>
                <Text color="textFaint">Capture an idea, ingredient or link.</Text>
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

            {recentlyCooked.length > 0 ? (
              <Section label="Recently cooked">
                {recentlyCooked.map((r) => (
                  <View key={r.id} style={styles.cardCell}>
                    <RecipeCard
                      recipe={r}
                      onPress={() =>
                        router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
                      }
                    />
                  </View>
                ))}
              </Section>
            ) : null}

            {library.length > 0 ? (
              <Section label="Library">
                {library.map((r) => (
                  <View key={r.id} style={styles.cardCell}>
                    <RecipeCard
                      recipe={r}
                      onPress={() =>
                        router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
                      }
                    />
                  </View>
                ))}
              </Section>
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
      </Screen>
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
    alignItems: 'baseline',
    justifyContent: 'space-between',
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
});
