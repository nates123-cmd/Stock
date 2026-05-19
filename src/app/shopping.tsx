import { useEffect, useMemo, useState } from 'react';
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
  consolidateSmart,
  consolidateLocalSmart,
  instacartText,
  CATEGORY_ORDER,
  type ShoppingLine,
  type ShoppingSource,
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

const srcQty = (s: ShoppingSource) =>
  s.amount == null ? 'some' : s.unit && s.unit !== 'pc' ? `${s.amount} ${s.unit}` : `×${s.amount}`;

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  // Render the local merge instantly, then upgrade with Claude's fuzzier
  // estimate when it resolves (graceful — consolidateSmart self-falls-back).
  const [items, setItems] = useState<ShoppingLine[]>([]);
  const [refining, setRefining] = useState(false);
  useEffect(() => {
    setItems(consolidateLocalSmart(weekRecipes));
    if (weekRecipes.length === 0) {
      setRefining(false);
      return;
    }
    let cancelled = false;
    setRefining(true);
    consolidateSmart(weekRecipes)
      .then((r) => !cancelled && setItems(r))
      .catch(() => {})
      .finally(() => !cancelled && setRefining(false));
    return () => {
      cancelled = true;
    };
  }, [weekRecipes]);

  const text = useMemo(() => instacartText(items), [items]);

  const toggle = (set: typeof setChecked) => (name: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const toggleCheck = toggle(setChecked);
  const toggleExpand = toggle(setExpanded);

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
            {refining ? ' · estimating…' : ''}
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
          <SummaryRow label="Items to buy" value={`${items.length}`} tone="accent" />
          <SummaryRow label="Already in pantry" value="0" tone="ok" />
          <Text color="textFaint" style={styles.pantryNote}>
            Quantities are estimates — merged across recipes, prep words and
            juice/zest folded into the whole item. Tap a row for the math.
            Pantry subtraction turns on with §10.
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
                    const on = checked.has(item.name);
                    const open = expanded.has(item.name);
                    return (
                      <Pressable
                        key={item.name}
                        style={styles.item}
                        onPress={() => toggleExpand(item.name)}>
                        <Pressable
                          hitSlop={10}
                          onPress={() => toggleCheck(item.name)}
                          style={[styles.check, on && styles.checkOn]}>
                          {on ? <Glyph name="done" size={12} color="bg" /> : null}
                        </Pressable>
                        <View style={styles.flex}>
                          <Text
                            style={on ? styles.struck : undefined}
                            color={on ? 'textFaint' : 'text'}>
                            {item.name}
                          </Text>
                          {item.math ? (
                            <Numeric color="textFaint" style={styles.breakdown}>
                              {item.math}
                            </Numeric>
                          ) : null}
                          {open ? (
                            <View style={styles.sources}>
                              {item.sources.map((s, i) => (
                                <Text
                                  key={`${s.recipe}-${i}`}
                                  color="textFaint"
                                  style={styles.sourceLine}>
                                  · {srcQty(s)} {s.text} — {s.recipe}
                                </Text>
                              ))}
                            </View>
                          ) : item.sources.length > 0 ? (
                            <Text color="textFaint" style={styles.expandHint}>
                              {item.sources.length} source
                              {item.sources.length > 1 ? 's' : ''} · tap for the math
                            </Text>
                          ) : null}
                        </View>
                        <Numeric
                          color={on ? 'textFaint' : 'text'}
                          style={styles.qty}>
                          {item.buy}
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
    alignItems: 'flex-start',
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
    marginTop: 1,
  },
  checkOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  struck: { textDecorationLine: 'line-through' },
  breakdown: { fontSize: 12, paddingTop: 2, lineHeight: 16 },
  sources: { paddingTop: 6, gap: 3 },
  sourceLine: { fontSize: 12, lineHeight: 16 },
  expandHint: { fontSize: 11, paddingTop: 3, fontStyle: 'italic' },
  qty: { fontSize: 14, fontWeight: '700', marginTop: 1 },
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
