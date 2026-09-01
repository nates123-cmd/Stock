/**
 * Duplicate review.
 *
 * The stop-gap in useRecipeStore.save stops NEW duplicates. This screen is for
 * the ones already in the library — about ten pairs left behind when the May
 * slug import and the August NYT box import collided.
 *
 * Nothing here deletes on its own, deliberately. The matcher can prove that
 * two recipes share a canonical url or an identical set of title words, but it
 * cannot tell "Pasta Salad" from "Tapenade Pasta Salad" — those overlap just as
 * heavily and are different dinners. So certain matches are marked as such,
 * everything weaker is labelled "check this one", and the delete is always a
 * human's tap.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  BottomActionBar,
  Button,
  Card,
  Glyph,
  Heading,
  Pill,
  SectionLabel,
  Text,
} from '@/components';
import { colors } from '@/design';
import { useRecipeStore } from '@/store/recipes';
import { findDuplicateCandidates, richer, type DupeCandidate } from '@/lib/recipeDupes';
import type { Recipe } from '@/types';

const REASON_LABEL: Record<DupeCandidate['reason'], string> = {
  url: 'Same recipe link',
  title: 'Same title words',
  slug: 'Same import slug',
  similar: 'Similar — check this one',
};

export default function RecipeDuplicatesScreen() {
  const router = useRouter();
  const recipes = useRecipeStore((s) => s.recipes);
  const remove = useRecipeStore((s) => s.remove);

  /** Pairs already dealt with this session, so a resolved row disappears. */
  const [done, setDone] = useState<Set<string>>(new Set());

  const pairKey = (p: DupeCandidate) => [p.a.id, p.b.id].sort().join('|');

  const pairs = useMemo(
    () => findDuplicateCandidates(recipes).filter((p) => !done.has(pairKey(p))),
    [recipes, done],
  );

  const certain = pairs.filter((p) => p.certain);
  const maybe = pairs.filter((p) => !p.certain);

  const resolve = async (p: DupeCandidate, drop: Recipe) => {
    await remove(drop.id);
    setDone((s) => new Set(s).add(pairKey(p)));
  };

  const keepBoth = (p: DupeCandidate) => setDone((s) => new Set(s).add(pairKey(p)));

  const renderPair = (p: DupeCandidate) => {
    const suggested = richer(p.a, p.b);
    return (
      <Card key={pairKey(p)} style={styles.pair}>
        <View style={styles.pairHead}>
          <Pill label={REASON_LABEL[p.reason]} tone={p.certain ? 'warn' : 'muted'} />
        </View>

        {[p.a, p.b].map((r) => {
          const isSuggested = r.id === suggested.id;
          return (
            <View key={r.id} style={styles.side}>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/recipes/[id]', params: { id: r.id } })
                }>
                <Text variant="recipeTitle">{r.title}</Text>
                <Text color="textMuted">
                  {(r.ingredients?.length ?? 0)} ingredients ·{' '}
                  {(r.steps?.length ?? 0)} steps
                  {r.cookCount ? ` · cooked ${r.cookCount}×` : ''}
                  {r.folder ? ` · ${r.folder}` : ''}
                </Text>
                {r.source?.url ? (
                  <Text color="textFaint" numberOfLines={1}>
                    {r.source.url}
                  </Text>
                ) : null}
              </Pressable>
              <View style={styles.sideActions}>
                {isSuggested ? (
                  <View style={styles.keepHint}>
                    <Glyph name="done" size={13} color="accent" />
                    <Text color="accent">Suggested keep</Text>
                  </View>
                ) : (
                  <View />
                )}
                <Button
                  label="Delete this one"
                  variant="secondary"
                  onPress={() => void resolve(p, r)}
                />
              </View>
            </View>
          );
        })}

        <Pressable onPress={() => keepBoth(p)} style={styles.keepBoth}>
          <Text color="textFaint">They're different recipes — keep both</Text>
        </Pressable>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Heading variant="screenTitle">Duplicates</Heading>
        {pairs.length === 0 ? (
          <Text color="textMuted">
            Nothing left to review. New imports are checked automatically.
          </Text>
        ) : (
          <Text color="textMuted">
            {certain.length} look certain, {maybe.length} worth a glance. Deleting
            is always your call — open either recipe to compare first.
          </Text>
        )}

        {certain.length > 0 && (
          <>
            <SectionLabel color="textMuted">Almost certainly the same</SectionLabel>
            {certain.map(renderPair)}
          </>
        )}

        {maybe.length > 0 && (
          <>
            <SectionLabel color="textMuted">Similar — your call</SectionLabel>
            {maybe.map(renderPair)}
          </>
        )}
      </ScrollView>

      <BottomActionBar>
        <Button label="Done" flex onPress={() => router.back()} />
      </BottomActionBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 12 },
  pair: { gap: 12 },
  pairHead: { flexDirection: 'row' },
  side: {
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  sideActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  keepHint: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  keepBoth: { paddingTop: 4 },
});
