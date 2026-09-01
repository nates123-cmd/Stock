import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { useCookStore } from '@/store/cooks';
import { usePantryStore } from '@/store/pantry';
import { usePipelineStore } from '@/store/pipeline';
import { isModified } from '@/lib/recipe';
import { AUTO_TAGS, matchesQuery, norm } from '@/lib/recipeTags';
import { cuisineLabel, normCuisine } from '@/lib/cuisine';
import { canMakeNow, recipeCoverage } from '@/lib/pantry';
import { folderCounts, inFolder, unfiledCount, UNFILED } from '@/lib/recipeFolders';
import type { CookPlan, PipelineIdea, Recipe } from '@/types';

const BASE_FILTERS = ['All', 'Cook plans', 'Have it', 'Modified'] as const;
type Filter = (typeof BASE_FILTERS)[number];

/* ------------------------------------------------------------------ *
 * Sorting
 * ------------------------------------------------------------------ */

type SortKey = 'added' | 'cooked' | 'favorites' | 'alpha';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'added', label: 'Recently added' },
  { key: 'cooked', label: 'Recently cooked' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'alpha', label: 'A–Z' },
];

const SORT_KEY = 'stock:recipe-sort';
const DENSITY_KEY = 'stock:recipe-density';

type Density = 'comfortable' | 'compact';

/** Persisted UI choices (web localStorage; native falls back to the default —
 *  same pattern as the Plan tab's view toggle). */
function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage?.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    /* ignore (native / private mode) */
  }
}

/**
 * Tag chips come in two rows: the AUTO vocabulary first (always the same
 * chips in the same order, so muscle memory works even when the library
 * changes), then whatever free-form tags you have typed, by frequency.
 * Weeknight / Baking / Project used to be hard-coded "canned filters" here;
 * they are ordinary auto tags now, so the tagger fills them in.
 */

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
  const cooks = useCookStore((s) => s.cooks);
  const pantry = usePantryStore((s) => s.items);
  const ideas = usePipelineStore((s) => s.ideas);

  const [segment, setSegment] = useState<Segment>('all');
  /**
   * Selected folder: null = all folders, UNFILED = the ones in none.
   *
   * Deliberately NOT reset when the segment changes — folders are shared, so
   * staying in "Weeknight" while you flip All → Favorites is the whole point.
   */
  const [folderSel, setFolderSel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const toggleTag = (t: string) =>
    setActiveTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  /**
   * Cuisines OR together, unlike tags.
   *
   * A recipe has exactly one cuisine, so AND-ing them the way the tag chips do
   * would make every two-chip selection return nothing. Picking Italian and
   * Thai plainly means "either".
   */
  const [activeCuisines, setActiveCuisines] = useState<string[]>([]);
  const toggleCuisine = (c: string) =>
    setActiveCuisines((cur) =>
      cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c],
    );

  const [sort, setSort] = useState<SortKey>(() =>
    loadPref<SortKey>(SORT_KEY, ['added', 'cooked', 'favorites', 'alpha'], 'added'),
  );
  const chooseSort = (k: SortKey) => {
    setSort(k);
    savePref(SORT_KEY, k);
  };

  /**
   * Density.
   *
   * Filters and sorters add a band of chrome above the list, so they had to be
   * designed with the "too little fits on a phone" complaint rather than
   * against it. Two things do that work together:
   *
   *   1. the filter controls COLLAPSE (they used to be three permanently-open
   *      chip rows, which cost more height than the new band does even when
   *      it's open), and
   *   2. a density toggle, defaulting to compact rows on a phone-width
   *      viewport and full cards on a wide one.
   *
   * A toggle rather than a fixed choice because it's genuinely two modes:
   * browsing for something to cook wants pictures, hunting for a specific
   * recipe wants a list. The default is per-width; the choice, once made,
   * persists and wins everywhere.
   */
  const { width: viewportWidth } = useWindowDimensions();
  const phone = viewportWidth < 700;
  const [densityPref, setDensityPref] = useState<Density | null>(() => {
    const v = loadPref<Density | 'auto'>(
      DENSITY_KEY,
      ['comfortable', 'compact', 'auto'],
      'auto',
    );
    return v === 'auto' ? null : v;
  });
  const density: Density = densityPref ?? (phone ? 'compact' : 'comfortable');
  const toggleDensity = () => {
    const next: Density = density === 'compact' ? 'comfortable' : 'compact';
    setDensityPref(next);
    savePref(DENSITY_KEY, next);
  };

  // Newest cook per recipe — the "recently cooked" sort key. `cookCount` on the
  // recipe says HOW MANY times, never WHEN, so it can't order anything.
  const lastCookedAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cooks) {
      const at = new Date(c.finishedAt ?? c.startedAt).getTime();
      if (!Number.isFinite(at)) continue;
      const prev = m.get(c.recipeId);
      if (prev == null || at > prev) m.set(c.recipeId, at);
    }
    return m;
  }, [cooks]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (filter !== 'All' ? 1 : 0) + activeTags.length + activeCuisines.length;
  const clearFilters = () => {
    setFilter('All');
    setActiveTags([]);
    setActiveCuisines([]);
  };

  // Cook plans aren't addable to a single day, so drop that filter in add mode.
  const FILTERS = addMode ? BASE_FILTERS.filter((f) => f !== 'Cook plans') : BASE_FILTERS;

  /** Cuisines something in the library actually has, most-used first. An
   *  always-empty chip is noise, same rule as the auto-tag chips. */
  const cuisinesInUse = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of recipes) {
      if (r.status === 'archived') continue;
      if (!r.cuisine) continue;
      const c = normCuisine(r.cuisine);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([c]) => c);
  }, [recipes]);

  const { autoTagsInUse, userTags } = useMemo(() => {
    const autoSet = new Set<string>(AUTO_TAGS);
    const counts = new Map<string, number>();
    for (const r of recipes) {
      if (r.status === 'archived') continue;
      for (const t of r.tags) counts.set(norm(t), (counts.get(norm(t)) ?? 0) + 1);
    }
    return {
      // Vocabulary order, but only the ones something actually has — an
      // always-empty chip is just noise.
      autoTagsInUse: AUTO_TAGS.filter((t) => counts.has(t)),
      userTags: [...counts.entries()]
        .filter(([t]) => !autoSet.has(t))
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t),
    };
  }, [recipes]);

  const filtered = useMemo(() => {
    return recipes.filter((r) => {
      // Every search term must match something (title / tag / ingredient), so
      // "quick chicken" narrows rather than widening. `tag:x` restricts a term
      // to tags. See lib/recipeTags.ts.
      if (!matchesQuery(r, query)) return false;
      if (filter === 'Modified' && !isModified(r)) return false;
      if (filter === 'Have it' && !canMakeNow(recipeCoverage(r.ingredients, pantry)))
        return false;
      // Chips are AND-ed: "vegetarian" + "quick" means both.
      if (activeTags.length) {
        const mine = new Set(r.tags.map(norm));
        if (!activeTags.every((t) => mine.has(norm(t)))) return false;
      }
      // Cuisines OR (see activeCuisines above) — a recipe has only one.
      if (activeCuisines.length) {
        if (!r.cuisine) return false;
        if (!activeCuisines.includes(normCuisine(r.cuisine))) return false;
      }
      return true;
    });
  }, [recipes, query, filter, activeTags, activeCuisines, pantry]);

  const byNewest = (a: Recipe, b: Recipe) =>
    b.createdAt.getTime() - a.createdAt.getTime();

  /**
   * The comparators.
   *
   * Every one of them falls back to newest-first, so a sort can never leave the
   * list in an arbitrary order: recipes that have never been cooked, or that
   * tie alphabetically, still come out in a stable and meaningful sequence.
   */
  const comparators: Record<SortKey, (a: Recipe, b: Recipe) => number> = useMemo(
    () => ({
      added: byNewest,
      cooked: (a, b) => {
        // Never-cooked sinks to the bottom rather than sorting as "epoch",
        // which would put it above everything in a descending sort.
        const at = lastCookedAt.get(a.id) ?? -Infinity;
        const bt = lastCookedAt.get(b.id) ?? -Infinity;
        if (at !== bt) return bt - at;
        return byNewest(a, b);
      },
      favorites: (a, b) => {
        const af = a.isFavorite ? 1 : 0;
        const bf = b.isFavorite ? 1 : 0;
        if (af !== bf) return bf - af;
        return byNewest(a, b);
      },
      alpha: (a, b) => {
        const c = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
        return c !== 0 ? c : byNewest(a, b);
      },
    }),
    [lastCookedAt],
  );

  /**
   * The recipes this segment is about, BEFORE the folder filter.
   *
   * The folder bar's counts are computed from this, which is what makes one
   * shared folder bar serve all three segments: pick "Favorites" and
   * "Weeknight" reads 4 because four of your favourites are in it, not because
   * the library has four Weeknight recipes.
   */
  const segmentBase = useMemo(
    () => (segment === 'favorites' ? filtered.filter((r) => r.isFavorite) : filtered),
    [filtered, segment],
  );

  const allShown = useMemo(
    () =>
      segmentBase
        .filter((r) => inFolder(r, folderSel))
        .slice()
        .sort(comparators[sort]),
    [segmentBase, folderSel, comparators, sort],
  );

  /**
   * How many cards to actually render.
   *
   * The library used to render every recipe at once — 163 of them — and the
   * page died on mobile Safari. Shrinking the thumbnails 700→384px cut the
   * decoded bitmap from 80 MB to 24, but the heap stayed at ~172 MB: the images
   * were never the biggest cost, the 163 mounted card components were.
   *
   * A hard cap plus "Show more" rather than viewport-based lazy loading,
   * because IntersectionObserver does NOT fire in this react-native-web tree —
   * it silently never callbacks, even on an element sitting on screen, so that
   * approach shipped blank thumbnails once already. A count is dumb and cannot
   * fail quietly.
   *
   * Search and filters run over the FULL list; this only limits what's drawn,
   * so nothing becomes unfindable — it just takes another tap to reach.
   */
  const PAGE = 36;
  const [limit, setLimit] = useState(PAGE);
  // A new search/filter should start from the top again, not deep in a list
  // that no longer exists.
  useEffect(() => {
    setLimit(PAGE);
  }, [query, filter, segment, activeTags, activeCuisines, sort, folderSel]);
  const shown = useMemo(() => allShown.slice(0, limit), [allShown, limit]);
  const more = allShown.length - shown.length;

  const toTryIdeas = useMemo(() => {
    // A half-baked idea is not a recipe and cannot be filed, so narrowing to a
    // folder has to hide them — otherwise every folder would show the same
    // untouched pile of ideas underneath it.
    if (folderSel !== null) return [];
    const byNew = (a: PipelineIdea, b: PipelineIdea) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return ideas.filter((i) => i.status !== 'promoted').sort(byNew);
  }, [ideas, folderSel]);
  const toTryAll = useMemo(
    () => recipes.filter((r) => r.isToTry).slice().sort(byNewest),
    [recipes],
  );
  const toTryRecipes = useMemo(
    () => toTryAll.filter((r) => inFolder(r, folderSel)),
    [toTryAll, folderSel],
  );

  /**
   * The folder bar, scoped to whichever segment is showing. Built from the
   * recipes themselves — there is no folder table (see lib/recipeFolders.ts).
   */
  const folderSource = segment === 'totry' ? toTryAll : segmentBase;
  const folders = useMemo(() => {
    const found = folderCounts(folderSource);
    // Keep the SELECTED folder on the bar even when nothing in this segment is
    // in it. Otherwise switching All → To Try makes the active chip disappear
    // while the filter stays on: the list looks empty for no visible reason and
    // there is no way to switch the folder off except "All folders".
    if (
      folderSel !== null &&
      folderSel !== UNFILED &&
      !found.some((f) => f.name.toLowerCase() === folderSel.toLowerCase())
    ) {
      return [...found, { name: folderSel, count: 0 }].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
    }
    return found;
  }, [folderSource, folderSel]);
  const unfiled = useMemo(() => unfiledCount(folderSource), [folderSource]);

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
      ? { onPress: () => onSelectRecipe(r), onAdd: () => onSelectRecipe(r), density }
      : {
          onPress: () => onSelectRecipe(r),
          favorite: r.isFavorite,
          onToggleFavorite: () => toggleFavorite(r.id),
          toTry: r.isToTry,
          onToggleToTry: () => toggleToTry(r.id),
          density,
        };

  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? 'Recently added';
  const compact = density === 'compact';

  return (
    <>
      <View style={styles.segments}>
        <SegmentedControl
          segments={segments}
          value={segment}
          onChange={(k) => setSegment(k as Segment)}
        />
      </View>

      {/* Folders are shared across every segment, so this bar sits above the
          segment's content rather than inside any one of them. Hidden until
          something is actually filed — an empty folder bar is just noise. */}
      {(folders.length > 0 || folderSel !== null) && (
        <View style={styles.folderRow}>
        <ChipRow>
          <FilterChip
            label="All folders"
            active={folderSel === null}
            onPress={() => setFolderSel(null)}
          />
          {folders.map((f) => (
            <FilterChip
              key={f.name}
              label={`${f.name} ${f.count}`}
              active={folderSel !== null && folderSel !== UNFILED && folderSel.toLowerCase() === f.name.toLowerCase()}
              onPress={() => setFolderSel(f.name)}
            />
          ))}
          {unfiled > 0 && (
            <FilterChip
              label={`Unfiled ${unfiled}`}
              active={folderSel === UNFILED}
              onPress={() => setFolderSel(UNFILED)}
            />
          )}
        </ChipRow>
        </View>
      )}

      {segment === 'totry' ? (
        <View style={styles.list}>
          {toTryRecipes.length > 0 ? (
            <View style={compact ? styles.rowBody : styles.sectionBody}>
              {toTryRecipes.map((r) => (
                <View key={r.id} style={compact ? undefined : styles.cardCell}>
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
              {/* Say WHICH empty this is. A folder filter that hides everything
                  must not read as "you have nothing to try". */}
              {folderSel !== null ? (
                <>
                  <Text color="textMuted">
                    Nothing to try in{' '}
                    {folderSel === UNFILED ? 'Unfiled' : folderSel}.
                  </Text>
                  <Text color="textFaint">
                    Pick “All folders” above to see the rest.
                  </Text>
                </>
              ) : (
                <>
                  <Text color="textMuted">Nothing to try yet.</Text>
                  <Text color="textFaint">
                    Flag a recipe to-try (the ⚐), or capture an idea, ingredient or link.
                  </Text>
                </>
              )}
            </View>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.search}>
            <SearchBar
              value={query}
              onChangeText={setQuery}
              placeholder="Search title, tag or ingredient"
            />
          </View>

          {/* One control line: Filters (with a live count) · Sort · Density.
              The chip rows below it are COLLAPSED by default — they used to be
              three permanently-open rows, so even with filters open this is no
              taller than what it replaced, and closed it is much shorter. */}
          <View style={styles.controlRow}>
            <Pressable
              onPress={() => setFiltersOpen((v) => !v)}
              style={[styles.control, filtersOpen && styles.controlOpen]}
              accessibilityRole="button"
              accessibilityState={{ expanded: filtersOpen }}
              accessibilityLabel={
                activeFilterCount > 0
                  ? `Filters, ${activeFilterCount} active`
                  : 'Filters'
              }>
              <Text variant="sectionLabel" color={activeFilterCount ? 'accent' : 'textMuted'}>
                {activeFilterCount > 0 ? `Filters · ${activeFilterCount}` : 'Filters'}
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                chooseSort(
                  SORTS[(SORTS.findIndex((s) => s.key === sort) + 1) % SORTS.length]!.key,
                )
              }
              style={styles.control}
              accessibilityRole="button"
              accessibilityLabel={`Sort: ${sortLabel}. Tap to change.`}>
              <Text variant="sectionLabel" color="textMuted">
                {sortLabel}
              </Text>
            </Pressable>

            <Pressable
              onPress={toggleDensity}
              style={styles.control}
              accessibilityRole="button"
              accessibilityLabel={
                density === 'compact'
                  ? 'Compact list. Switch to cards.'
                  : 'Cards. Switch to a compact list.'
              }>
              <Text variant="sectionLabel" color="textMuted">
                {density === 'compact' ? 'List' : 'Cards'}
              </Text>
            </Pressable>

            {activeFilterCount > 0 ? (
              <Pressable
                onPress={clearFilters}
                style={styles.control}
                accessibilityRole="button"
                accessibilityLabel="Clear all filters">
                <Text variant="sectionLabel" color="warn">
                  Clear
                </Text>
              </Pressable>
            ) : null}
          </View>

          {filtersOpen ? (
            <>
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

              {/* Sorters get a row of their own once the panel is open — the
                  cycle button above is the fast path, this is the direct one. */}
              <View style={styles.chips}>
                <ChipRow>
                  {SORTS.map((s) => (
                    <FilterChip
                      key={s.key}
                      label={s.label}
                      active={sort === s.key}
                      onPress={() => chooseSort(s.key)}
                    />
                  ))}
                </ChipRow>
              </View>

              {cuisinesInUse.length > 0 ? (
                <View style={styles.chips}>
                  <ChipRow>
                    {cuisinesInUse.map((c) => (
                      <FilterChip
                        key={c}
                        label={cuisineLabel(c)}
                        variant="tag"
                        active={activeCuisines.includes(c)}
                        onPress={() => toggleCuisine(c)}
                      />
                    ))}
                  </ChipRow>
                </View>
              ) : null}

              {autoTagsInUse.length > 0 ? (
                <View style={styles.chips}>
                  <ChipRow>
                    {autoTagsInUse.map((t) => (
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
            </>
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
                <View style={compact ? styles.rowBody : styles.sectionBody}>
                  {shown.map((r) => (
                    <View key={r.id} style={compact ? undefined : styles.cardCell}>
                      <RecipeCard recipe={r} {...cardProps(r)} />
                    </View>
                  ))}
                </View>
              ) : null}
              {more > 0 ? (
                <Pressable
                  onPress={() => setLimit((n) => n + PAGE)}
                  style={styles.showMore}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${Math.min(more, PAGE)} more of ${allShown.length} recipes`}>
                  <Text variant="bodyStrong" color="accent">
                    Show {Math.min(more, PAGE)} more · {more} not shown
                  </Text>
                </Pressable>
              ) : null}
              {shown.length === 0 ? (
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
              ) : null}
            </>
          )}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  showMore: { alignItems: 'center', paddingVertical: 16 },
  segments: { paddingBottom: 10 },
  folderRow: { paddingBottom: 10 },
  search: { paddingBottom: 8 },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    paddingBottom: 8,
  },
  control: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
  },
  controlOpen: { borderColor: colors.accent },
  // Compact rows are a single column with a hairline gap — the web wrap grid
  // (cardCell, flexBasis 320) would put two thin rows side by side, which
  // reads as a broken table rather than a list.
  rowBody: { gap: 6 },
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
