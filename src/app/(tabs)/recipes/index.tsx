import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
  Fab,
} from '@/components';
import { useRecipeStore } from '@/store/recipes';
import { usePantryStore } from '@/store/pantry';
import { isModified } from '@/lib/recipe';
import { canMakeNow, recipeCoverage } from '@/lib/pantry';
import type { Recipe } from '@/types';

const FILTERS = ['All', 'Have it', 'Weeknight', 'Baking', 'Project', 'Modified'] as const;
type Filter = (typeof FILTERS)[number];

const TAG_FILTER: Partial<Record<Filter, string>> = {
  Weeknight: 'weeknight',
  Baking: 'baking',
  Project: 'project',
};

export default function RecipesLibrary() {
  const router = useRouter();
  const recipes = useRecipeStore((s) => s.recipes);
  const pantry = usePantryStore((s) => s.items);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [activeTag, setActiveTag] = useState<string | null>(null);

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
      // User-tag filter ANDs with the canned filter (spec §6).
      if (activeTag && !r.tags.includes(activeTag)) return false;
      return true;
    });
  }, [recipes, query, filter, activeTag, pantry]);

  const byRecent = (a: Recipe, b: Recipe) =>
    b.modifiedAt.getTime() - a.modifiedAt.getTime();
  const recentlyCooked = filtered.filter((r) => r.cookCount > 0).sort(byRecent);
  const library = filtered.filter((r) => r.cookCount === 0).sort(byRecent);

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <Heading variant="screenTitle">Recipes</Heading>
          <Text color="textMuted">{recipes.length} saved</Text>
        </View>

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
                  active={activeTag === t}
                  onPress={() => setActiveTag(activeTag === t ? null : t)}
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
              <RecipeCard
                key={r.id}
                recipe={r}
                onPress={() =>
                  router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
                }
              />
            ))}
          </Section>
        ) : null}

        {library.length > 0 ? (
          <Section label="Library">
            {library.map((r) => (
              <RecipeCard
                key={r.id}
                recipe={r}
                onPress={() =>
                  router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
                }
              />
            ))}
          </Section>
        ) : null}

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text color="textMuted">No recipes match.</Text>
            <Text color="textFaint">Tap + to capture one.</Text>
          </View>
        ) : null}
      </Screen>

      <Fab onPress={() => router.push('/capture')} />
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
  search: { paddingBottom: 12 },
  chips: { marginHorizontal: -20, paddingHorizontal: 20, paddingBottom: 6 },
  notice: { paddingVertical: 10 },
  section: { paddingTop: 14 },
  sectionLabel: { paddingBottom: 10 },
  sectionBody: { gap: 12 },
  empty: { paddingTop: 60, alignItems: 'center', gap: 6 },
});
