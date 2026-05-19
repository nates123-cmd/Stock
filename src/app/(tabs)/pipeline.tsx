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
  Fab,
} from '@/components';
import { colors, type ColorToken } from '@/design';
import { usePipelineStore } from '@/store/pipeline';
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

export default function PipelineScreen() {
  const router = useRouter();
  const ideas = usePipelineStore((s) => s.ideas);
  const [tab, setTab] = useState<Tab>('Active');

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
      b.createdAt.getTime() - a.createdAt.getTime();
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
          {list.map((idea) => (
            <Pressable
              key={idea.id}
              onPress={() =>
                router.push({ pathname: '/idea/[id]', params: { id: idea.id } })
              }>
              <View
                style={[
                  styles.card,
                  { borderLeftColor: colors[STATUS_COLOR[idea.status]] },
                ]}>
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
                    {idea.references.length > 0
                      ? `· ${idea.references.length} ref${idea.references.length === 1 ? '' : 's'} `
                      : ''}
                    · {relativeAge(idea.createdAt)}
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}

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

      <Fab onPress={() => router.push('/idea-capture')} />
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
  },
  note: { lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  meta: { fontSize: 12 },
  empty: { paddingTop: 60, alignItems: 'center', gap: 6 },
});
