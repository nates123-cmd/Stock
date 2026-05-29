import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  Numeric,
  SectionLabel,
  Card,
  Button,
  Pill,
  Glyph,
  type PillTone,
} from '@/components';
import { colors } from '@/design';
import { usePipelineStore } from '@/store/pipeline';
import { useRecipeStore } from '@/store/recipes';
import { useExtrasStore } from '@/store/extras';
import { bestGuessIngredients } from '@/lib/parsing';
import { formatAmount, relativeAge } from '@/lib/format';
import type { Ingredient, PipelineIdea } from '@/types';

const NEXT_STATUS: Partial<Record<PipelineIdea['status'], PipelineIdea['status']>> = {
  captured: 'researching',
  researching: 'ready',
};
const STATUS_TONE: Record<PipelineIdea['status'], PillTone> = {
  captured: 'muted',
  researching: 'warn',
  ready: 'ok',
  attempted: 'accent',
  promoted: 'muted',
};

export default function IdeaDetail() {
  const router = useRouter();
  const { id, openCart } = useLocalSearchParams<{ id: string; openCart?: string }>();
  const idea = usePipelineStore((s) => s.ideas.find((i) => i.id === id));
  const setStatus = usePipelineStore((s) => s.setStatus);
  const setBestGuess = usePipelineStore((s) => s.setBestGuess);
  const addReference = usePipelineStore((s) => s.addReference);
  const removeReference = usePipelineStore((s) => s.removeReference);
  const remove = usePipelineStore((s) => s.remove);
  const recipeTitle = useRecipeStore((s) =>
    idea?.promotedRecipeId
      ? s.recipes.find((r) => r.id === idea.promotedRecipeId)?.title
      : undefined,
  );
  const addExtras = useExtrasStore((s) => s.add);
  const removeExtrasByOrigin = useExtrasStore((s) => s.removeByOrigin);
  const extras = useExtrasStore((s) => s.items);

  const [refUrl, setRefUrl] = useState('');
  const [refLabel, setRefLabel] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureText, setCaptureText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushed, setPushed] = useState<number | null>(null);

  // Pipeline list-card "+ Cart" → opens here with openCart=1 when the idea
  // has no best-guess yet (spec §8). Auto-open the capture sheet so the
  // user lands directly in the parse-and-add flow.
  useEffect(() => {
    if (openCart === '1' && idea && (idea.bestGuessIngredients ?? []).length === 0) {
      setCaptureOpen(true);
    }
  }, [openCart, idea]);

  if (!idea) {
    return (
      <Screen>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Glyph name="back" size={20} color="textMuted" />
          </Pressable>
        </View>
        <Text color="textMuted" style={styles.gone}>
          This idea is gone.
        </Text>
      </Screen>
    );
  }

  const next = NEXT_STATUS[idea.status];
  const promoted = idea.status === 'promoted';

  const addRef = async () => {
    if (!refUrl.trim()) return;
    await addReference(idea.id, {
      url: refUrl.trim(),
      label: refLabel.trim() || refUrl.trim(),
    });
    setRefUrl('');
    setRefLabel('');
  };

  const cookedIt = () =>
    router.push({
      pathname: '/capture',
      params: {
        ideaId: idea.id,
        prefillTitle: idea.title,
        refs: JSON.stringify(idea.references),
      },
    });

  const alreadyStaged = extras.some((x) => x.originId === idea.id);

  /** Push the idea's best-guess ingredients to the shopping-list Extras
   *  section. Re-adding from the same idea replaces the previous batch so
   *  the count stays sensible (spec §8 — staging path, not a planning step). */
  const pushToShopping = (ings: Ingredient[]) => {
    if (ings.length === 0) return;
    removeExtrasByOrigin(idea.id);
    addExtras(
      ings.map((i) => ({
        canonicalName: i.canonicalName,
        amount: i.amount,
        unit: i.unit,
        originLabel: `from pipeline: ‘${idea.title}’`,
        originId: idea.id,
      })),
    );
    setPushed(ings.length);
    setTimeout(() => setPushed(null), 4000);
  };

  const addToShopping = async () => {
    const existing = idea.bestGuessIngredients ?? [];
    if (existing.length > 0) {
      pushToShopping(existing);
      return;
    }
    // No best-guess yet — open the inline capture sheet.
    setCaptureOpen(true);
  };

  const captureAndAdd = async () => {
    if (!captureText.trim()) return;
    setBusy(true);
    try {
      const guessed = await bestGuessIngredients(idea.title, captureText);
      const ings = guessed.map((g) => g.value);
      await setBestGuess(idea.id, ings);
      pushToShopping(ings);
      setCaptureOpen(false);
      setCaptureText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Glyph name="back" size={20} color="textMuted" />
        </Pressable>
        <Pressable onPress={() => remove(idea.id).then(() => router.back())} hitSlop={8}>
          <Text color="accent" variant="bodyStrong">
            Delete
          </Text>
        </Pressable>
      </View>

      <Heading variant="screenTitle">{idea.title}</Heading>
      <View style={styles.metaRow}>
        <Pill label={idea.status} tone={STATUS_TONE[idea.status]} />
        <Text color="textFaint">· {relativeAge(idea.createdAt)}</Text>
      </View>

      {idea.note ? (
        <Text color="textMuted" style={styles.note}>
          {idea.note}
        </Text>
      ) : null}

      {promoted ? (
        <Card style={styles.promotedCard}>
          <SectionLabel color="textMuted">Promoted</SectionLabel>
          <Text>
            Cooked and moved to recipes{recipeTitle ? ` — ${recipeTitle}` : ''}.
          </Text>
          {idea.promotedRecipeId ? (
            <Button
              label="Open recipe"
              glyph="next"
              variant="secondary"
              onPress={() =>
                router.push({
                  pathname: '/recipes/[id]',
                  params: { id: idea.promotedRecipeId as string },
                })
              }
            />
          ) : null}
        </Card>
      ) : (
        <>
          <View style={styles.statusRow}>
            {next ? (
              <Button
                label={`Move to ${next}`}
                glyph="next"
                flex
                onPress={() => setStatus(idea.id, next)}
              />
            ) : null}
            {idea.status !== 'captured' ? (
              <Button
                label="Back to captured"
                variant="secondary"
                flex
                onPress={() => setStatus(idea.id, 'captured')}
              />
            ) : null}
          </View>

          <Button label="Cooked it → Recipe" glyph="done" style={styles.cookedBtn} onPress={cookedIt} />

          <View style={styles.shopRow}>
            <Button
              label={alreadyStaged ? 'Re-add to shopping list' : 'Add to shopping list'}
              variant="secondary"
              flex
              onPress={addToShopping}
            />
          </View>
          {pushed != null ? (
            <Text color="ok" style={styles.shopHint}>
              Added {pushed} item{pushed === 1 ? '' : 's'} to your shopping list’s
              Extras section. (No plan date — pure staging.)
            </Text>
          ) : alreadyStaged ? (
            <Text color="textFaint" style={styles.shopHint}>
              Already staged on this run’s shopping list.
            </Text>
          ) : null}

          {captureOpen ? (
            <Card style={styles.captureCard}>
              <SectionLabel color="textMuted">
                Best-guess ingredients
              </SectionLabel>
              <Text color="textFaint" style={styles.captureHint}>
                Paste or jot what you think you’d need — one per line is fine.
                Claude parses it before staging to your shopping list.
              </Text>
              <TextInput
                value={captureText}
                onChangeText={setCaptureText}
                placeholder={'2 lemons\n1 lb salmon\nsoy sauce\n…'}
                placeholderTextColor={colors.textFaint}
                multiline
                style={styles.captureInput}
              />
              <View style={styles.captureActions}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  flex
                  onPress={() => {
                    setCaptureOpen(false);
                    setCaptureText('');
                  }}
                />
                <Button
                  label={busy ? 'Parsing…' : 'Capture & add'}
                  glyph="done"
                  flex
                  disabled={busy || !captureText.trim()}
                  onPress={captureAndAdd}
                />
              </View>
            </Card>
          ) : null}

          <Text color="textFaint" style={styles.tip}>
            Or plan it as an experiment from the week plan — pick it under the
            Pipeline tab in the recipe picker.
          </Text>
        </>
      )}

      {idea.bestGuessIngredients && idea.bestGuessIngredients.length > 0 ? (
        <View style={styles.section}>
          <SectionLabel color="textMuted">
            Best-guess ingredients · {idea.bestGuessIngredients.length}
          </SectionLabel>
          <Card style={styles.refCard}>
            {idea.bestGuessIngredients.map((ing) => (
              <View key={ing.id} style={styles.ingRow}>
                <Numeric color="textMuted" style={styles.amount}>
                  {formatAmount(ing.amount, ing.unit) || '—'}
                </Numeric>
                <Text style={styles.flex}>{ing.canonicalName}</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionLabel color="textMuted">
          References · {idea.references.length}
        </SectionLabel>
        {idea.references.map((r, idx) => (
          <View key={`${r.url}_${idx}`} style={styles.refRow}>
            <Pressable
              style={styles.flex}
              onPress={() => Linking.openURL(r.url).catch(() => {})}>
              <Text color="accent" numberOfLines={1}>
                {r.label}
              </Text>
            </Pressable>
            <Pressable onPress={() => removeReference(idea.id, idx)} hitSlop={8}>
              <Text color="textFaint">remove</Text>
            </Pressable>
          </View>
        ))}
        <View style={styles.addRef}>
          <TextInput
            value={refUrl}
            onChangeText={setRefUrl}
            placeholder="https://…"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={refLabel}
            onChangeText={setRefLabel}
            placeholder="label (optional)"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />
          <Button
            label="Add reference"
            variant="secondary"
            disabled={!refUrl.trim()}
            onPress={addRef}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 14,
  },
  gone: { paddingTop: 60, textAlign: 'center' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    paddingBottom: 4,
  },
  note: { lineHeight: 21, paddingVertical: 10 },
  promotedCard: { gap: 10, marginTop: 12 },
  statusRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cookedBtn: { marginTop: 10 },
  tip: { fontStyle: 'italic', lineHeight: 19, paddingTop: 10 },
  section: { paddingTop: 22, gap: 8 },
  refCard: { gap: 10 },
  ingRow: { flexDirection: 'row', gap: 12 },
  amount: { minWidth: 56 },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineSoft,
  },
  addRef: { gap: 8, paddingTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  shopRow: { paddingTop: 10 },
  shopHint: { fontStyle: 'italic', paddingTop: 6, lineHeight: 18 },
  captureCard: { gap: 10, marginTop: 12 },
  captureHint: { fontStyle: 'italic', lineHeight: 18 },
  captureInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  captureActions: { flexDirection: 'row', gap: 10 },
});
