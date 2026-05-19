import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  Overlay,
  TimerStrip,
  AwakeIndicator,
  StepBody,
} from '@/components';
import { colors, layout } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { useCookStore } from '@/store/cooks';
import { useCookTimers } from '@/lib/useCookTimers';
import { tokenizeStep } from '@/lib/cookText';
import { formatMinutes } from '@/lib/format';
import { uid } from '@/lib/id';
import type { Cook, Recipe, Step } from '@/types';

type Mode = 'focused' | 'glance';
type Phase = 'cooking' | 'post';

function contextLine(cookNumber: number): string {
  if (cookNumber <= 2) return `cook #${cookNumber} · learning this one`;
  if (cookNumber <= 5) return `cook #${cookNumber} · you've done this a few times`;
  return `cook #${cookNumber} · you know this one`;
}

const stepHasTimer = (s: Step) =>
  s.parsedTimers.length > 0 || tokenizeStep(s.body).some((t) => t.type === 'timer');

export default function CookScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const recipe = useRecipeStore((s) => s.recipes.find((r) => r.id === id));
  const saveRecipe = useRecipeStore((s) => s.save);
  const recordCook = useCookStore((s) => s.record);
  const { timers, startTimer, clearTimer } = useCookTimers();

  const steps = useMemo(
    () => (recipe ? [...recipe.steps].sort((a, b) => a.ordinal - b.ordinal) : []),
    [recipe],
  );
  const cookNumber = (recipe?.cookCount ?? 0) + 1;

  // Auto-routing (spec §7): ≤2 → Focused, ≥3 → Glance. Toggle overrides;
  // auto-routing wins each fresh entry (not remembered).
  const [mode, setMode] = useState<Mode>(cookNumber >= 3 ? 'glance' : 'focused');
  const [stepIndex, setStepIndex] = useState(0);
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [scrubOpen, setScrubOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('cooking');
  const [note, setNote] = useState('');
  const startedAt = useRef(new Date());

  if (!recipe) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text color="textMuted">Recipe not found.</Text>
          <Button label="Close" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const markDone = (ordinal: number) =>
    setDoneSteps((prev) => new Set(prev).add(ordinal));

  const finishCook = () => setPhase('post');

  const saveCook = async () => {
    const finishedAt = new Date();
    const durationMinutes = Math.max(
      1,
      Math.round((finishedAt.getTime() - startedAt.current.getTime()) / 60000),
    );
    const cook: Cook = {
      id: uid('cook'),
      recipeId: recipe.id,
      recipeVersionSnapshot: recipe,
      startedAt: startedAt.current,
      finishedAt,
      durationMinutes,
      note: note.trim() || undefined,
      modifications: [], // in-cook scaling/edits arrive with Bench (spec §9)
      mode,
    };
    await recordCook(cook);
    await saveRecipe({ ...recipe, cookCount: recipe.cookCount + 1, modifiedAt: finishedAt });
    router.back();
  };

  // Ingredient is "used" if its name appears in a completed step (spec §7;
  // proxied via text match until step→ingredient parsing lands, §11.8).
  const doneText = steps
    .filter((s) => doneSteps.has(s.ordinal))
    .map((s) => s.body.toLowerCase())
    .join(' ');
  const ingredientUsed = (name: string) => {
    if (doneText.length === 0) return false;
    const head = name.split(/[ ,]/)[0]?.toLowerCase();
    return !!head && head.length > 2 && doneText.includes(head);
  };
  const usedCount = recipe.ingredients.filter((i) => ingredientUsed(i.canonicalName)).length;

  if (phase === 'post') {
    return (
      <PostCook
        recipe={recipe}
        stepCount={steps.length}
        minutes={Math.max(
          1,
          Math.round((Date.now() - startedAt.current.getTime()) / 60000),
        )}
        cookNumber={cookNumber}
        note={note}
        setNote={setNote}
        onSkip={() => router.back()}
        onSave={saveCook}
      />
    );
  }

  const current = steps[stepIndex];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Top bar */}
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Exit
          </Text>
        </Pressable>
        <Text variant="recipeTitle" numberOfLines={1} style={styles.topTitle}>
          {recipe.title}
        </Text>
        <Pressable onPress={() => setSheetOpen(true)} hitSlop={8}>
          <Glyph name="recipes" size={20} color="text" />
        </Pressable>
      </View>

      {/* Mode toggle + awake + context */}
      <View style={styles.modeBar}>
        <View style={styles.toggle}>
          <Pressable
            onPress={() => setMode('focused')}
            style={[styles.toggleBtn, mode === 'focused' && styles.toggleOn]}>
            <Text variant="bodyStrong" color={mode === 'focused' ? 'bg' : 'textMuted'}>
              Focused
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('glance')}
            style={[styles.toggleBtn, mode === 'glance' && styles.toggleOn]}>
            <Text variant="bodyStrong" color={mode === 'glance' ? 'bg' : 'textMuted'}>
              Glance
            </Text>
          </Pressable>
        </View>
        <AwakeIndicator />
      </View>
      <Text color="textFaint" style={styles.context}>
        {contextLine(cookNumber)}
      </Text>

      {mode === 'focused' ? (
        <FocusedBody
          steps={steps}
          stepIndex={stepIndex}
          current={current}
          timers={timers}
          onStartTimer={(l, s) => startTimer(l, s, current?.ordinal ?? 1)}
          onClearTimer={clearTimer}
          onOpenScrub={() => setScrubOpen(true)}
          onBack={() => setStepIndex((i) => Math.max(0, i - 1))}
          onNext={() => {
            if (current) markDone(current.ordinal);
            if (stepIndex >= steps.length - 1) finishCook();
            else setStepIndex((i) => i + 1);
          }}
        />
      ) : (
        <GlanceBody
          recipe={recipe}
          steps={steps}
          doneSteps={doneSteps}
          expanded={expanded}
          setExpanded={setExpanded}
          timers={timers}
          onStartTimer={startTimer}
          onClearTimer={clearTimer}
          onMarkCooked={finishCook}
        />
      )}

      {/* Scrub overlay */}
      <Overlay visible={scrubOpen} onClose={() => setScrubOpen(false)}>
        <SectionLabel color="textMuted">Steps</SectionLabel>
        <ScrollView style={styles.scrubList}>
          {steps.map((s, i) => {
            const done = doneSteps.has(s.ordinal);
            const isCurrent = i === stepIndex;
            return (
              <Pressable
                key={s.id}
                style={styles.scrubRow}
                onPress={() => {
                  setStepIndex(i);
                  setScrubOpen(false);
                }}>
                <Text
                  variant="recipeTitle"
                  color={done ? 'ok' : isCurrent ? 'accent' : 'textFaint'}
                  style={styles.scrubNum}>
                  {s.ordinal}
                </Text>
                <Text
                  color={done ? 'textMuted' : isCurrent ? 'text' : 'textMuted'}
                  variant={isCurrent ? 'bodyStrong' : 'body'}
                  style={[styles.flex, done && styles.strike]}
                  numberOfLines={1}>
                  {s.title}
                </Text>
                {stepHasTimer(s) ? <Glyph name="timer" size={15} color="textFaint" /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </Overlay>

      {/* Ingredients sheet */}
      <Overlay visible={sheetOpen} onClose={() => setSheetOpen(false)}>
        <Text variant="recipeTitle">Ingredients</Text>
        <Text color="textMuted" style={styles.sheetMeta}>
          serves {recipe.yield.serves} · {usedCount} used so far
        </Text>
        <ScrollView style={styles.scrubList}>
          {recipe.ingredients.map((ing) => {
            const used = ingredientUsed(ing.canonicalName);
            return (
              <View key={ing.id} style={styles.ingRow}>
                <View style={[styles.check, used && styles.checkOn]}>
                  {used ? <Glyph name="done" size={12} color="bg" /> : null}
                </View>
                <Numeric color="textMuted" style={styles.ingAmt}>
                  {ing.amount != null ? `${ing.amount}${ing.unit ?? ''}` : ''}
                </Numeric>
                <Text style={[styles.flex, used && styles.strike]} color={used ? 'textMuted' : 'text'}>
                  {ing.canonicalName}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </Overlay>
    </SafeAreaView>
  );
}

/* ---------- Focused ---------- */
function FocusedBody({
  steps,
  stepIndex,
  current,
  timers,
  onStartTimer,
  onClearTimer,
  onOpenScrub,
  onBack,
  onNext,
}: {
  steps: Step[];
  stepIndex: number;
  current: Step | undefined;
  timers: ReturnType<typeof useCookTimers>['timers'];
  onStartTimer: (label: string, seconds: number) => void;
  onClearTimer: (id: string) => void;
  onOpenScrub: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  if (!current) return null;
  return (
    <View style={styles.flex}>
      <Pressable onPress={onOpenScrub} style={styles.posPill} hitSlop={6}>
        <Glyph name="expand" size={14} color="textMuted" />
        <Numeric color="textMuted">
          {stepIndex + 1} of {steps.length}
        </Numeric>
      </Pressable>

      <ScrollView contentContainerStyle={styles.focusContent}>
        <Heading variant="cookStepTitle">{current.title}</Heading>
        <View style={styles.focusBody}>
          <StepBody body={current.body} size={20} onStartTimer={onStartTimer} />
        </View>
      </ScrollView>

      <TimerStrip timers={timers} onClear={onClearTimer} />

      <View style={styles.actionBar}>
        <Pressable
          onPress={onBack}
          disabled={stepIndex === 0}
          style={[styles.backCircle, stepIndex === 0 && styles.dim]}>
          <Glyph name="back" size={20} color="text" />
        </Pressable>
        <Button
          label={stepIndex >= steps.length - 1 ? 'Done · finish' : 'Done · next'}
          glyph="next"
          flex
          onPress={onNext}
        />
      </View>
    </View>
  );
}

/* ---------- Glance ---------- */
function GlanceBody({
  recipe,
  steps,
  doneSteps,
  expanded,
  setExpanded,
  timers,
  onStartTimer,
  onClearTimer,
  onMarkCooked,
}: {
  recipe: Recipe;
  steps: Step[];
  doneSteps: Set<number>;
  expanded: number | null;
  setExpanded: (n: number | null) => void;
  timers: ReturnType<typeof useCookTimers>['timers'];
  onStartTimer: (label: string, seconds: number, ord: number) => void;
  onClearTimer: (id: string) => void;
  onMarkCooked: () => void;
}) {
  const time = formatMinutes(recipe.yield.totalMinutes);
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.glanceContent}>
        <Heading variant="recipeTitle" style={styles.glanceTitle}>
          {recipe.title}
        </Heading>
        <SectionLabel color="textMuted">
          serves {recipe.yield.serves}
          {time ? ` · ~${time}` : ''} · cooked {recipe.cookCount}×
        </SectionLabel>

        <Card style={styles.ingCard}>
          {recipe.ingredients.map((ing) => (
            <View key={ing.id} style={styles.ingGrid}>
              <Numeric color="text" style={styles.ingGridAmt}>
                {ing.amount != null ? `${ing.amount}${ing.unit ?? ''}` : '—'}
              </Numeric>
              <Text style={styles.flex}>
                {ing.canonicalName}
                {ing.modificationHistory.length > 0 ? (
                  <Text color="accent" style={styles.modTag}>
                    {' '}
                    ·mod
                  </Text>
                ) : null}
              </Text>
            </View>
          ))}
        </Card>

        <View style={styles.glanceSteps}>
          {steps.map((s) => {
            const done = doneSteps.has(s.ordinal);
            const open = expanded === s.ordinal;
            const t0 = s.parsedTimers[0];
            return (
              <View key={s.id}>
                <Pressable
                  style={styles.glanceRow}
                  onPress={() => setExpanded(open ? null : s.ordinal)}>
                  <Text
                    variant="recipeTitle"
                    color={done ? 'ok' : open ? 'accent' : 'textFaint'}
                    style={styles.glanceNum}>
                    {s.ordinal}
                  </Text>
                  <Text variant="bodyStrong" style={styles.flex}>
                    {s.title}
                  </Text>
                  <View style={styles.pills}>
                    {s.parsedTemperature ? (
                      <View style={styles.pillNeutral}>
                        <Numeric color="text">{s.parsedTemperature}°F</Numeric>
                      </View>
                    ) : null}
                    {t0 ? (
                      <Pressable
                        onPress={() => onStartTimer(t0.label, t0.durationSeconds, s.ordinal)}
                        style={styles.pillTime}>
                        <Numeric color="bg">
                          {t0.durationSeconds >= 3600
                            ? `${Math.round(t0.durationSeconds / 3600)}h`
                            : t0.durationSeconds >= 60
                              ? `${Math.round(t0.durationSeconds / 60)}m`
                              : `${t0.durationSeconds}s`}
                        </Numeric>
                      </Pressable>
                    ) : null}
                  </View>
                </Pressable>
                {open ? (
                  <View style={styles.glanceExpand}>
                    <StepBody
                      body={s.body}
                      size={16}
                      onStartTimer={(l, sec) => onStartTimer(l, sec, s.ordinal)}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <Button label="Mark cooked" glyph="done" onPress={onMarkCooked} style={styles.markCooked} />
      </ScrollView>

      <TimerStrip timers={timers} onClear={onClearTimer} />
    </View>
  );
}

/* ---------- Post-cook ---------- */
function PostCook({
  recipe,
  stepCount,
  minutes,
  cookNumber,
  note,
  setNote,
  onSkip,
  onSave,
}: {
  recipe: Recipe;
  stepCount: number;
  minutes: number;
  cookNumber: number;
  note: string;
  setNote: (s: string) => void;
  onSkip: () => void;
  onSave: () => void;
}) {
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.postContent}>
        <View style={styles.checkDisk}>
          <Glyph name="done" size={28} color="bg" />
        </View>
        <Heading variant="cookStepTitle">Done.</Heading>
        <Numeric color="textMuted">
          {stepCount} steps · {minutes} minutes · cook #{cookNumber}
        </Numeric>
        <Card style={styles.postCard}>
          <Text variant="recipeTitle" style={styles.postName}>
            {recipe.title}
          </Text>
        </Card>

        <View style={styles.postField}>
          <SectionLabel color="textMuted">How'd it go?</SectionLabel>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="optional cook note"
            placeholderTextColor={colors.textFaint}
            multiline
            style={styles.noteInput}
          />
        </View>
      </ScrollView>

      <View style={styles.actionBarPad}>
        <Button label="Skip" variant="secondary" flex onPress={onSkip} />
        <Button label="Save cook" glyph="done" flex onPress={onSave} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgCook },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    paddingBottom: 10,
  },
  topTitle: { flex: 1, textAlign: 'center', marginHorizontal: 10 },
  modeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
  },
  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.bg3,
    borderRadius: 999,
    padding: 3,
  },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999 },
  toggleOn: { backgroundColor: colors.accent },
  context: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: 8,
    paddingBottom: 6,
    fontStyle: 'italic',
  },
  posPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: colors.bg2,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 6,
  },
  focusContent: { padding: layout.screenPadding, paddingTop: 22, gap: 18 },
  focusBody: { paddingBottom: 20 },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    paddingBottom: 6,
  },
  backCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.35 },
  glanceContent: { padding: layout.screenPadding, gap: 14, paddingBottom: 30 },
  glanceTitle: { fontSize: 22 },
  ingCard: { gap: 8 },
  ingGrid: { flexDirection: 'row', gap: 12 },
  ingGridAmt: { minWidth: 58 },
  modTag: { fontStyle: 'italic', fontSize: 12 },
  glanceSteps: { gap: 4 },
  glanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  glanceNum: { minWidth: 22, textAlign: 'center' },
  pills: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillNeutral: {
    backgroundColor: colors.bg3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillTime: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  glanceExpand: {
    backgroundColor: colors.bg2,
    marginHorizontal: -layout.screenPadding,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 14,
  },
  markCooked: { marginTop: 22 },
  scrubList: { maxHeight: 360 },
  scrubRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  scrubNum: { minWidth: 22, textAlign: 'center' },
  strike: { textDecorationLine: 'line-through' },
  sheetMeta: { paddingTop: 4, paddingBottom: 10 },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  ingAmt: { minWidth: 54 },
  postContent: {
    flexGrow: 1,
    alignItems: 'center',
    padding: layout.screenPadding,
    paddingTop: 50,
    gap: 14,
  },
  checkDisk: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postCard: { width: '100%', alignItems: 'center' },
  postName: { textAlign: 'center' },
  postField: { width: '100%', gap: 8, paddingTop: 10 },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: colors.bg2,
    padding: 14,
    minHeight: 90,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: 'top',
  },
  actionBarPad: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    paddingBottom: 8,
  },
});
