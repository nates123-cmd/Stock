import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text, Heading, SectionLabel, Glyph, Button, Card } from '@/components';
import { colors, layout } from '@/design';
import { useCookPlanStore } from '@/store/cookPlans';
import { parseCookPlanFromText, parseIngredientBullet, detectTimer } from '@/lib/parsing/cookPlan';
import { uid } from '@/lib/id';
import type { CookPlan, PlanComponent, PlanPhase } from '@/types';

type Mode = 'paste' | 'build';
type PasteState = 'input' | 'parsing' | 'review';

export default function CookPlanCapture() {
  const router = useRouter();
  const save = useCookPlanStore((s) => s.save);
  const [mode, setMode] = useState<Mode>('paste');

  const persist = async (
    fields: Pick<CookPlan, 'title' | 'spread' | 'components' | 'phases'>,
    origin: 'paste' | 'manual',
  ) => {
    const now = new Date();
    const plan: CookPlan = {
      id: uid('plan'),
      title: fields.title || 'Cook Plan',
      status: 'active',
      spread: fields.spread,
      components: fields.components,
      phases: fields.phases,
      createdAt: now,
      modifiedAt: now,
      cookCount: 0,
      origin,
    };
    await save(plan);
    router.replace({ pathname: '/cook-plan/[id]', params: { id: plan.id } });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Cancel
          </Text>
        </Pressable>
        <Text variant="recipeTitle">New cook plan</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.toggle}>
        <Pressable
          onPress={() => setMode('paste')}
          style={[styles.toggleBtn, mode === 'paste' && styles.toggleOn]}>
          <Text variant="bodyStrong" color={mode === 'paste' ? 'bg' : 'textMuted'}>
            Paste
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('build')}
          style={[styles.toggleBtn, mode === 'build' && styles.toggleOn]}>
          <Text variant="bodyStrong" color={mode === 'build' ? 'bg' : 'textMuted'}>
            Build
          </Text>
        </Pressable>
      </View>

      {mode === 'paste' ? (
        <PasteMode onSave={(f) => persist(f, 'paste')} />
      ) : (
        <BuildMode onSave={(f) => persist(f, 'manual')} />
      )}
    </SafeAreaView>
  );
}

/* ------------------------------ Paste mode ------------------------------ */

function PasteMode({
  onSave,
}: {
  onSave: (f: Pick<CookPlan, 'title' | 'spread' | 'components' | 'phases'>) => void;
}) {
  const [state, setState] = useState<PasteState>('input');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Pick<
    CookPlan,
    'title' | 'spread' | 'components' | 'phases'
  > | null>(null);

  const parse = async () => {
    if (!text.trim()) return;
    setState('parsing');
    try {
      const d = await parseCookPlanFromText(text);
      setDraft({ title: d.title, spread: d.spread, components: d.components, phases: d.phases });
      setState('review');
    } catch (e) {
      console.warn('[stock] cook-plan parse failed', e);
      setState('input');
    }
  };

  if (state === 'parsing') {
    return (
      <View style={styles.center}>
        <Text color="textMuted">Reading the plan…</Text>
      </View>
    );
  }

  if (state === 'review' && draft) {
    const steps = draft.phases.reduce((n, p) => n + p.steps.length, 0);
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Card tone="bg3" style={styles.reviewCard}>
          <SectionLabel color="textMuted">Parsed</SectionLabel>
          <Heading variant="recipeTitle">{draft.title}</Heading>
          <Text color="textMuted">
            {draft.components.length} components · {draft.phases.length} phases · {steps} steps
            {draft.spread.length ? ` · ${draft.spread.length} on the spread` : ''}
          </Text>
        </Card>

        {draft.phases.map((p) => (
          <View key={p.id} style={styles.reviewPhase}>
            <Text variant="bodyStrong">{p.label}</Text>
            {p.steps.map((s) => (
              <Text key={s.id} color="textMuted" style={styles.reviewStep}>
                {s.ordinal}. {s.text}
                {s.timer ? `  ⏱` : ''}
              </Text>
            ))}
          </View>
        ))}

        <View style={styles.reviewBtns}>
          <Button label="Edit text" variant="secondary" flex onPress={() => setState('input')} />
          <Button label="Save plan" glyph="done" flex onPress={() => onSave(draft)} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text color="textFaint" style={styles.hint}>
        Paste a cook plan — phases (TONIGHT / TOMORROW AM / the cook), component
        sub-recipes with bullet ingredients, numbered steps, and a "the full
        spread:" line. It gets structured into a runnable timeline.
      </Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder={'Cooking Plan: ...\nTONIGHT\nGinger-scallion oil\n* 1 cup oil ...'}
        placeholderTextColor={colors.textFaint}
        style={styles.pasteInput}
      />
      <Button label="Structure it" glyph="next" onPress={parse} disabled={!text.trim()} />
    </ScrollView>
  );
}

/* ------------------------------ Build mode ------------------------------ */

type DraftStep = { id: string; text: string };
type DraftPhase = { id: string; label: string; steps: DraftStep[] };
type DraftComp = { id: string; name: string; ingredientsText: string };

function BuildMode({
  onSave,
}: {
  onSave: (f: Pick<CookPlan, 'title' | 'spread' | 'components' | 'phases'>) => void;
}) {
  const [title, setTitle] = useState('');
  const [spread, setSpread] = useState('');
  const [phases, setPhases] = useState<DraftPhase[]>([
    { id: uid('dp'), label: 'Prep', steps: [{ id: uid('ds'), text: '' }] },
  ]);
  const [comps, setComps] = useState<DraftComp[]>([]);

  const addPhase = () =>
    setPhases((p) => [...p, { id: uid('dp'), label: '', steps: [{ id: uid('ds'), text: '' }] }]);
  const addStep = (phaseId: string) =>
    setPhases((p) =>
      p.map((ph) =>
        ph.id === phaseId ? { ...ph, steps: [...ph.steps, { id: uid('ds'), text: '' }] } : ph,
      ),
    );
  const setPhaseLabel = (phaseId: string, label: string) =>
    setPhases((p) => p.map((ph) => (ph.id === phaseId ? { ...ph, label } : ph)));
  const setStepText = (phaseId: string, stepId: string, text: string) =>
    setPhases((p) =>
      p.map((ph) =>
        ph.id === phaseId
          ? { ...ph, steps: ph.steps.map((s) => (s.id === stepId ? { ...s, text } : s)) }
          : ph,
      ),
    );

  const addComp = () => setComps((c) => [...c, { id: uid('dc'), name: '', ingredientsText: '' }]);
  const setComp = (id: string, patch: Partial<DraftComp>) =>
    setComps((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const canSave = title.trim().length > 0;

  const build = () => {
    const builtComps: PlanComponent[] = comps
      .filter((c) => c.name.trim())
      .map((c) => ({
        id: uid('comp'),
        name: c.name.trim(),
        ingredients: c.ingredientsText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => parseIngredientBullet(l)),
      }));
    const builtPhases: PlanPhase[] = phases
      .filter((ph) => ph.steps.some((s) => s.text.trim()))
      .map((ph) => ({
        id: uid('phase'),
        label: ph.label.trim() || 'Phase',
        steps: ph.steps
          .filter((s) => s.text.trim())
          .map((s, idx) => ({
            id: uid('pstep'),
            ordinal: idx + 1,
            text: s.text.trim(),
            timer: detectTimer(s.text),
          })),
      }));
    onSave({
      title: title.trim(),
      spread: spread
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      components: builtComps,
      phases: builtPhases,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SectionLabel color="textMuted">Title</SectionLabel>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Fried Chicken Night"
        placeholderTextColor={colors.textFaint}
        style={styles.input}
      />

      <SectionLabel color="textMuted" style={styles.lbl}>
        Timeline
      </SectionLabel>
      {phases.map((ph) => (
        <Card key={ph.id} style={styles.buildCard}>
          <TextInput
            value={ph.label}
            onChangeText={(t) => setPhaseLabel(ph.id, t)}
            placeholder="Phase (e.g. Tomorrow night)"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.phaseLabelInput]}
          />
          {ph.steps.map((s, i) => (
            <View key={s.id} style={styles.stepInputRow}>
              <Text color="textFaint" style={styles.stepNum}>
                {i + 1}
              </Text>
              <TextInput
                value={s.text}
                onChangeText={(t) => setStepText(ph.id, s.id, t)}
                placeholder="Step"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.flex]}
              />
            </View>
          ))}
          <Pressable onPress={() => addStep(ph.id)} hitSlop={6} style={styles.addInline}>
            <Text color="accent">+ Step</Text>
          </Pressable>
        </Card>
      ))}
      <Pressable onPress={addPhase} hitSlop={6} style={styles.addRow}>
        <Glyph name="add" size={14} color="accent" />
        <Text color="accent">Add phase</Text>
      </Pressable>

      <SectionLabel color="textMuted" style={styles.lbl}>
        Components (sub-recipes)
      </SectionLabel>
      {comps.map((c) => (
        <Card key={c.id} style={styles.buildCard}>
          <TextInput
            value={c.name}
            onChangeText={(t) => setComp(c.id, { name: t })}
            placeholder="Component name (e.g. Slaw dressing)"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />
          <TextInput
            value={c.ingredientsText}
            onChangeText={(t) => setComp(c.id, { ingredientsText: t })}
            multiline
            placeholder={'One ingredient per line\nRice vinegar: 59 g\nOlive oil: 40 g'}
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.compIngInput]}
          />
        </Card>
      ))}
      <Pressable onPress={addComp} hitSlop={6} style={styles.addRow}>
        <Glyph name="add" size={14} color="accent" />
        <Text color="accent">Add component</Text>
      </Pressable>

      <SectionLabel color="textMuted" style={styles.lbl}>
        The spread (menu)
      </SectionLabel>
      <TextInput
        value={spread}
        onChangeText={setSpread}
        multiline
        placeholder="fried chicken, rice, broth, slaw, kimchi…"
        placeholderTextColor={colors.textFaint}
        style={[styles.input, styles.spreadInput]}
      />

      <Button
        label="Save plan"
        glyph="done"
        onPress={build}
        disabled={!canSave}
        style={styles.saveBtn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  spacer: { width: 50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 12,
    paddingBottom: 10,
  },
  toggle: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: colors.bg3,
    borderRadius: 999,
    padding: 3,
    marginBottom: 6,
  },
  toggleBtn: { paddingHorizontal: 22, paddingVertical: 7, borderRadius: 999 },
  toggleOn: { backgroundColor: colors.accent },
  content: { padding: layout.screenPadding, paddingBottom: 40, gap: 12 },
  hint: { fontStyle: 'italic', lineHeight: 18 },
  pasteInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    padding: 12,
    minHeight: 280,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: 'top',
  },
  reviewCard: { gap: 6 },
  reviewPhase: { gap: 4, paddingTop: 4 },
  reviewStep: { lineHeight: 18, paddingLeft: 8 },
  reviewBtns: { flexDirection: 'row', gap: 10, paddingTop: 12 },
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
  lbl: { paddingTop: 8 },
  buildCard: { gap: 8 },
  phaseLabelInput: { fontWeight: '600' },
  stepInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepNum: { minWidth: 16, textAlign: 'center' },
  addInline: { paddingTop: 2 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  compIngInput: { minHeight: 90, textAlignVertical: 'top' },
  spreadInput: { minHeight: 70, textAlignVertical: 'top' },
  saveBtn: { marginTop: 16 },
});
