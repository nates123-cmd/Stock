import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  SectionLabel,
  FilterChip,
  ChipRow,
  Glyph,
  Overlay,
} from '@/components';
import { colors, type ColorToken } from '@/design';
import { usePipelineStore } from '@/store/pipeline';
import { useExtrasStore } from '@/store/extras';
import { usePlanStore } from '@/store/plan';
import { relativeAge } from '@/lib/format';
import type { PipelineIdea } from '@/types';

type Tab = 'Active' | 'Captured' | 'Researching' | 'Ready' | 'Archive';

const STATUS_COLOR: Record<PipelineIdea['status'], ColorToken> = {
  captured: 'line',
  researching: 'warn',
  ready: 'ok',
  attempted: 'accent',
  promoted: 'textFaint',
};

const STATUS_LABEL: Record<PipelineIdea['status'], string> = {
  captured: 'captured',
  researching: 'researching',
  ready: 'ready to try',
  attempted: 'attempted',
  promoted: 'promoted',
};

/**
 * Expo Router route-level error boundary — renders instead of a blank screen
 * if PipelineScreen throws, surfacing the error on-device with a retry.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <View
      style={{
        flex: 1,
        padding: 24,
        gap: 12,
        backgroundColor: colors.bg,
        justifyContent: 'center',
      }}>
      <Heading variant="screenTitle">Pipeline hit an error</Heading>
      <Text color="textMuted">{String(error?.message ?? error)}</Text>
      <Pressable onPress={retry}>
        <Text color="accent">Tap to retry</Text>
      </Pressable>
    </View>
  );
}

export default function PipelineScreen() {
  const router = useRouter();
  const ideas = usePipelineStore((s) => s.ideas);
  const addExtras = useExtrasStore((s) => s.add);
  const removeExtrasByOrigin = useExtrasStore((s) => s.removeByOrigin);
  const extraItems = useExtrasStore((s) => s.items);
  // Derive the Set in a memo. Returning `new Set(...)` straight from the
  // zustand selector makes a new reference every render, which trips zustand's
  // reference-equality check into an infinite update loop (React #185).
  const stagedOriginIds = useMemo(
    () => new Set(extraItems.map((x) => x.originId)),
    [extraItems],
  );
  const addDish = usePlanStore((s) => s.addDish);
  const [tab, setTab] = useState<Tab>('Active');
  const [pushed, setPushed] = useState<{ id: string; count: number } | null>(null);
  // Day-picker overlay state for the inline "+ Plan" action (spec §8).
  const [planTarget, setPlanTarget] = useState<PipelineIdea | null>(null);
  const [planned, setPlanned] = useState<{ id: string; label: string } | null>(null);

  // List-card "+ Cart" — spec §8. If the idea has best-guess ingredients
  // already, push them straight to extras (same as detail-view action). If
  // not, route to detail with a flag that opens the capture modal — keeps a
  // single source of truth for the Claude-parse step.
  const addToCart = (idea: PipelineIdea) => {
    const ings = idea.bestGuessIngredients ?? [];
    if (ings.length === 0) {
      router.push({
        pathname: '/idea/[id]',
        params: { id: idea.id, openCart: '1' },
      });
      return;
    }
    removeExtrasByOrigin(idea.id);
    addExtras(
      ings.map((i) => ({
        canonicalName: i.canonicalName,
        amount: i.amount,
        unit: i.unit,
        originLabel: `from pipeline: '${idea.title}'`,
        originId: idea.id,
      })),
    );
    setPushed({ id: idea.id, count: ings.length });
    setTimeout(() => setPushed(null), 4000);
  };

  const addToRecipe = (idea: PipelineIdea) =>
    router.push({
      pathname: '/capture',
      params: {
        ideaId: idea.id,
        prefillTitle: idea.title,
        refs: JSON.stringify(idea.references),
      },
    });

  // "+ Plan" — add the idea to a target day as an experiment dish (Phase B:
  // merges into that day's default meal; user can swipe-delete on the plan).
  const planForDay = async (idea: PipelineIdea, offsetDays: number, label: string) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(0, 0, 0, 0);
    await addDish(d, { pipelineId: idea.id, title: idea.title });
    setPlanTarget(null);
    setPlanned({ id: idea.id, label });
    setTimeout(() => setPlanned(null), 4000);
  };

  const activeCount = ideas.filter((i) => i.status !== 'promoted').length;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'Active', label: `Active (${activeCount})` },
    { key: 'Captured', label: 'Captured' },
    { key: 'Researching', label: 'Researching' },
    { key: 'Ready', label: 'Ready' },
    { key: 'Archive', label: 'Archive' },
  ];

  const list = useMemo(() => {
    const byNew = (a: PipelineIdea, b: PipelineIdea) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    let rs = ideas;
    if (tab === 'Active') rs = ideas.filter((i) => i.status !== 'promoted');
    else if (tab === 'Captured') rs = ideas.filter((i) => i.status === 'captured');
    else if (tab === 'Researching')
      rs = ideas.filter((i) => i.status === 'researching');
    else if (tab === 'Ready') rs = ideas.filter((i) => i.status === 'ready');
    else rs = ideas.filter((i) => i.status === 'promoted');
    return [...rs].sort(byNew);
  }, [ideas, tab]);

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <Heading variant="screenTitle">Pipeline</Heading>
          <Text color="textMuted">{activeCount} cooking</Text>
        </View>

        <View style={styles.chips}>
          <ChipRow>
            {tabs.map((t) => (
              <FilterChip
                key={t.key}
                label={t.label}
                active={tab === t.key}
                onPress={() => setTab(t.key)}
              />
            ))}
          </ChipRow>
        </View>

        <View style={styles.list}>
          {list.map((idea) => {
            const promoted = idea.status === 'promoted';
            const staged = stagedOriginIds.has(idea.id);
            const refCount = idea.references?.length ?? 0;
            return (
              <View
                key={idea.id}
                style={[
                  styles.card,
                  { borderLeftColor: colors[STATUS_COLOR[idea.status]] },
                ]}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/idea/[id]', params: { id: idea.id } })
                  }>
                  <Text variant="recipeTitle" numberOfLines={1}>
                    {idea.title}
                  </Text>
                  {idea.note ? (
                    <Text color="textMuted" numberOfLines={2} style={styles.note}>
                      {idea.note}
                    </Text>
                  ) : null}
                  <View style={styles.metaRow}>
                    <SectionLabel color={STATUS_COLOR[idea.status]}>
                      {STATUS_LABEL[idea.status]}
                    </SectionLabel>
                    <Text color="textFaint" style={styles.meta}>
                      {refCount > 0
                        ? `· ${refCount} ref${refCount === 1 ? '' : 's'} `
                        : ''}
                      · {relativeAge(new Date(idea.createdAt))}
                    </Text>
                  </View>
                </Pressable>
                {!promoted ? (
                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => addToRecipe(idea)}
                      style={styles.actionPill}
                      accessibilityRole="button"
                      accessibilityLabel={`Promote ${idea.title} to a recipe`}>
                      <Glyph name="add" size={12} color="accent" />
                      <Text variant="bodyStrong" color="accent">
                        Recipe
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => addToCart(idea)}
                      style={styles.actionPill}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${idea.title} to your shopping list`}>
                      <Glyph name="add" size={12} color="accent" />
                      <Text variant="bodyStrong" color="accent">
                        Cart
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setPlanTarget(idea)}
                      style={styles.actionPill}
                      accessibilityRole="button"
                      accessibilityLabel={`Plan ${idea.title} as an experiment`}>
                      <Glyph name="add" size={12} color="accent" />
                      <Text variant="bodyStrong" color="accent">
                        Plan
                      </Text>
                    </Pressable>
                    {planned?.id === idea.id ? (
                      <Text color="ok" style={styles.pushedHint}>
                        planned {planned.label}
                      </Text>
                    ) : pushed?.id === idea.id ? (
                      <Text color="ok" style={styles.pushedHint}>
                        +{pushed.count} to list
                      </Text>
                    ) : staged ? (
                      <Text color="textFaint" style={styles.pushedHint}>
                        staged
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          {list.length === 0 ? (
            <View style={styles.empty}>
              <Text color="textMuted">Nothing here yet.</Text>
              <Text color="textFaint">
                {tab === 'Archive'
                  ? 'Promoted ideas land here once you cook them.'
                  : 'Tap + to capture a half-formed idea.'}
              </Text>
            </View>
          ) : null}
        </View>
      </Screen>

      <Overlay visible={planTarget != null} onClose={() => setPlanTarget(null)}>
        {planTarget ? (
          <View style={styles.planSheet}>
            <Text variant="recipeTitle" numberOfLines={1}>
              Plan {planTarget.title}
            </Text>
            <Text color="textFaint" style={styles.planHint}>
              Pins the idea as an experiment on the chosen day's dinner — dashed
              warn-tinted cell on the plan. Replaces anything already there.
            </Text>
            <View style={styles.planRow}>
              <Pressable
                onPress={() => planForDay(planTarget, 0, 'today')}
                style={styles.planBtn}>
                <Text variant="bodyStrong">Today</Text>
              </Pressable>
              <Pressable
                onPress={() => planForDay(planTarget, 1, 'tomorrow')}
                style={styles.planBtn}>
                <Text variant="bodyStrong">Tomorrow</Text>
              </Pressable>
              <Pressable
                onPress={() => planForDay(planTarget, 2, 'in 2 days')}
                style={styles.planBtn}>
                <Text variant="bodyStrong">In 2 days</Text>
              </Pressable>
            </View>
            {(planTarget.bestGuessIngredients ?? []).length === 0 ? (
              <Text color="textFaint" style={styles.planHint}>
                This idea has no best-guess ingredients yet — the shopping list
                won't reflect it until you tap{' '}
                <Text variant="bodyStrong" color="textMuted">
                  + Cart
                </Text>{' '}
                to capture them.
              </Text>
            ) : null}
          </View>
        ) : null}
      </Overlay>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 14,
  },
  chips: { marginHorizontal: -20, paddingHorizontal: 20, paddingBottom: 6 },
  list: { paddingTop: 10, gap: 12 },
  card: {
    backgroundColor: colors.bg2,
    borderRadius: 14,
    borderLeftWidth: 4,
    padding: 16,
    gap: 6,
    // Same minWidth:0 defensive pattern — keeps long titles inside the
    // card on narrow phones (#10).
    minWidth: 0,
  },
  note: { lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  meta: { fontSize: 12 },
  empty: { paddingTop: 60, alignItems: 'center', gap: 6 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineSoft,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  pushedHint: { fontSize: 12, fontStyle: 'italic', marginLeft: 'auto' },
  planSheet: { gap: 12 },
  planHint: { fontStyle: 'italic', lineHeight: 18 },
  planRow: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  planBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
    alignItems: 'center',
  },
});
