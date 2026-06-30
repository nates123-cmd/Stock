import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import { Text, Numeric, Glyph, Button } from '@/components';
import { colors, layout } from '@/design';
import { useCookPlanStore } from '@/store/cookPlans';
import {
  usePlanAlarms,
  ensureNotifyPermission,
  notifyEnabled,
  type PlanAlarm,
} from '@/lib/usePlanAlarms';
import { fmtClock } from '@/lib/useCookTimers';
import { phaseWindows, fmtWindow } from '@/lib/planSchedule';
import type { PlanStep, PlanTimer } from '@/types';

export default function CookPlanRun() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const plan = useCookPlanStore((s) => s.plans.find((p) => p.id === id));
  const save = useCookPlanStore((s) => s.save);
  const { alarms, startAlarm, clearAlarm } = usePlanAlarms(plan?.title ?? 'Cook plan');

  const [done, setDone] = useState<Set<string>>(new Set());
  const [notify, setNotify] = useState(notifyEnabled());

  const windows = useMemo(() => (plan ? phaseWindows(plan) : []), [plan]);
  const compById = useMemo(
    () => new Map((plan?.components ?? []).map((c) => [c.id, c])),
    [plan],
  );

  if (!plan) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text color="textMuted">Cook plan not found.</Text>
          <Button label="Close" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const allSteps = plan.phases.flatMap((p) => p.steps);
  const doneCount = allSteps.filter((s) => done.has(s.id)).length;

  const toggle = (stepId: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });

  const startStepTimer = (step: PlanStep) => {
    const t = step.timer;
    if (!t || t.kind === 'temp') return;
    if (t.kind === 'clock' && t.minSeconds) {
      startAlarm(`${step.text.slice(0, 28)} · ${t.label}`, t.minSeconds, {
        windowSeconds: t.maxSeconds,
        stepId: step.id,
      });
    } else if (t.seconds) {
      startAlarm(`${step.text.slice(0, 28)} · ${t.label}`, t.seconds, { stepId: step.id });
    }
  };

  const enableNotify = async () => {
    const ok = await ensureNotifyPermission();
    setNotify(ok);
  };

  const finish = () => {
    void save({ ...plan, cookCount: plan.cookCount + 1, modifiedAt: new Date() });
    router.back();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Exit
          </Text>
        </Pressable>
        <Text variant="recipeTitle" numberOfLines={1} style={styles.topTitle}>
          {plan.title}
        </Text>
        <Numeric color="textMuted">
          {doneCount}/{allSteps.length}
        </Numeric>
      </View>

      {!notify ? (
        <Pressable onPress={enableNotify} style={styles.notifyBar}>
          <Glyph name="timer" size={14} color="accent" />
          <Text color="accent" variant="sectionLabel" style={styles.flex}>
            Enable alarms so timers buzz even when you look away
          </Text>
          <Text color="accent" variant="sectionLabel">
            Turn on ›
          </Text>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={styles.content}>
        {plan.phases.map((phase) => {
          const w = windows.find((x) => x.phaseId === phase.id);
          const windowLabel = w ? fmtWindow(w) : '';
          const phaseDone = phase.steps.every((s) => done.has(s.id));
          return (
            <View key={phase.id} style={styles.phaseBlock}>
              <View style={styles.phaseHead}>
                <Text
                  variant="recipeTitle"
                  color={phaseDone ? 'ok' : 'text'}
                  style={styles.flex}>
                  {phase.label}
                </Text>
                {windowLabel ? (
                  <Text color="accent" variant="sectionLabel">
                    {windowLabel}
                  </Text>
                ) : null}
              </View>

              {phase.steps.map((step) => {
                const isDone = done.has(step.id);
                const comp = step.componentId ? compById.get(step.componentId) : undefined;
                return (
                  <View key={step.id} style={styles.stepRow}>
                    <Pressable
                      onPress={() => toggle(step.id)}
                      style={[styles.check, isDone && styles.checkOn]}
                      hitSlop={8}>
                      {isDone ? <Glyph name="done" size={13} color="bg" /> : null}
                    </Pressable>
                    <Pressable style={styles.flex} onPress={() => toggle(step.id)}>
                      <Text style={[isDone && styles.strike]} color={isDone ? 'textMuted' : 'text'}>
                        {step.text}
                      </Text>
                      {comp && comp.ingredients.length > 0 ? (
                        <Text color="textFaint" variant="sectionLabel" style={styles.ingLine}>
                          {comp.ingredients
                            .map((i) => (i.amount != null ? `${i.amount}${i.unit ?? ''} ${i.canonicalName}` : i.canonicalName))
                            .join(' · ')}
                        </Text>
                      ) : null}
                    </Pressable>
                    {step.timer ? <TimerButton timer={step.timer} onStart={() => startStepTimer(step)} /> : null}
                  </View>
                );
              })}
            </View>
          );
        })}

        <Button label="Mark cook done" glyph="done" onPress={finish} style={styles.finishBtn} />
      </ScrollView>

      {alarms.length > 0 ? (
        <View style={styles.alarmStrip}>
          {alarms.map((a) => (
            <AlarmPill key={a.id} alarm={a} onClear={() => clearAlarm(a.id)} />
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function TimerButton({ timer, onStart }: { timer: PlanTimer; onStart: () => void }) {
  if (timer.kind === 'temp') {
    return (
      <View style={styles.tempPill}>
        <Numeric color="text">
          {timer.tempF}
          {timer.tempHighF ? `-${timer.tempHighF}` : ''}°
        </Numeric>
      </View>
    );
  }
  return (
    <Pressable onPress={onStart} style={styles.startPill} hitSlop={6}>
      <Glyph name="timer" size={13} color="bg" />
      <Numeric color="bg">{timer.label.replace(/\s+/g, '')}</Numeric>
    </Pressable>
  );
}

function AlarmPill({ alarm, onClear }: { alarm: PlanAlarm; onClear: () => void }) {
  const windowOpen = alarm.done && alarm.windowSeconds;
  return (
    <Pressable onPress={onClear} style={[styles.alarmPill, alarm.done && styles.alarmDone]}>
      <Text color={alarm.done ? 'bg' : 'text'} variant="sectionLabel" numberOfLines={1} style={styles.alarmLabel}>
        {alarm.label}
      </Text>
      <Numeric color={alarm.done ? 'bg' : 'accent'}>
        {alarm.done ? (windowOpen ? 'ready' : 'done') : fmtClock(alarm.remaining)}
      </Numeric>
      <Glyph name="close" size={12} color={alarm.done ? 'bg' : 'textMuted'} />
    </Pressable>
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
  notifyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: layout.screenPadding,
    backgroundColor: colors.bg3,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  content: { padding: layout.screenPadding, paddingBottom: 40, gap: 8 },
  phaseBlock: { paddingTop: 8 },
  phaseHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  strike: { textDecorationLine: 'line-through' },
  ingLine: { paddingTop: 4, lineHeight: 16 },
  startPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tempPill: {
    backgroundColor: colors.bg3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  finishBtn: { marginTop: 24 },
  alarmStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: layout.screenPadding,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.bg2,
  },
  alarmPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bg3,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  alarmDone: { backgroundColor: colors.accent },
  alarmLabel: { maxWidth: 150 },
});
