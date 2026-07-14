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
import { Text, Heading, Numeric, SectionLabel, Glyph, Card, Button, BottomActionBar, IngredientAmount, IngredientName, FilterChip, ChipRow, RecipeTools } from '@/components';
import { SourceBadge } from '@/components';
import { colors, layout } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { usePlanStore } from '@/store/plan';
import { useCookStore } from '@/store/cooks';
import { dayTag, isSameDay } from '@/lib/week';
import { modCount, ingredientAnnotation } from '@/lib/recipe';
import { uid } from '@/lib/id';
import { pickRecipePhoto } from '@/lib/photo';
import type { Ingredient, MealType, Recipe, Step, Unit } from '@/types';
import { formatMinutes } from '@/lib/format';
import { shortDate } from '@/lib/pantry';
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
  const toggleFavorite = useRecipeStore((s) => s.toggleFavorite);
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
  const [editingSource, setEditingSource] = useState(false);
  const [sourceNameInput, setSourceNameInput] = useState('');
  const [sourceUrlInput, setSourceUrlInput] = useState('');
  const [editing, setEditing] = useState(false);
  // "Add to plan" sheet (spec §5/§6 cross-link): pick a day (and optionally a
  // lunch/dinner split) to add this recipe as a dish, straight from the recipe
  // tab. Merge-by-default (Phase B): no split → the day's default meal.
  const addDish = usePlanStore((s) => s.addDish);
  const [planning, setPlanning] = useState(false);
  const [planMeal, setPlanMeal] = useState<MealType | null>(null);
  // Today + next 13 days — same rolling, always-editable window as the Plan
  // grid. Anchored at mount; the recipe screen is opened fresh each time.
  const planDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, []);

  // Wide-viewport two-column layout (spec §6). 768px breakpoint matches
  // standard tablet/desktop split; the columns are width-independent so
  // ingredient/step rows render the same in either orientation.
  // MUST stay above the early returns below (`!recipe`, `editing`): a hook
  // after a conditional return changes the hook count between renders when
  // `editing` toggles, which crashes the screen to a blank page.
  const { width: viewportWidth } = useWindowDimensions();
  const wide = viewportWidth >= 768;

  /**
   * The note from the last time this was cooked ("too much salt"). Same rule as
   * the layout hook above: MUST live above the early returns, or the hook count
   * changes when `editing` toggles and the screen blanks.
   *
   * Only cooks that actually carry a note count — a cook you logged without
   * saying anything has nothing to tell you.
   */
  const cooks = useCookStore((s) => s.cooks);
  const lastCookNote = useMemo(() => {
    const withNotes = cooks
      .filter((c) => c.recipeId === id && (c.note ?? '').trim())
      .sort((a, b) => {
        const at = (b.finishedAt ?? b.startedAt) as Date;
        const bt = (a.finishedAt ?? a.startedAt) as Date;
        return new Date(at).getTime() - new Date(bt).getTime();
      });
    const latest = withNotes[0];
    if (!latest) return null;
    return {
      note: (latest.note ?? '').trim(),
      at: new Date(latest.finishedAt ?? latest.startedAt),
      olderCount: withNotes.length - 1,
    };
  }, [cooks, id]);

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

  if (editing) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <EditRecipe recipe={recipe} onClose={() => setEditing(false)} />
      </SafeAreaView>
    );
  }

  const mods = modCount(recipe);
  const time = formatMinutes(recipe.yield.totalMinutes);
  const steps = [...recipe.steps].sort((a, b) => a.ordinal - b.ordinal);

  const SPLIT_OPTIONS: { key: MealType | null; label: string }[] = [
    { key: null, label: 'Any meal' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'dinner', label: 'Dinner' },
  ];
  const addToPlan = async (day: Date) => {
    await addDish(day, { recipeId: recipe.id, title: recipe.title }, { type: planMeal });
    setPlanning(false);
    setHint(
      `Added to ${dayTag(day)}${planMeal ? ` · ${planMeal}` : ''}`,
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <TopBar
        onBack={goBack}
        clean={clean}
        onToggleClean={() => setClean((c) => !c)}
        onEdit={() => setEditing(true)}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {recipe.imageUrl ? (
          <Image
            source={{ uri: recipe.imageUrl }}
            style={styles.hero}
            resizeMode="cover"
          />
        ) : null}
        <View style={styles.titleRow}>
          <Heading variant="screenTitle" style={styles.title}>
            {recipe.title}
          </Heading>
          <Pressable
            onPress={() => void toggleFavorite(recipe.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: !!recipe.isFavorite }}
            accessibilityLabel={
              recipe.isFavorite ? 'Remove from favorites' : 'Add to favorites'
            }>
            <Glyph
              name={recipe.isFavorite ? 'fav' : 'favOff'}
              size={22}
              color={recipe.isFavorite ? 'accent' : 'textFaint'}
            />
          </Pressable>
        </View>

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

        {/* What you said last time you cooked this — the single most useful thing
            to see before cooking it again ("too much salt"). Sits ABOVE nutrition
            on purpose: it's your own hard-won note, not a stat. */}
        {lastCookNote ? (
          <Card tone="bg2" style={styles.lastNote}>
            <SectionLabel color="textMuted">
              Last cook · {shortDate(lastCookNote.at)}
            </SectionLabel>
            <Text variant="bodyStrong">{lastCookNote.note}</Text>
            {lastCookNote.olderCount > 0 ? (
              <Text color="textFaint">
                {lastCookNote.olderCount} earlier note
                {lastCookNote.olderCount === 1 ? '' : 's'}
              </Text>
            ) : null}
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

        <Button
          label="Add to plan"
          glyph="plan"
          flex
          onPress={() => setPlanning(true)}
        />

        <RecipeTools recipe={recipe} onSave={save} onHint={setHint}>
          <Button
            label="Cook"
            glyph="done"
            flex
            onPress={() =>
              router.push({ pathname: '/cook/[id]', params: { id: recipe.id } })
            }
          />
        </RecipeTools>
        {hint ? (
          <Text color="textMuted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}

        <View style={wide ? styles.twoCol : undefined}>
          <View style={wide ? styles.colLeft : undefined}>
            <SectionHeader label="Ingredients" onEdit={() => setEditing(true)} />
            <View style={styles.ingredients}>
              {recipe.ingredients.map((ing) => {
                const annotation = clean ? null : ingredientAnnotation(ing);
                return (
                  <Pressable
                    key={ing.id}
                    style={styles.ingRow}
                    // Long-press → the folded-in Bench (Sub), amount pre-loaded
                    // (spec §9). Bench is no longer its own tab (redesign Phase
                    // C): it opens as a sheet on the Cook surface.
                    onLongPress={() =>
                      router.push({
                        pathname: '/(tabs)/cook',
                        params: {
                          bench: '1',
                          tab: 'sub',
                          sub: ing.canonicalName,
                          amount: ing.amount != null ? String(ing.amount) : '',
                          unit: ing.unit ?? '',
                        },
                      } as never)
                    }>
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
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={wide ? styles.colRight : undefined}>
            <SectionHeader label="Method" onEdit={() => setEditing(true)} />
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

      <Overlay visible={planning} onClose={() => setPlanning(false)}>
        <View style={styles.planSheet}>
          <Text variant="recipeTitle">Add to plan</Text>
          <Text color="textFaint" style={styles.planHint}>
            Pick a day. Dishes merge into that day’s meal — optionally split it
            into lunch or dinner.
          </Text>
          <ChipRow>
            {SPLIT_OPTIONS.map((opt) => (
              <FilterChip
                key={opt.label}
                label={opt.label}
                active={planMeal === opt.key}
                onPress={() => setPlanMeal(opt.key)}
              />
            ))}
          </ChipRow>
          <ScrollView style={styles.planList}>
            {planDays.map((day) => {
              const today = isSameDay(day, new Date());
              return (
                <Pressable
                  key={day.toISOString()}
                  style={styles.planRow}
                  onPress={() => addToPlan(day)}>
                  <Text variant="bodyStrong" color={today ? 'accent' : 'text'}>
                    {today ? 'Today' : dayTag(day)}
                  </Text>
                  <Glyph name="next" size={16} color="textMuted" />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
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

/**
 * A section label with its own "Edit" affordance.
 *
 * Editing ingredients / method was always possible, but the only way in was a
 * small "Edit" link in the top bar — so it read as un-editable. Put the way in
 * next to the thing it edits.
 */
function SectionHeader({ label, onEdit }: { label: string; onEdit: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <SectionLabel style={styles.sectionLabel}>{label}</SectionLabel>
      <Pressable onPress={onEdit} hitSlop={8}>
        <Text variant="bodyStrong" color="accent">
          Edit
        </Text>
      </Pressable>
    </View>
  );
}

function TopBar({
  onBack,
  clean,
  onToggleClean,
  onEdit,
}: {
  onBack: () => void;
  clean: boolean;
  onToggleClean: () => void;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.topbar}>
      <Pressable onPress={onBack} style={styles.back} hitSlop={8}>
        <Glyph name="back" size={18} color="text" />
        <Text variant="bodyStrong">Recipes</Text>
      </Pressable>
      <View style={styles.topbarRight}>
        <Pressable onPress={onToggleClean} hitSlop={8}>
          <Text variant="bodyStrong" color={clean ? 'accent' : 'textMuted'}>
            {clean ? 'Annotated view' : 'Clean view'}
          </Text>
        </Pressable>
        {onEdit ? (
          <Pressable onPress={onEdit} hitSlop={8}>
            <Text variant="bodyStrong" color="accent">
              Edit
            </Text>
          </Pressable>
        ) : null}
      </View>
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
  topbarRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  content: { padding: layout.screenPadding, paddingBottom: 48, gap: 4 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lastNote: { gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
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
  planSheet: { gap: 14 },
  planHint: { fontStyle: 'italic', lineHeight: 18 },
  planList: { maxHeight: 320 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
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
  pivotInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pivotInput: {
    minWidth: 72,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
  },
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

/* ───────────────────────────────────────────────────────────────────────────
 * Edit mode — full recipe edit (overwrite, no modification history; the mod
 * system stays reserved for cook-time tweaks). Covers title, serves, time,
 * every ingredient (amount/unit/name + add/remove) and every step (body +
 * add/remove). Draft state is local; nothing persists until Save. Fields the
 * form doesn't surface (originalText, parsed timers/amounts, mod history) are
 * preserved by keying each row back to its original ingredient/step.
 * ──────────────────────────────────────────────────────────────────────── */
type IngDraft = { id: string; amount: string; unit: string; canonicalName: string };
type StepDraft = { id: string; body: string };

function EditRecipe({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const save = useRecipeStore((s) => s.save);
  const [title, setTitle] = useState(recipe.title);
  const [serves, setServes] = useState(String(recipe.yield.serves));
  const [minutes, setMinutes] = useState(
    recipe.yield.totalMinutes != null ? String(recipe.yield.totalMinutes) : '',
  );
  const [ings, setIngs] = useState<IngDraft[]>(() =>
    recipe.ingredients.map((i) => ({
      id: i.id,
      amount: i.amount != null ? String(i.amount) : '',
      unit: i.unit ?? '',
      canonicalName: i.canonicalName,
    })),
  );
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    [...recipe.steps]
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((s) => ({ id: s.id, body: s.body })),
  );
  const [saving, setSaving] = useState(false);
  // Photo — shoot one or pick one; committed with the rest of the edit on Save.
  const [imageUrl, setImageUrl] = useState<string | undefined>(recipe.imageUrl);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const choosePhoto = async (source: 'camera' | 'library') => {
    if (photoBusy) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const uri = await pickRecipePhoto(source);
      if (uri) setImageUrl(uri);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : 'Could not add that photo.');
    } finally {
      setPhotoBusy(false);
    }
  };

  const setIng = (id: string, patch: Partial<IngDraft>) =>
    setIngs((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addIng = () =>
    setIngs((rows) => [...rows, { id: uid('ing'), amount: '', unit: '', canonicalName: '' }]);
  const removeIng = (id: string) =>
    setIngs((rows) => rows.filter((r) => r.id !== id));

  const setStep = (id: string, body: string) =>
    setSteps((rows) => rows.map((r) => (r.id === id ? { ...r, body } : r)));
  const addStep = () => setSteps((rows) => [...rows, { id: uid('step'), body: '' }]);
  const removeStep = (id: string) =>
    setSteps((rows) => rows.filter((r) => r.id !== id));

  const parseAmount = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    const origIng = new Map(recipe.ingredients.map((i) => [i.id, i]));
    const origStep = new Map(recipe.steps.map((s) => [s.id, s]));
    const ingredients: Ingredient[] = ings
      .filter((d) => d.canonicalName.trim() !== '')
      .map((d) => {
        const o = origIng.get(d.id);
        const name = d.canonicalName.trim();
        const unit = d.unit.trim();
        return {
          id: d.id,
          amount: parseAmount(d.amount),
          unit: unit === '' ? null : (unit as Unit),
          canonicalName: name,
          originalText: o?.originalText ?? name,
          modificationHistory: o?.modificationHistory ?? [],
          inlineNote: o?.inlineNote,
        };
      });
    const nextSteps: Step[] = steps
      .filter((d) => d.body.trim() !== '')
      .map((d, idx) => {
        const o = origStep.get(d.id);
        return {
          id: d.id,
          ordinal: idx + 1,
          title: o?.title ?? '',
          body: d.body.trim(),
          parsedTimers: o?.parsedTimers ?? [],
          parsedAmounts: o?.parsedAmounts ?? [],
          parsedTemperature: o?.parsedTemperature,
          modificationHistory: o?.modificationHistory ?? [],
        };
      });
    const servesNum = Math.max(1, Math.round(Number(serves)) || recipe.yield.serves);
    const minNum =
      minutes.trim() === '' ? undefined : Math.max(0, Math.round(Number(minutes)) || 0);
    await save({
      ...recipe,
      title: title.trim() || recipe.title,
      yield: { serves: servesNum, totalMinutes: minNum },
      imageUrl,
      ingredients,
      steps: nextSteps,
      modifiedAt: new Date(),
    });
    setSaving(false);
    onClose();
  };

  return (
    <>
      <View style={styles.topbar}>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Cancel
          </Text>
        </Pressable>
        <Text variant="bodyStrong">Edit recipe</Text>
        <Pressable onPress={onSave} hitSlop={8} disabled={saving}>
          <Text variant="bodyStrong" color="accent">
            {saving ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={editStyles.body}
        keyboardShouldPersistTaps="handled">
        <View style={editStyles.field}>
          <SectionLabel color="textMuted">Photo</SectionLabel>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={editStyles.photo} resizeMode="cover" />
          ) : (
            <View style={editStyles.photoEmpty}>
              <Glyph name="recipes" size={20} color="textFaint" />
              <Text color="textFaint">No photo yet</Text>
            </View>
          )}
          <View style={editStyles.photoButtons}>
            <Button
              label={photoBusy ? 'Working…' : 'Take photo'}
              variant="secondary"
              flex
              disabled={photoBusy}
              onPress={() => choosePhoto('camera')}
            />
            <Button
              label="Choose photo"
              variant="secondary"
              flex
              disabled={photoBusy}
              onPress={() => choosePhoto('library')}
            />
          </View>
          {imageUrl ? (
            <Pressable onPress={() => setImageUrl(undefined)} hitSlop={6}>
              <Text color="warn">Remove photo</Text>
            </Pressable>
          ) : null}
          {photoError ? <Text color="warn">{photoError}</Text> : null}
        </View>

        <View style={editStyles.field}>
          <SectionLabel color="textMuted">Title</SectionLabel>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={editStyles.input}
            placeholder="Recipe title"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={editStyles.row2}>
          <View style={editStyles.flex}>
            <SectionLabel color="textMuted">Serves</SectionLabel>
            <TextInput
              value={serves}
              onChangeText={setServes}
              keyboardType="number-pad"
              style={editStyles.input}
              placeholder="2"
              placeholderTextColor={colors.textFaint}
            />
          </View>
          <View style={editStyles.flex}>
            <SectionLabel color="textMuted">Total minutes</SectionLabel>
            <TextInput
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
              style={editStyles.input}
              placeholder="—"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        </View>

        <SectionLabel style={editStyles.heading}>Ingredients</SectionLabel>
        <View style={editStyles.list}>
          {ings.map((d) => (
            <View key={d.id} style={editStyles.ingRow}>
              <TextInput
                value={d.amount}
                onChangeText={(t) => setIng(d.id, { amount: t })}
                keyboardType="numbers-and-punctuation"
                style={[editStyles.input, editStyles.amt]}
                placeholder="qty"
                placeholderTextColor={colors.textFaint}
              />
              <TextInput
                value={d.unit}
                onChangeText={(t) => setIng(d.id, { unit: t })}
                autoCapitalize="none"
                style={[editStyles.input, editStyles.unit]}
                placeholder="unit"
                placeholderTextColor={colors.textFaint}
              />
              <TextInput
                value={d.canonicalName}
                onChangeText={(t) => setIng(d.id, { canonicalName: t })}
                style={[editStyles.input, editStyles.flex]}
                placeholder="ingredient"
                placeholderTextColor={colors.textFaint}
              />
              <Pressable
                onPress={() => removeIng(d.id)}
                hitSlop={8}
                style={editStyles.del}
                accessibilityLabel="Remove ingredient">
                <Glyph name="close" size={13} color="textFaint" />
              </Pressable>
            </View>
          ))}
        </View>
        <Pressable onPress={addIng} style={editStyles.addRow}>
          <Glyph name="add" size={13} color="accent" />
          <Text variant="bodyStrong" color="accent">
            Add ingredient
          </Text>
        </Pressable>

        <SectionLabel style={editStyles.heading}>Method</SectionLabel>
        <View style={editStyles.list}>
          {steps.map((d, idx) => (
            <View key={d.id} style={editStyles.stepRow}>
              <Text variant="recipeTitle" color="accent" style={editStyles.stepNum}>
                {idx + 1}
              </Text>
              <TextInput
                value={d.body}
                onChangeText={(t) => setStep(d.id, t)}
                multiline
                style={[editStyles.input, editStyles.stepInput]}
                placeholder="Step…"
                placeholderTextColor={colors.textFaint}
              />
              <Pressable
                onPress={() => removeStep(d.id)}
                hitSlop={8}
                style={editStyles.del}
                accessibilityLabel="Remove step">
                <Glyph name="close" size={13} color="textFaint" />
              </Pressable>
            </View>
          ))}
        </View>
        <Pressable onPress={addStep} style={editStyles.addRow}>
          <Glyph name="add" size={13} color="accent" />
          <Text variant="bodyStrong" color="accent">
            Add step
          </Text>
        </Pressable>
      </ScrollView>

      <BottomActionBar>
        <Button label="Cancel" variant="secondary" flex onPress={onClose} />
        <Button
          label={saving ? 'Saving…' : 'Save recipe'}
          glyph="done"
          flex
          disabled={saving}
          onPress={onSave}
        />
      </BottomActionBar>
    </>
  );
}

const editStyles = StyleSheet.create({
  body: { padding: layout.screenPadding, paddingBottom: 40, gap: 14 },
  field: { gap: 6 },
  flex: { flex: 1 },
  photo: { width: '100%', height: 180, borderRadius: 12, backgroundColor: colors.bg2 },
  photoEmpty: {
    width: '100%',
    height: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoButtons: { flexDirection: 'row', gap: 10 },
  row2: { flexDirection: 'row', gap: 12 },
  heading: { paddingTop: 10 },
  list: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  amt: { width: 60, textAlign: 'center', paddingHorizontal: 6 },
  unit: { width: 64, paddingHorizontal: 8 },
  del: { paddingHorizontal: 4, paddingVertical: 6 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepNum: { minWidth: 18, textAlign: 'center', paddingTop: 8 },
  stepInput: { flex: 1, minHeight: 60, textAlignVertical: 'top' },
});
