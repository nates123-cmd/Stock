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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (q && !r.title.toLowerCase().includes(q) && !r.tags.some((t) => t.includes(q)))
        return false;
      if (filter === 'Modified') return isModified(r);
      if (filter === 'Have it')
        return canMakeNow(recipeCoverage(r.ingredients, pantry));
      const tag = TAG_FILTER[filter];
      if (tag) return r.tags.includes(tag);
      return true; // All
    });
  }, [recipes, query, filter, pantry]);

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
