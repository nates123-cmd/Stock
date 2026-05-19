import { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text, Heading, Numeric, SectionLabel, Glyph, Card, Button } from '@/components';
import { SourceBadge } from '@/components';
import { colors, layout } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { modCount, ingredientAnnotation } from '@/lib/recipe';
import { formatMinutes, formatAmount } from '@/lib/format';
import type { Nutrition, RecipeSource } from '@/types';

const SOURCE_NAME: Record<RecipeSource['type'], string> = {
  nyt: 'NYT Cooking',
  yt: 'YouTube',
  book: 'the book',
  mine: 'mine',
};

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const recipe = useRecipeStore((s) => s.recipes.find((r) => r.id === id));
  const save = useRecipeStore((s) => s.save);
  const [clean, setClean] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const goBack = () =>
    router.canGoBack() ? router.back() : router.replace('/recipes');

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
          <SourceBadge source={recipe.source} />
          {mods > 0 ? (
            <Numeric color="accent">
              {mods} {mods === 1 ? 'mod' : 'mods'}
            </Numeric>
          ) : null}
          <Numeric color="textMuted">serves {recipe.yield.serves}</Numeric>
          {time ? <Numeric color="textMuted">~{time}</Numeric> : null}
          <Numeric color="textMuted">cooked {recipe.cookCount}×</Numeric>
        </View>

        {recipe.nutrition ? <NutritionCard n={recipe.nutrition} /> : null}

        <View style={styles.toolbar}>
          <Button
            label="Cook"
            glyph="done"
            flex
            onPress={() =>
              router.push({ pathname: '/cook/[id]', params: { id: recipe.id } })
            }
          />
          <Button label="Bench" glyph="bench" variant="secondary" flex onPress={() => setHint('Bench (convert / sub) is spec §9.')} />
          <Button label="Scale" variant="secondary" flex onPress={() => setHint('Scaling slider lands with Bench — spec §6/§9.')} />
        </View>
        {hint ? (
          <Text color="textMuted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}

        <SectionLabel style={styles.sectionLabel}>Ingredients</SectionLabel>
        <View style={styles.ingredients}>
          {recipe.ingredients.map((ing) => {
            const modified = ing.modificationHistory.length > 0;
            const annotation = clean ? null : ingredientAnnotation(ing);
            return (
              <View key={ing.id} style={styles.ingRow}>
                <Numeric
                  color={modified ? 'accent' : 'text'}
                  style={[styles.amount, clean && styles.cleanAmount]}>
                  {formatAmount(ing.amount, ing.unit)}
                </Numeric>
                <View style={styles.ingText}>
                  <Text style={clean ? styles.cleanBody : undefined}>
                    {ing.canonicalName}
                    {ing.inlineNote ? (
                      <Text color="textFaint"> · {ing.inlineNote}</Text>
                    ) : null}
                  </Text>
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

function NotesEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (text: string) => void | Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(false);
  const dirty = text !== initial;

  const commit = async () => {
    if (!dirty) return;
    await onSave(text);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <Card style={styles.notes}>
      <View style={styles.notesHead}>
        <SectionLabel color="textMuted">My notes</SectionLabel>
        {saved ? (
          <Text variant="sectionLabel" color="ok">
            Saved
          </Text>
        ) : dirty ? (
          <Pressable onPress={commit} hitSlop={8}>
            <Text variant="sectionLabel" color="accent">
              Save
            </Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        onBlur={commit}
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
          → Original recipe ({SOURCE_NAME[source.type]})
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
  ingredients: { gap: 10 },
  ingRow: { flexDirection: 'row', gap: 12 },
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
});
