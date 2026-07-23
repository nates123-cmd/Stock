import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Text,
  Heading,
  SectionLabel,
  Button,
  Overlay,
  Screen,
  RecipeLibrary,
} from '@/components';
import { colors } from '@/design';
import { usePlanStore } from '@/store/plan';
import { usePipelineStore } from '@/store/pipeline';
import { bestGuessIngredients } from '@/lib/parsing';
import { dayTag } from '@/lib/week';
import type { MealType, PipelineIdea, Recipe } from '@/types';

export default function PlanPicker() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date: string; type?: string }>();
  const date = useMemo(() => new Date(params.date), [params.date]);
  // Optional lunch/dinner split target (Phase B). Absent = merge into the
  // day's default unlabeled meal.
  const mealType: MealType | null =
    params.type === 'lunch' || params.type === 'dinner' ? params.type : null;

  const addDish = usePlanStore((s) => s.addDish);
  const setBestGuess = usePipelineStore((s) => s.setBestGuess);

  const [expIdea, setExpIdea] = useState<PipelineIdea | null>(null);
  const [bgText, setBgText] = useState('');
  const [busy, setBusy] = useState(false);

  // Add a real recipe to the day and go back.
  const pick = async (r: Recipe) => {
    await addDish(date, { recipeId: r.id, title: r.title }, { type: mealType });
    router.back();
  };

  // A pipeline idea (from To Try) is planned as an "experiment" — confirm the
  // best-guess ingredients first.
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
      await addDish(
        date,
        { pipelineId: expIdea.id, title: expIdea.title },
        { type: mealType },
      );
      setExpIdea(null);
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const goToCapture = () => {
    router.push({
      pathname: '/capture',
      params: {
        planDate: params.date,
        ...(mealType ? { planType: mealType } : {}),
      },
    });
  };

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <Text variant="sectionLabel" color="accent">
            {dayTag(date)}
            {mealType ? ` · ${mealType}` : ''}
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

        {/* Same library UI as the Recipes tab, but the cards add to the week
            (red +) and To-Try ideas plan as experiments. */}
        <RecipeLibrary addMode onSelectRecipe={pick} onSelectIdea={openExperiment} />
      </Screen>

      <Pressable onPress={goToCapture} style={styles.newRecipe} hitSlop={8}>
        <Text color="accent">+ New recipe</Text>
      </Pressable>

      <Overlay visible={!!expIdea} onClose={() => setExpIdea(null)}>
        {expIdea ? (
          <View style={styles.sheet}>
            <Text variant="recipeTitle">{expIdea.title}</Text>
            {expIdea.note ? <Text color="textMuted">{expIdea.note}</Text> : null}
            <SectionLabel color="textMuted">What will you probably use?</SectionLabel>
            <TextInput
              value={bgText}
              onChangeText={setBgText}
              placeholder="one ingredient per line — 2 onions, 500 g beef, fish sauce"
              placeholderTextColor={colors.textFaint}
              multiline
              style={styles.bgInput}
            />
            <Text color="textFaint" style={styles.sheetNote}>
              Best-guess only — you'll confirm the real ingredients after you cook it.
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 6,
  },
  title: { paddingBottom: 14 },
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
  newRecipe: { alignItems: 'center', paddingVertical: 12 },
  sheetNote: { fontStyle: 'italic', lineHeight: 18 },
});
