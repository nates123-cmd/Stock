import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  SectionLabel,
  Card,
  Button,
  Pill,
  Glyph,
  Overlay,
} from '@/components';
import { colors, layout } from '@/design';
import { useCookPlanStore } from '@/store/cookPlans';
import { phaseWindows, fmtWindow, totalSteps } from '@/lib/planSchedule';
import type { CookPlan, PlanComponent } from '@/types';

export default function CookPlanDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const plan = useCookPlanStore((s) => s.plans.find((p) => p.id === id));
  const save = useCookPlanStore((s) => s.save);
  const remove = useCookPlanStore((s) => s.remove);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [openComp, setOpenComp] = useState<string | null>(null);

  const windows = useMemo(() => (plan ? phaseWindows(plan) : []), [plan]);
  const compById = useMemo(
    () => new Map((plan?.components ?? []).map((c) => [c.id, c])),
    [plan],
  );

  if (!plan) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text color="textMuted">Cook plan not found.</Text>
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const schedule = (serveAt: Date | undefined) => {
    void save({ ...plan, serveAt, modifiedAt: new Date() });
    setScheduleOpen(false);
  };

  const del = () => {
    void remove(plan.id);
    router.back();
  };

  return (
    <View style={styles.root}>
      <Screen>
        {/* Top bar */}
        <View style={styles.topbar}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text variant="bodyStrong" color="textMuted">
              ‹ Back
            </Text>
          </Pressable>
          <Pressable onPress={() => setScheduleOpen(true)} hitSlop={8}>
            <Text color="accent">{plan.serveAt ? 'Reschedule' : 'Schedule'}</Text>
          </Pressable>
        </View>

        <Heading variant="screenTitle">{plan.title}</Heading>
        <View style={styles.metaRow}>
          <Pill label="Cook plan" tone="warn" />
          <Text color="textMuted">
            {plan.components.length} components · {plan.phases.length} phases ·{' '}
            {totalSteps(plan)} steps
          </Text>
        </View>

        {plan.serveAt ? (
          <Card tone="bg3" style={styles.serveCard}>
            <SectionLabel color="textMuted">Serving</SectionLabel>
            <Text variant="bodyStrong">
              {plan.serveAt.toLocaleString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
            </Text>
          </Card>
        ) : null}

        <Button
          label="Run this cook"
          glyph="next"
          onPress={() =>
            router.push({ pathname: '/cook-plan/run/[id]', params: { id: plan.id } })
          }
          style={styles.runBtn}
        />

        {/* The spread */}
        {plan.spread.length > 0 ? (
          <View style={styles.section}>
            <SectionLabel color="textMuted">The spread</SectionLabel>
            <Card style={styles.spreadCard}>
              {plan.spread.map((s, i) => (
                <View key={i} style={styles.spreadRow}>
                  <Glyph name="done" size={13} color="ok" />
                  <Text style={styles.flex}>{s}</Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {/* Timeline */}
        <View style={styles.section}>
          <SectionLabel color="textMuted">Timeline</SectionLabel>
          {plan.phases.map((phase) => {
            const w = windows.find((x) => x.phaseId === phase.id);
            const windowLabel = w ? fmtWindow(w) : '';
            return (
              <View key={phase.id} style={styles.phaseBlock}>
                <View style={styles.phaseHead}>
                  <Text variant="recipeTitle">{phase.label}</Text>
                  {windowLabel ? (
                    <Text color="accent" variant="sectionLabel">
                      {windowLabel}
                    </Text>
                  ) : null}
                </View>
                {phase.steps.map((step) => {
                  const comp = step.componentId ? compById.get(step.componentId) : undefined;
                  return (
                    <View key={step.id} style={styles.stepRow}>
                      <Text color="textFaint" style={styles.stepNum}>
                        {step.ordinal}
                      </Text>
                      <View style={styles.flex}>
                        <Text>{step.text}</Text>
                        {step.timer ? (
                          <Text color="textMuted" variant="sectionLabel" style={styles.timerHint}>
                            {timerLabel(step.timer)}
                          </Text>
                        ) : null}
                        {comp ? (
                          <Text color="textFaint" variant="sectionLabel">
                            {comp.ingredients.length} ingredients
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        {/* Components */}
        <View style={styles.section}>
          <SectionLabel color="textMuted">Components</SectionLabel>
          {plan.components.map((c) => (
            <ComponentCard
              key={c.id}
              component={c}
              open={openComp === c.id}
              onToggle={() => setOpenComp(openComp === c.id ? null : c.id)}
            />
          ))}
        </View>

        {plan.myNotes ? (
          <View style={styles.section}>
            <SectionLabel color="textMuted">Notes</SectionLabel>
            <Card>
              <Text color="textMuted" style={styles.notes}>
                {plan.myNotes}
              </Text>
            </Card>
          </View>
        ) : null}

        <Pressable onPress={del} style={styles.delete} hitSlop={6}>
          <Text color="warn">Delete cook plan</Text>
        </Pressable>
      </Screen>

      <Overlay visible={scheduleOpen} onClose={() => setScheduleOpen(false)}>
        <ScheduleSheet plan={plan} onSet={schedule} onClear={() => schedule(undefined)} />
      </Overlay>
    </View>
  );
}

function timerLabel(t: CookPlan['phases'][number]['steps'][number]['timer']): string {
  if (!t) return '';
  if (t.kind === 'temp')
    return `oil/oven ${t.tempF}${t.tempHighF ? `-${t.tempHighF}` : ''}°F`;
  if (t.kind === 'clock') return `timer · ${t.label}`;
  return `timer · ${t.label}`;
}

function ComponentCard({
  component,
  open,
  onToggle,
}: {
  component: PlanComponent;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Card style={styles.compCard}>
      <Pressable onPress={onToggle} style={styles.compHead} hitSlop={4}>
        <Text variant="bodyStrong" style={styles.flex}>
          {component.name}
        </Text>
        {component.bakersPercent ? <Pill label="baker's %" tone="ok" /> : null}
        <Glyph name={open ? 'expand' : 'next'} size={14} color="textMuted" />
      </Pressable>
      {open ? (
        <View style={styles.compBody}>
          {component.ingredients.map((ing) => (
            <View key={ing.id} style={styles.ingRow}>
              <Text color="textMuted" style={styles.ingAmt}>
                {ing.amount != null ? `${ing.amount}${ing.unit ?? ''}` : ''}
              </Text>
              <Text style={styles.flex}>{ing.canonicalName}</Text>
            </View>
          ))}
          {component.notes ? (
            <Text color="textFaint" style={styles.compNotes}>
              {component.notes}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function ScheduleSheet({
  plan,
  onSet,
  onClear,
}: {
  plan: CookPlan;
  onSet: (d: Date) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState(
    plan.serveAt ? isoLocal(plan.serveAt) : '',
  );
  const submit = () => {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) onSet(d);
  };
  return (
    <View style={styles.sheet}>
      <Text variant="recipeTitle">Schedule the cook</Text>
      <Text color="textFaint" style={styles.sheetHint}>
        Set the serve time and each phase shows when to start (brine = serve
        minus its window). Quick picks below, or type a time.
      </Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder="2026-07-04 19:00"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        style={styles.input}
      />
      <View style={styles.quickRow}>
        {quickPicks().map((q) => (
          <Pressable key={q.label} onPress={() => onSet(q.date)} style={styles.quick}>
            <Text color="text" variant="sectionLabel">
              {q.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.sheetBtns}>
        <Button label="Set time" glyph="done" flex onPress={submit} />
      </View>
      {plan.serveAt ? (
        <Pressable onPress={onClear} hitSlop={6} style={styles.clearBtn}>
          <Text color="warn">Clear schedule</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function quickPicks(): { label: string; date: Date }[] {
  const at = (addDays: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  return [
    { label: 'Today 7pm', date: at(0, 19) },
    { label: 'Tomorrow 6pm', date: at(1, 18) },
    { label: 'Tomorrow 7pm', date: at(1, 19) },
    { label: 'Sat 7pm', date: nextSat(19) },
  ];
}

function nextSat(hour: number): Date {
  const d = new Date();
  const day = d.getDay();
  const delta = (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(hour, 0, 0, 0);
  return d;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 80 },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 12,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, flexWrap: 'wrap' },
  serveCard: { marginTop: 14, gap: 4 },
  runBtn: { marginTop: 16 },
  section: { paddingTop: 22, gap: 10 },
  spreadCard: { gap: 8 },
  spreadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phaseBlock: { paddingBottom: 6 },
  phaseHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  stepRow: { flexDirection: 'row', gap: 12, paddingVertical: 8 },
  stepNum: { minWidth: 18, textAlign: 'center' },
  timerHint: { paddingTop: 2 },
  compCard: { gap: 0 },
  compHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compBody: { paddingTop: 12, gap: 6 },
  ingRow: { flexDirection: 'row', gap: 12 },
  ingAmt: { minWidth: 58 },
  compNotes: { fontStyle: 'italic', lineHeight: 18, paddingTop: 6 },
  notes: { lineHeight: 20 },
  delete: { alignItems: 'center', paddingTop: 30, paddingBottom: 10 },
  sheet: { gap: 12 },
  sheetHint: { fontStyle: 'italic', lineHeight: 18 },
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
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quick: {
    backgroundColor: colors.bg3,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  sheetBtns: { flexDirection: 'row', gap: 10, paddingTop: 4 },
  clearBtn: { alignItems: 'center', paddingTop: 6 },
});
