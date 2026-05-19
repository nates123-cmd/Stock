import { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  BottomActionBar,
} from '@/components';
import { colors, fonts, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { dateKey, startOfWeek, weekDays, weekRangeLabel } from '@/lib/week';
import {
  consolidate,
  breakdownLabel,
  quantityLabel,
  instacartText,
  CATEGORY_ORDER,
} from '@/lib/shopping';
import type { Recipe, ShoppingCategory } from '@/types';

const CAT_LABEL: Record<ShoppingCategory, string> = {
  produce: 'Produce',
  meat: 'Meat',
  dairy: 'Dairy',
  bakery: 'Bakery',
  pantry: 'Pantry',
  frozen: 'Frozen',
  other: 'Other',
};

export default function ShoppingList() {
  const router = useRouter();
  const params = useLocalSearchParams<{ weekStart: string }>();
  const weekStart = useMemo(
    () => (params.weekStart ? new Date(params.weekStart) : startOfWeek(new Date())),
    [params.weekStart],
  );
  const entries = usePlanStore((s) => s.entries);
  const recipes = useRecipeStore((s) => s.recipes);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [revealText, setRevealText] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const weekRecipes = useMemo(() => {
    const keys = new Set(weekDays(weekStart).map(dateKey));
    const byId = new Map<string, Recipe>(recipes.map((r) => [r.id, r]));
    return entries
      .filter(
        (e) => keys.has(dateKey(e.date)) && e.status === 'planned' && e.recipeId,
      )
      .map((e) => byId.get(e.recipeId as string))
      .filter((r): r is Recipe => !!r);
  }, [entries, recipes, weekStart]);

  const items = useMemo(() => consolidate(weekRecipes), [weekRecipes]);
  const text = useMemo(() => instacartText(items), [items]);

  const toggle = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const copy = async () => {
    const clip =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as {
            clipboard?: { writeText(t: string): Promise<void> };
          }).clipboard
        : undefined;
    if (Platform.OS === 'web' && clip?.writeText) {
      try {
        await clip.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        /* fall through to reveal */
      }
    }
    // No clipboard dep on native in v1 — reveal selectable text instead.
    setRevealText(true);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Heading variant="screenTitle">Shopping list</Heading>
          <Text color="textMuted">
            {weekRecipes.length} recipes · {weekRangeLabel(weekStart)}
          </Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Done
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.summary}>
          <SummaryRow label="Total needed" value={`${items.length} ingredients`} />
          <SummaryRow label="Already in pantry" value="0 items" tone="ok" />
          <SummaryRow label="To buy" value={`${items.length} items`} tone="accent" />
          <Text color="textFaint" style={styles.pantryNote}>
            Pantry subtraction turns on with the Pantry pillar (spec §10) — for
            now everything is on the buy list.
          </Text>
        </Card>

        {items.length === 0 ? (
          <Text color="textMuted" style={styles.empty}>
            Nothing planned for this week yet. Pin recipes on the Plan tab.
          </Text>
        ) : (
          CATEGORY_ORDER.filter((c) => items.some((i) => i.category === c)).map(
            (cat) => (
              <View key={cat} style={styles.section}>
                <SectionLabel color="textMuted">{CAT_LABEL[cat]}</SectionLabel>
                {items
                  .filter((i) => i.category === cat)
                  .map((item) => {
                    const on = checked.has(item.canonicalName);
                    return (
                      <Pressable
                        key={item.canonicalName}
                        style={styles.item}
                        onPress={() => toggle(item.canonicalName)}>
                        <View style={[styles.check, on && styles.checkOn]}>
                          {on ? <Glyph name="done" size={12} color="bg" /> : null}
                        </View>
                        <View style={styles.flex}>
                          <Text
                            style={on ? styles.struck : undefined}
                            color={on ? 'textFaint' : 'text'}>
                            {item.canonicalName}
                          </Text>
                          <Numeric color="textFaint" style={styles.breakdown}>
                            {breakdownLabel(item)}
                          </Numeric>
                        </View>
                        <Numeric color={on ? 'textFaint' : 'text'} style={styles.qty}>
                          {quantityLabel(item)}
                        </Numeric>
                      </Pressable>
                    );
                  })}
              </View>
            ),
          )
        )}

        <Card tone="bg2" style={styles.pantryCard}>
          <SectionLabel color="ok">Already in pantry</SectionLabel>
          <Text color="textMuted">
            Nothing subtracted yet — the Pantry pillar (§10) feeds this.
          </Text>
        </Card>

        {revealText ? (
          <Card style={styles.revealCard}>
            <SectionLabel color="textMuted">
              Select & copy (clipboard wiring deferred on native — spec §13)
            </SectionLabel>
            <TextInput
              value={text}
              editable={false}
              multiline
              style={styles.revealText}
            />
          </Card>
        ) : null}

        {hint ? (
          <Text color="textMuted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </ScrollView>

      <BottomActionBar>
        <Button
          label="Edit list"
          variant="secondary"
          flex
          onPress={() =>
            setHint('Inline list editing arrives with Pantry consolidation — spec §10.')
          }
        />
        <Button
          label={copied ? 'Copied ✓' : 'Copy for Instacart'}
          glyph="next"
          flex
          disabled={items.length === 0}
          onPress={copy}
        />
      </BottomActionBar>
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
  tone = 'text',
}: {
  label: string;
  value: string;
  tone?: 'text' | 'ok' | 'accent';
}) {
  return (
    <View style={styles.summaryRow}>
      <Text color="textMuted">{label}</Text>
      <Numeric color={tone}>{value}</Numeric>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 12,
  },
  body: { padding: layout.screenPadding, paddingBottom: 30, gap: 16 },
  summary: { gap: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pantryNote: { fontStyle: 'italic', lineHeight: 18, paddingTop: 2 },
  section: { gap: 4 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
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
  struck: { textDecorationLine: 'line-through' },
  breakdown: { fontSize: 12, paddingTop: 2 },
  qty: { fontSize: 14, fontWeight: '700' },
  pantryCard: { gap: 6 },
  empty: { textAlign: 'center', paddingVertical: 40 },
  revealCard: { gap: 8 },
  revealText: {
    fontFamily: fonts.mono,
    minHeight: 140,
    color: colors.text,
    fontSize: 13,
  },
  hint: { fontStyle: 'italic', textAlign: 'center' },
});
