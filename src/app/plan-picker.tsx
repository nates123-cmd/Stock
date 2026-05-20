import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  Overlay,
  SearchBar,
  FilterChip,
  ChipRow,
  SourceBadge,
} from '@/components';
import { colors, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { usePipelineStore } from '@/store/pipeline';
import { bestGuessIngredients } from '@/lib/parsing';
import { dayTag } from '@/lib/week';
import { formatMinutes } from '@/lib/format';
import type { Meal, PipelineIdea, Recipe } from '@/types';

const TABS = ['All', 'Frequent', 'Pipeline'] as const;
type Tab = (typeof TABS)[number];
const CHIPS = ['Have most', 'Weeknight', '< 30 min', 'Recent'] as const;
type Chip = (typeof CHIPS)[number];

export default function PlanPicker() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date: string; meal: Meal }>();
  const date = useMemo(() => new Date(params.date), [params.date]);
  const meal: Meal =
    params.meal === 'breakfast' || params.meal === 'lunch'
      ? params.meal
      : 'dinner';

  const recipes = useRecipeStore((s) => s.recipes);
  const setRecipe = usePlanStore((s) => s.setRecipe);
  const setExperiment = usePlanStore((s) => s.setExperiment);
  const ideas = usePipelineStore((s) => s.ideas);
  const setBestGuess = usePipelineStore((s) => s.setBestGuess);

  const [tab, setTab] = useState<Tab>('All');
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<Chip | null>(null);
  const [expIdea, setExpIdea] = useState<PipelineIdea | null>(null);
  const [bgText, setBgText] = useState('');
  const [busy, setBusy] = useState(false);

  const activeIdeas = useMemo(
    () =>
      ideas
        .filter((i) => i.status !== 'promoted')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [ideas],
  );

  const openExperiment = (idea: PipelineIdea) => {
    setExpIdea(idea);
    setBgText(
      (idea.bestGuessIngredients ?? [])
        .map((i) =>
          `${i.amount ?? ''}${i.unit ? ` ${i.unit}` : ''} ${i.canonicalName}`.trim(),
        )
        .join('\n'),
    );
  };

  const planExperiment = async () => {
    if (!expIdea) return;
    setBusy(true);
    try {
      if (bgText.trim()) {
        const guessed = await bestGuessIngredients(expIdea.title, bgText);
        await setBestGuess(
          expIdea.id,
          guessed.map((g) => g.value),
        );
      }
      await setExperiment(date, meal, expIdea.id);
      setExpIdea(null);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rs = recipes.filter(
      (r) =>
        !q ||
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q)),
    );
    if (chip === 'Weeknight') rs = rs.filter((r) => r.tags.includes('weeknight'));
    if (chip === '< 30 min')
      rs = rs.filter((r) => (r.yield.totalMinutes ?? Infinity) < 30);
    if (chip === 'Recent') rs = rs.filter((r) => r.cookCount > 0);
    if (tab === 'Frequent')
      rs = [...rs].sort((a, b) => b.cookCount - a.cookCount);
    else rs = [...rs].sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return rs;
  }, [recipes, query, chip, tab]);

  const pick = async (r: Recipe) => {
    await setRecipe(date, meal, r.id);
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text variant="sectionLabel" color="accent">
          {dayTag(date)} · {meal}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Cancel
          </Text>
        </Pressable>
      </View>
      <Heading variant="screenTitle" style={styles.title}>
        What are we eating?
      </Heading>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabOn]}>
            <Text variant="bodyStrong" color={tab === t ? 'accent' : 'textMuted'}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'Pipeline' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {activeIdeas.map((idea) => (
            <Pressable key={idea.id} onPress={() => openExperiment(idea)}>
              <Card style={styles.row}>
                <View style={styles.rowMain}>
                  <Text variant="recipeTitle" numberOfLines={1}>
                    {idea.title}
                  </Text>
                  {idea.note ? (
                    <Text color="textMuted" numberOfLines={1}>
                      {idea.note}
                    </Text>
                  ) : null}
                  <Text variant="sectionLabel" color="warn">
                    plan as experiment
                  </Text>
                </View>
                <View style={styles.addBtn}>
                  <Glyph name="add" size={20} color="bg" />
                </View>
              </Card>
            </Pressable>
          ))}
          {activeIdeas.length === 0 ? (
            <Text color="textMuted" style={styles.empty}>
              No ideas in the pipeline yet.
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <>
          <View style={styles.search}>
            <SearchBar value={query} onChangeText={setQuery} placeholder="Search the library" />
          </View>
          <View style={styles.chips}>
            <ChipRow>
              {CHIPS.map((c) => (
                <FilterChip
                  key={c}
                  label={c}
                  active={chip === c}
                  onPress={() => setChip(chip === c ? null : c)}
                />
              ))}
            </ChipRow>
          </View>
          {chip === 'Have most' ? (
            <Text color="textFaint" style={styles.haveNote}>
              Pantry-aware ranking turns on with the Pantry pillar (spec §10).
            </Text>
          ) : null}

          <ScrollView contentContainerStyle={styles.list}>
            {list.map((r) => {
              const time = formatMinutes(r.yield.totalMinutes);
              return (
                <Pressable key={r.id} onPress={() => pick(r)}>
                  <Card style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text variant="recipeTitle" numberOfLines={1}>
                        {r.title}
                      </Text>
                      <View style={styles.rowMeta}>
                        <SourceBadge source={r.source} />
                        {time ? <Numeric color="textMuted">~{time}</Numeric> : null}
                        <Numeric color="textMuted">cooked {r.cookCount}×</Numeric>
                      </View>
                    </View>
                    <View style={styles.addBtn}>
                      <Glyph name="add" size={20} color="bg" />
                    </View>
                  </Card>
                </Pressable>
              );
            })}
            {list.length === 0 ? (
              <Text color="textMuted" style={styles.empty}>
                No recipes match.
              </Text>
            ) : null}
          </ScrollView>
        </>
      )}

      <Overlay visible={!!expIdea} onClose={() => setExpIdea(null)}>
        {expIdea ? (
          <View style={styles.sheet}>
            <Text variant="recipeTitle">{expIdea.title}</Text>
            {expIdea.note ? <Text color="textMuted">{expIdea.note}</Text> : null}
            <SectionLabel color="textMuted">
              What will you probably use?
            </SectionLabel>
            <TextInput
              value={bgText}
              onChangeText={setBgText}
              placeholder="one ingredient per line — 2 onions, 500 g beef, fish sauce"
              placeholderTextColor={colors.textFaint}
              multiline
              style={styles.bgInput}
            />
            <Text color="textFaint" style={styles.sheetNote}>
              Best-guess only — you'll confirm the real ingredients after you
              cook it.
            </Text>
            <Button
              label={busy ? 'Planning…' : 'Plan as experiment'}
              glyph="done"
              disabled={busy}
              onPress={planExperiment}
            />
          </View>
        ) : null}
      </Overlay>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    paddingBottom: 6,
  },
  title: { paddingHorizontal: layout.screenPadding, paddingBottom: 14 },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 12,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.bg3,
  },
  tabOn: { backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.accent },
  notice: { padding: layout.screenPadding },
  search: { paddingHorizontal: layout.screenPadding, paddingBottom: 12 },
  chips: { paddingLeft: layout.screenPadding, paddingBottom: 6 },
  haveNote: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: 6,
    fontStyle: 'italic',
  },
  list: { padding: layout.screenPadding, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowMain: { flex: 1, gap: 8 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { textAlign: 'center', paddingTop: 40 },
  sheet: { gap: 12 },
  bgInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 110,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: 'top',
  },
  sheetNote: { fontStyle: 'italic', lineHeight: 18 },
});
