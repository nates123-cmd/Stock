import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Overlay } from '@/components';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, Heading, Numeric, SectionLabel, Glyph, Card, Button, IngredientAmount, IngredientName } from '@/components';
import { SourceBadge } from '@/components';
import { colors, layout } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { modCount, ingredientAnnotation } from '@/lib/recipe';
import { convertToGrams } from '@/lib/parsing';
import type { Ingredient } from '@/types';
import { formatMinutes, formatAmount } from '@/lib/format';
import type { Nutrition, RecipeSource } from '@/types';

const SOURCE_NAME: Record<RecipeSource['type'], string> = {
  nyt: 'NYT Cooking',
  yt: 'YouTube',
  book: 'the book',
  mine: 'mine',
  web: 'the web',
};

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const recipe = useRecipeStore((s) => s.recipes.find((r) => r.id === id));
  const allRecipes = useRecipeStore((s) => s.recipes);
  const save = useRecipeStore((s) => s.save);
  // Autocomplete source for the tag editor — every tag used anywhere in the
  // library, deduped case-insensitively (spec §6 tag editor).
  const allTagsAcrossLibrary = useMemo(() => {
    const seen = new Map<string, string>(); // lower → original casing
    for (const r of allRecipes) {
      for (const t of r.tags) {
        const k = t.toLowerCase().trim();
        if (!seen.has(k)) seen.set(k, t);
      }
    }
    return [...seen.values()].sort();
  }, [allRecipes]);
  const [clean, setClean] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  /** Conversion preview — each candidate is the ingredient + its proposed grams. */
  const [convertPreview, setConvertPreview] = useState<
    Array<{ ing: Ingredient; grams: number }> | null
  >(null);
  /** ids the user has unchecked in the preview (default = all on). */
  const [convertOff, setConvertOff] = useState<Set<string>>(new Set());
  /** Non-null while the Scale overlay is open; carries the proposed serves. */
  const [scalingTo, setScalingTo] = useState<number | null>(null);
  const [editingSource, setEditingSource] = useState(false);
  const [sourceNameInput, setSourceNameInput] = useState('');
  const [sourceUrlInput, setSourceUrlInput] = useState('');

  // Always land on the Recipes library — the back button is literally
  // labeled "Recipes", and following history dropped users back into Plan
  // when they tapped a meal cell to open a recipe.
  const goBack = () => router.replace('/recipes');

  if (!recipe) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <TopBar onBack={goBack} clean={clean} onToggleClean={() => setClean((c) => !c)} />
        <View style={styles.missing}>
          <Text color="textMuted">Recipe not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const mods = modCount(recipe);
  const time = formatMinutes(recipe.yield.totalMinutes);
  const steps = [...recipe.steps].sort((a, b) => a.ordinal - b.ordinal);

  // Wide-viewport two-column layout (spec §6). 768px breakpoint matches
  // standard tablet/desktop split; the columns are width-independent so
  // ingredient/step rows render the same in either orientation.
  const { width: viewportWidth } = useWindowDimensions();
  const wide = viewportWidth >= 768;

  const previewConvertToGrams = async () => {
    setConverting(true);
    setHint(null);
    try {
      const results = await convertToGrams(recipe.ingredients);
      if (results.length === 0) {
        setHint(
          'Nothing to convert — all amounts are already in grams (or are counted items / to-taste).',
        );
        return;
      }
      const byId = new Map(results.map((r) => [r.id, r.grams]));
      const candidates = recipe.ingredients
        .filter((i) => byId.has(i.id))
        .map((ing) => ({ ing, grams: byId.get(ing.id) as number }));
      setConvertPreview(candidates);
      setConvertOff(new Set());
    } catch (e) {
      setHint(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setConverting(false);
    }
  };

  const applyConversionPreview = async () => {
    if (!convertPreview) return;
    const toApply = convertPreview.filter((c) => !convertOff.has(c.ing.id));
    if (toApply.length === 0) {
      setConvertPreview(null);
      return;
    }
    const byId = new Map(toApply.map((c) => [c.ing.id, c.grams]));
    // Pure data update — unit conversion is a transformation, not an edit,
    // so don't push a Modification (no strikethrough diff).
    const updated = recipe.ingredients.map((ing) => {
      const grams = byId.get(ing.id);
      if (grams == null) return ing;
      return { ...ing, amount: grams, unit: 'g' };
    });
    await save({ ...recipe, ingredients: updated, modifiedAt: new Date() });
    setHint(
      `Converted ${toApply.length} ${toApply.length === 1 ? 'ingredient' : 'ingredients'} to grams.`,
    );
    setConvertPreview(null);
  };

  const toggleConvertCandidate = (id: string) =>
    setConvertOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyScale = async () => {
    if (scalingTo == null || scalingTo === recipe.yield.serves || scalingTo < 1) {
      setScalingTo(null);
      return;
    }
    const ratio = scalingTo / recipe.yield.serves;
    const updated = recipe.ingredients.map((ing) =>
      ing.amount == null
        ? ing
        : { ...ing, amount: Math.round(ing.amount * ratio * 100) / 100 },
    );
    await save({
      ...recipe,
      ingredients: updated,
      yield: { ...recipe.yield, serves: scalingTo },
      modifiedAt: new Date(),
    });
    setHint(`Scaled to ${scalingTo} servings.`);
    setScalingTo(null);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TopBar onBack={goBack} clean={clean} onToggleClean={() => setClean((c) => !c)} />

      <ScrollView contentContainerStyle={styles.content}>
        {recipe.imageUrl ? (
          <Image
            source={{ uri: recipe.imageUrl }}
            style={styles.hero}
            resizeMode="cover"
          />
        ) : null}
        <Heading variant="screenTitle" style={styles.title}>
          {recipe.title}
        </Heading>

        <View style={styles.metaRow}>
          <Pressable
            onPress={() => {
              setSourceNameInput(recipe.source.name ?? '');
              setSourceUrlInput(recipe.source.url ?? '');
              setEditingSource(true);
            }}
            hitSlop={6}>
            <SourceBadge source={recipe.source} />
          </Pressable>
          {mods > 0 ? (
            <Numeric color="accent">
              {mods} {mods === 1 ? 'mod' : 'mods'}
            </Numeric>
          ) : null}
          <Numeric color="textMuted">serves {recipe.yield.serves}</Numeric>
          {time ? <Numeric color="textMuted">~{time}</Numeric> : null}
          <Numeric color="textMuted">cooked {recipe.cookCount}×</Numeric>
        </View>

        {editingSource ? (
          <Card style={styles.sourceEdit}>
            <SectionLabel color="textMuted">Source</SectionLabel>
            <TextInput
              value={sourceNameInput}
              onChangeText={setSourceNameInput}
              placeholder="e.g. NYT Cooking, Bon Appétit, Grandma"
              placeholderTextColor={colors.textFaint}
              style={styles.sourceField}
            />
            <TextInput
              value={sourceUrlInput}
              onChangeText={setSourceUrlInput}
              placeholder="https://… (optional)"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.sourceField}
            />
            <View style={styles.sourceEditRow}>
              <Pressable onPress={() => setEditingSource(false)} hitSlop={8}>
                <Text variant="bodyStrong" color="textMuted">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const name = sourceNameInput.trim() || undefined;
                  const url = sourceUrlInput.trim() || undefined;
                  await save({
                    ...recipe,
                    source: { ...recipe.source, name, url },
                    modifiedAt: new Date(),
                  });
                  setEditingSource(false);
                }}
                hitSlop={8}>
                <Text variant="bodyStrong" color="accent">
                  Save
                </Text>
              </Pressable>
            </View>
          </Card>
        ) : null}

        {recipe.nutrition ? <NutritionCard n={recipe.nutrition} /> : null}

        {!clean ? (
          <TagEditor
            tags={recipe.tags}
            allTags={allTagsAcrossLibrary}
            onChange={(tags) => save({ ...recipe, tags, modifiedAt: new Date() })}
          />
        ) : null}

        <View style={styles.toolbar}>
          <Button
            label="Cook"
            glyph="done"
            flex
            onPress={() =>
              router.push({ pathname: '/cook/[id]', params: { id: recipe.id } })
            }
          />
          <Button
            label={converting ? 'Converting…' : 'To grams'}
            glyph="bench"
            variant="secondary"
            flex
            disabled={converting}
            onPress={previewConvertToGrams}
          />
          <Button
            label="Scale"
            variant="secondary"
            flex
            onPress={() => setScalingTo(recipe.yield.serves)}
          />
        </View>
        {hint ? (
          <Text color="textMuted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}

        <View style={wide ? styles.twoCol : undefined}>
          <View style={wide ? styles.colLeft : undefined}>
            <SectionLabel style={styles.sectionLabel}>Ingredients</SectionLabel>
            <View style={styles.ingredients}>
              {recipe.ingredients.map((ing) => {
                const annotation = clean ? null : ingredientAnnotation(ing);
                return (
                  <View key={ing.id} style={styles.ingRow}>
                    <IngredientAmount
                      ing={ing}
                      style={[styles.amount, clean && styles.cleanAmount]}
                    />
                    <View style={styles.ingText}>
                      <View style={styles.ingNameRow}>
                        <IngredientName ing={ing} style={clean ? styles.cleanBody : undefined} />
                        {ing.inlineNote ? (
                          <Text color="textFaint">{`  · ${ing.inlineNote}`}</Text>
                        ) : null}
                      </View>
                      {annotation ? (
                        <Text color="accent" style={styles.annotation}>
                          {annotation}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={wide ? styles.colRight : undefined}>
            <SectionLabel style={styles.sectionLabel}>Method</SectionLabel>
            <View style={styles.method}>
              {steps.map((s) => (
                <View key={s.id} style={styles.stepRow}>
                  <Text variant="recipeTitle" color="accent" style={styles.stepNum}>
                    {s.ordinal}
                  </Text>
                  <Text style={[styles.stepBody, clean && styles.cleanBody]}>
                    {s.body}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {!clean ? (
          <NotesEditor
            key={recipe.id}
            initial={recipe.myNotes ?? ''}
            onSave={(text) =>
              save({
                ...recipe,
                myNotes: text.trim() || undefined,
                modifiedAt: new Date(),
              })
            }
          />
        ) : null}

        {!clean && mods > 0 ? (
          <Pressable onPress={() => setHint('History timeline / diff / snapshot is build step 9 — spec §6.')}>
            <Text color="textMuted" style={styles.link}>
              View history →
            </Text>
          </Pressable>
        ) : null}

        {!clean ? (
          <SourceLink source={recipe.source} />
        ) : null}
      </ScrollView>

      <Overlay
        visible={scalingTo != null}
        onClose={() => setScalingTo(null)}>
        {scalingTo != null ? (
          <View style={styles.scaleSheet}>
            <Text variant="recipeTitle">Scale recipe</Text>
            <Text color="textFaint" style={styles.scaleHint}>
              Multiplies all amounts. Tweak anything weird afterward (tap an
              ingredient to fine-tune).
            </Text>
            <View style={styles.scaleControl}>
              <Pressable
                onPress={() => setScalingTo(Math.max(1, scalingTo - 1))}
                style={styles.scaleBtn}
                hitSlop={8}>
                <Text variant="recipeTitle">−</Text>
              </Pressable>
              <View style={styles.scaleNumWrap}>
                <Numeric color="text" style={styles.scaleNum}>
                  {scalingTo}
                </Numeric>
                <Text color="textMuted">servings</Text>
              </View>
              <Pressable
                onPress={() => setScalingTo(Math.min(99, scalingTo + 1))}
                style={styles.scaleBtn}
                hitSlop={8}>
                <Text variant="recipeTitle">+</Text>
              </Pressable>
            </View>
            <Text color="textMuted" style={styles.scaleRatio}>
              {scalingTo === recipe.yield.serves
                ? `Same as current (${recipe.yield.serves})`
                : `${(scalingTo / recipe.yield.serves).toFixed(scalingTo / recipe.yield.serves >= 1 ? 2 : 2).replace(/\.?0+$/, '')}× from ${recipe.yield.serves}`}
            </Text>
            <ScrollView style={styles.scaleList}>
              {recipe.ingredients.map((ing) => {
                if (ing.amount == null) return null;
                const newAmt =
                  Math.round(
                    ing.amount * (scalingTo / recipe.yield.serves) * 100,
                  ) / 100;
                return (
                  <View key={ing.id} style={styles.scaleRow}>
                    <Text style={styles.convertName} numberOfLines={1}>
                      {ing.canonicalName}
                    </Text>
                    <Numeric color="textMuted">
                      {formatAmount(ing.amount, ing.unit)} →{' '}
                      {formatAmount(newAmt, ing.unit)}
                    </Numeric>
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.convertButtons}>
              <Button
                label="Cancel"
                variant="secondary"
                flex
                onPress={() => setScalingTo(null)}
              />
              <Button
                label="Apply"
                glyph="done"
                flex
                disabled={scalingTo === recipe.yield.serves}
                onPress={applyScale}
              />
            </View>
          </View>
        ) : null}
      </Overlay>

      <Overlay
        visible={convertPreview != null}
        onClose={() => setConvertPreview(null)}>
        {convertPreview ? (
          <View style={styles.convertSheet}>
            <Text variant="recipeTitle">Convert to grams</Text>
            <Text color="textFaint" style={styles.convertHint}>
              Uncheck anything you'd rather keep in its original units.
            </Text>
            <ScrollView style={styles.convertList}>
              {convertPreview.map(({ ing, grams }) => {
                const on = !convertOff.has(ing.id);
                return (
                  <Pressable
                    key={ing.id}
                    onPress={() => toggleConvertCandidate(ing.id)}
                    style={styles.convertRow}>
                    <View style={[styles.convertCheck, on && styles.convertCheckOn]}>
                      {on ? <Glyph name="done" size={12} color="bg" /> : null}
                    </View>
                    <Text style={styles.convertName}>{ing.canonicalName}</Text>
                    <Numeric color="textMuted">
                      {formatAmount(ing.amount, ing.unit)} → {grams} g
                    </Numeric>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.convertButtons}>
              <Button
                label="Cancel"
                variant="secondary"
                flex
                onPress={() => setConvertPreview(null)}
              />
              <Button
                label={`Convert ${convertPreview.length - convertOff.size}`}
                glyph="done"
                flex
                disabled={convertPreview.length - convertOff.size === 0}
                onPress={applyConversionPreview}
              />
            </View>
          </View>
        ) : null}
      </Overlay>
    </SafeAreaView>
  );
}

function NutritionCard({ n }: { n: Nutrition }) {
  const cells: [string, number | undefined, string][] = [
    ['kcal', n.calories, ''],
    ['protein', n.protein, 'g'],
    ['carbs', n.carbs, 'g'],
    ['fat', n.fat, 'g'],
  ];
  return (
    <Card style={styles.nutri}>
      <View style={styles.nutriHead}>
        <SectionLabel color="textMuted">Nutrition · per serving</SectionLabel>
        <Text
          variant="sectionLabel"
          color={n.source === 'extracted' ? 'textMuted' : 'warn'}>
          {n.source === 'extracted' ? 'from source' : 'estimated'}
        </Text>
      </View>
      <View style={styles.nutriRow}>
        {cells
          .filter(([, v]) => v != null)
          .map(([label, v, u]) => (
            <View key={label} style={styles.nutriCell}>
              <Numeric color="text" style={styles.nutriVal}>
                {Math.round(v as number)}
                {u}
              </Numeric>
              <Text color="textFaint" style={styles.nutriLabel}>
                {label}
              </Text>
            </View>
          ))}
      </View>
    </Card>
  );
}

/**
 * Recipe tag editor (spec §6). Chip strip with × removal + inline add input
 * with library-wide autocomplete. No explicit save — every mutation
 * propagates via onChange (parent debounce-saves like other free text).
 */
function TagEditor({
  tags,
  allTags,
  onChange,
}: {
  tags: string[];
  allTags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [] as string[];
    return allTags
      .filter((t) => t.toLowerCase().includes(q) && !tagSet.has(t.toLowerCase()))
      .slice(0, 6);
  }, [draft, allTags, tagSet]);

  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) {
      setAdding(false);
      setDraft('');
      return;
    }
    if (tagSet.has(t.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...tags, t]);
    setDraft('');
  };

  const remove = (t: string) => {
    onChange(tags.filter((x) => x !== t));
  };

  return (
    <View style={tagStyles.wrap}>
      <SectionLabel color="textMuted" style={tagStyles.label}>
        Tags
      </SectionLabel>
      <View style={tagStyles.row}>
        {tags.map((t) => (
          <View key={t} style={tagStyles.chip}>
            <Text variant="bodyStrong" color="textMuted">
              {t}
            </Text>
            <Pressable
              onPress={() => remove(t)}
              hitSlop={8}
              accessibilityLabel={`Remove tag ${t}`}>
              <Glyph name="close" size={11} color="textFaint" />
            </Pressable>
          </View>
        ))}
        {adding ? (
          <View style={tagStyles.addBox}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder="tag"
              placeholderTextColor={colors.textFaint}
              onSubmitEditing={() => commit(draft)}
              onBlur={() => {
                commit(draft);
                setAdding(false);
              }}
              style={tagStyles.input}
            />
          </View>
        ) : (
          <Pressable onPress={() => setAdding(true)} style={tagStyles.addChip}>
            <Glyph name="add" size={12} color="textMuted" />
            <Text variant="bodyStrong" color="textMuted">
              tag
            </Text>
          </Pressable>
        )}
      </View>
      {suggestions.length > 0 ? (
        <View style={tagStyles.suggestRow}>
          {suggestions.map((s) => (
            <Pressable
              key={s}
              onPress={() => commit(s)}
              style={tagStyles.suggestChip}
              accessibilityLabel={`Add existing tag ${s}`}>
              <Text variant="bodyStrong" color="textMuted">
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const tagStyles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { letterSpacing: 1.5 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg3,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    borderStyle: 'dashed',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  addBox: {
    backgroundColor: colors.bg3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    minWidth: 100,
  },
  input: { color: colors.text, fontSize: 13, padding: 0, margin: 0 },
  suggestRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 4 },
  suggestChip: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
});

function NotesEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (text: string) => void | Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  // The textRef keeps the latest value reachable from the unmount cleanup,
  // since the setState closure in cleanup would otherwise see stale state.
  const textRef = useRef(text);
  textRef.current = text;
  const lastSavedRef = useRef(initial);
  const dirty = text !== lastSavedRef.current;

  const commit = useCallback(
    async (value?: string) => {
      const next = value ?? textRef.current;
      if (next === lastSavedRef.current) return;
      lastSavedRef.current = next;
      await onSave(next);
      setSaved(true);
      // 4s linger so the badge is actually noticed mid-type. Originally
      // 1.8s, which was below "did that just blink?" perceptual threshold
      // for users who type-then-look — fix #4.
      setTimeout(() => setSaved(false), 4000);
    },
    [onSave],
  );

  // Debounce-save on every keystroke (500ms idle) — spec §6 says no
  // free-text field should require an explicit Save tap. The blur path
  // and the unmount cleanup remain as belt-and-suspenders.
  useEffect(() => {
    if (text === lastSavedRef.current) return;
    const t = setTimeout(() => {
      void commit(text);
    }, 500);
    return () => clearTimeout(t);
  }, [text, commit]);

  // Force-save on unmount (route change while still dirty) so navigating
  // away via the tab bar or browser back doesn't drop unsaved input.
  useEffect(() => {
    return () => {
      if (textRef.current !== lastSavedRef.current) {
        void onSave(textRef.current);
      }
    };
  }, [onSave]);

  return (
    <Card style={styles.notes}>
      <View style={styles.notesHead}>
        <SectionLabel color="textMuted">My notes</SectionLabel>
        {saved ? (
          <View style={styles.savedBadge}>
            <Glyph name="done" size={11} color="bg" />
            <Text variant="sectionLabel" color="bg" style={styles.savedBadgeText}>
              Saved
            </Text>
          </View>
        ) : dirty ? (
          <Text variant="sectionLabel" color="warn">
            Saving…
          </Text>
        ) : null}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={() => void commit()}
        multiline
        placeholder="What worked, what to change next time…"
        placeholderTextColor={colors.textFaint}
        style={styles.notesInput}
      />
    </Card>
  );
}

function TopBar({
  onBack,
  clean,
  onToggleClean,
}: {
  onBack: () => void;
  clean: boolean;
  onToggleClean: () => void;
}) {
  return (
    <View style={styles.topbar}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={8}>
        <Glyph name="back" size={18} color="text" />
        <Text variant="bodyStrong">Recipes</Text>
      </Pressable>
      <Pressable onPress={onToggleClean} hitSlop={8}>
        <Text variant="bodyStrong" color={clean ? 'accent' : 'textMuted'}>
          {clean ? 'Annotated view' : 'Clean view'}
        </Text>
      </Pressable>
    </View>
  );
}

function SourceLink({ source }: { source: RecipeSource }) {
  if (source.type === 'mine') return null;
  if (source.url) {
    return (
      <Pressable onPress={() => Linking.openURL(source.url as string)}>
        <Text color="accent" style={styles.link}>
          → Original recipe ({source.name ?? SOURCE_NAME[source.type]})
        </Text>
      </Pressable>
    );
  }
  if (source.type === 'book' && source.bookRef) {
    return (
      <Text color="textFaint" style={styles.link}>
        Source · {source.bookRef}
      </Text>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  content: { padding: layout.screenPadding, paddingBottom: 48, gap: 4 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, lineHeight: 32, paddingTop: 6 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingTop: 10,
    paddingBottom: 16,
  },
  toolbar: { flexDirection: 'row', gap: 10 },
  hint: { paddingTop: 8, fontStyle: 'italic' },
  sectionLabel: { paddingTop: 24, paddingBottom: 12 },
  twoCol: { flexDirection: 'row', gap: 36, alignItems: 'flex-start' },
  colLeft: { flex: 4, minWidth: 0 },
  colRight: { flex: 6, minWidth: 0 },
  ingredients: { gap: 10 },
  ingRow: { flexDirection: 'row', gap: 12 },
  ingNameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  amount: { minWidth: 64, paddingTop: 1 },
  cleanAmount: { fontSize: 14 },
  ingText: { flex: 1, gap: 2 },
  annotation: { fontStyle: 'italic', fontSize: 13 },
  method: { gap: 16 },
  stepRow: { flexDirection: 'row', gap: 14 },
  stepNum: { minWidth: 20, textAlign: 'center' },
  stepBody: { flex: 1, lineHeight: 21 },
  cleanBody: { fontSize: 17, lineHeight: 26 },
  notes: { marginTop: 24, gap: 8 },
  notesHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notesInput: {
    minHeight: 76,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
    textAlignVertical: 'top',
  },
  link: { paddingTop: 22 },
  convertSheet: { gap: 10 },
  convertHint: { fontStyle: 'italic', lineHeight: 18 },
  convertList: { maxHeight: 320 },
  convertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  convertCheck: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convertCheckOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  convertButtons: { flexDirection: 'row', gap: 10, paddingTop: 6 },
  convertName: { flex: 1 },
  scaleSheet: { gap: 14 },
  scaleHint: { fontStyle: 'italic', lineHeight: 18 },
  scaleControl: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    paddingTop: 4,
  },
  scaleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scaleNumWrap: { alignItems: 'center', minWidth: 90 },
  scaleNum: { fontSize: 28 },
  scaleRatio: { textAlign: 'center', fontStyle: 'italic' },
  scaleList: { maxHeight: 240 },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  sourceEdit: { marginTop: 8, gap: 10 },
  sourceField: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  sourceEditRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 18,
    paddingTop: 2,
  },
  hero: {
    width: '100%',
    height: 200,
    borderRadius: layout.cardRadius,
    marginBottom: 4,
    backgroundColor: colors.bg2,
  },
  nutri: { marginTop: 16, gap: 10 },
  nutriHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nutriRow: { flexDirection: 'row', justifyContent: 'space-between' },
  nutriCell: { alignItems: 'center', flex: 1, gap: 2 },
  nutriVal: { fontSize: 18 },
  nutriLabel: { fontSize: 11 },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.ok,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
  },
  savedBadgeText: { letterSpacing: 0.4 },
});
