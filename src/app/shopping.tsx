import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
// Inside a Swipeable, use gesture-handler's Pressable instead of RN's — the
// RN one consumes pointer events before Pan can pick them up, so swipes
// silently no-op on web.
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  BottomActionBar,
  Overlay,
} from '@/components';
import { colors, fonts, layout } from '@/design';
import { usePlanStore } from '@/store/plan';
import { useRecipeStore } from '@/store/recipes';
import { useHaveStore } from '@/store/have';
import { useExtrasStore, type ExtraItem } from '@/store/extras';
import { dateKey, startOfWeek, weekDays, weekRangeLabel } from '@/lib/week';
import {
  consolidateSmart,
  consolidateLocalSmart,
  instacartText,
  CATEGORY_ORDER,
  categorizeIngredient,
  type ShoppingLine,
  type ShoppingSource,
} from '@/lib/shopping';
import { formatAmount } from '@/lib/format';
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
  const extras = useExtrasStore((s) => s.items);
  const removeExtra = useExtrasStore((s) => s.remove);
  // Subscribe to have-state so rows re-render on tap (we use the Map directly
  // for derived booleans below, but the selector keeps us reactive).
  const haveByName = useHaveStore((s) => s.byName);
  const alwaysHaveMap = useHaveStore((s) => s.alwaysHave);
  const markHave = useHaveStore((s) => s.mark);
  const unmarkHave = useHaveStore((s) => s.unmark);
  const setAlways = useHaveStore((s) => s.setAlways);

  /** session-only dismissals — consolidated rows can be swiped off this run. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [haveOpen, setHaveOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealText, setRevealText] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  /** {name, isExtraId?} for the long-press action sheet. Null = closed. */
  const [menu, setMenu] = useState<{
    name: string;
    extraId: string | null;
  } | null>(null);

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

  const visibleItems = useMemo(
    () => items.filter((i) => !dismissed.has(`item:${i.name}`)),
    [items, dismissed],
  );

  /** Should this canonical name appear in the Already-have bucket? True if
   *  the user marked it this run OR they've pinned it as "always have." */
  const inHave = (name: string) =>
    isMarked(haveByName, name) || alwaysHaveMap[name.toLowerCase().trim()] === true;

  /** Lines actually destined for the cart — everything visible (consolidated
   *  + extras) minus what's routed to Already-have. Both the Copy-for-Instacart
   *  text and the "To buy" counter read from this list, so they always agree. */
  const buyLines = useMemo<ShoppingLine[]>(() => {
    const fromItems = visibleItems.filter((i) => !inHave(i.name));
    const fromExtras: ShoppingLine[] = extras
      .filter((e) => !inHave(e.canonicalName))
      .map((e) => ({
        name: e.canonicalName,
        category: categorizeIngredient(e.canonicalName),
        buy: extraQty(e),
        math: '',
        sources: [],
        confidence: 'summed' as const,
      }));
    return [...fromItems, ...fromExtras];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, haveByName, alwaysHaveMap]);

  const text = useMemo(() => instacartText(buyLines), [buyLines]);

  /** Always-have names NOT already represented by a row in the week's plan
   *  or extras. We surface these as ghost rows in the Already-have bucket
   *  so the user can verify the pinned set and remove pins from items the
   *  current week doesn't touch. */
  const ghostAlways = useMemo(() => {
    const seen = new Set<string>();
    for (const i of visibleItems) seen.add(i.name.toLowerCase().trim());
    for (const e of extras) seen.add(e.canonicalName.toLowerCase().trim());
    return Object.keys(alwaysHaveMap)
      .filter((k) => !seen.has(k))
      .sort();
  }, [visibleItems, extras, alwaysHaveMap]);

  const haveCount = useMemo(() => {
    let n = ghostAlways.length;
    for (const i of visibleItems) if (inHave(i.name)) n++;
    for (const e of extras) if (inHave(e.canonicalName)) n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, extras, haveByName, alwaysHaveMap, ghostAlways]);

  const buyCount = buyLines.length;

  const toggleExpand = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const toggleHave = (name: string) => {
    if (isMarked(haveByName, name)) unmarkHave(name);
    else markHave(name);
  };

  /** Dismiss a consolidated row for this run (session-local). */
  const dismissItem = (name: string) =>
    setDismissed((prev) => new Set(prev).add(`item:${name}`));

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
          <SummaryRow label="To buy" value={`${buyCount}`} tone="accent" />
          <SummaryRow label="Already have" value={`${haveCount}`} tone="ok" />
          <Text color="textFaint" style={styles.pantryNote}>
            Everything below is what you’re shopping for. Tap a row’s check —
            or swipe right — to drop something you already have. Swipe left
            to delete a row entirely. Long-press for more (incl. “Always
            have” to keep an item out of every future list).
          </Text>
        </Card>

        {visibleItems.length === 0 && extras.length === 0 ? (
          <Text color="textMuted" style={styles.empty}>
            Nothing planned for this week yet. Pin recipes on the Plan tab.
          </Text>
        ) : (
          CATEGORY_ORDER.filter((c) =>
            visibleItems.some((i) => i.category === c && !inHave(i.name)),
          ).map((cat) => (
            <View key={cat} style={styles.section}>
              <SectionLabel color="textMuted">{CAT_LABEL[cat]}</SectionLabel>
              {visibleItems
                .filter((i) => i.category === cat && !inHave(i.name))
                .map((item) => (
                  <ShoppingRow
                    key={item.name}
                    name={item.name}
                    qty={item.buy}
                    math={item.math ?? null}
                    sources={item.sources}
                    expanded={expanded.has(item.name)}
                    onTap={() => toggleExpand(item.name)}
                    onToggleHave={() => toggleHave(item.name)}
                    onDelete={() => dismissItem(item.name)}
                    onLongPress={() => setMenu({ name: item.name, extraId: null })}
                    marked={false}
                    always={false}
                    likely={isLikelyHave(haveByName, item.name)}
                  />
                ))}
            </View>
          ))
        )}

        {extras.some((e) => !inHave(e.canonicalName)) ? (
          <View style={styles.section}>
            <SectionLabel color="textMuted">Extras</SectionLabel>
            <Text color="textFaint" style={styles.extrasCaption}>
              Items you added outside the week’s recipes (from Pipeline ideas, etc.).
            </Text>
            {extras
              .filter((e) => !inHave(e.canonicalName))
              .slice()
              .sort(
                (a, b) =>
                  CATEGORY_ORDER.indexOf(categorizeIngredient(a.canonicalName)) -
                    CATEGORY_ORDER.indexOf(categorizeIngredient(b.canonicalName)) ||
                  a.canonicalName.localeCompare(b.canonicalName),
              )
              .map((ex) => (
                <ShoppingRow
                  key={ex.id}
                  name={ex.canonicalName}
                  qty={extraQty(ex)}
                  math={null}
                  origin={ex.originLabel}
                  onTap={() => {
                    /* extras are flat — nothing to expand */
                  }}
                  onToggleHave={() => toggleHave(ex.canonicalName)}
                  onDelete={() => removeExtra(ex.id)}
                  onLongPress={() =>
                    setMenu({ name: ex.canonicalName, extraId: ex.id })
                  }
                  marked={false}
                  always={false}
                  likely={isLikelyHave(haveByName, ex.canonicalName)}
                />
              ))}
          </View>
        ) : null}

        {haveCount > 0 ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => setHaveOpen((v) => !v)}
              style={styles.haveHeader}
              accessibilityRole="button"
              accessibilityLabel={
                haveOpen
                  ? 'Collapse already-have list'
                  : 'Expand already-have list'
              }>
              <SectionLabel color="ok">
                Already have · {haveCount}
              </SectionLabel>
              <Glyph
                name="expand"
                size={14}
                color="ok"
                style={haveOpen ? undefined : styles.haveCaretClosed}
              />
            </Pressable>
            {haveOpen ? (
              <>
                {visibleItems
                  .filter((i) => inHave(i.name))
                  .map((item) => {
                    const isAlways =
                      alwaysHaveMap[item.name.toLowerCase().trim()] === true;
                    return (
                      <ShoppingRow
                        key={`have:${item.name}`}
                        name={item.name}
                        qty={item.buy}
                        math={null}
                        onTap={() => toggleHave(item.name)}
                        onToggleHave={() => toggleHave(item.name)}
                        onDelete={() => dismissItem(item.name)}
                        onLongPress={() =>
                          setMenu({ name: item.name, extraId: null })
                        }
                        marked
                        always={isAlways}
                        likely={false}
                      />
                    );
                  })}
                {extras
                  .filter((e) => inHave(e.canonicalName))
                  .map((ex) => {
                    const isAlways =
                      alwaysHaveMap[ex.canonicalName.toLowerCase().trim()] === true;
                    return (
                      <ShoppingRow
                        key={`have:${ex.id}`}
                        name={ex.canonicalName}
                        qty={extraQty(ex)}
                        math={null}
                        origin={ex.originLabel}
                        onTap={() => toggleHave(ex.canonicalName)}
                        onToggleHave={() => toggleHave(ex.canonicalName)}
                        onDelete={() => removeExtra(ex.id)}
                        onLongPress={() =>
                          setMenu({ name: ex.canonicalName, extraId: ex.id })
                        }
                        marked
                        always={isAlways}
                        likely={false}
                      />
                    );
                  })}
                {ghostAlways.map((name) => (
                  <ShoppingRow
                    key={`ghost:${name}`}
                    name={name}
                    qty="—"
                    math={null}
                    onTap={() => setMenu({ name, extraId: null })}
                    onToggleHave={() => {
                      // Ghost row toggle = unpin always-have. (Session-mark
                      // would be meaningless here — no buy row exists.)
                      setAlways(name, false);
                    }}
                    onDelete={() => setAlways(name, false)}
                    onLongPress={() => setMenu({ name, extraId: null })}
                    marked
                    always
                    likely={false}
                  />
                ))}
              </>
            ) : null}
          </View>
        ) : null}

        <Card tone="bg2" style={styles.pantryCard}>
          <SectionLabel color="ok">Pantry subtraction (§10)</SectionLabel>
          <Text color="textMuted">
            The Pantry pillar replaces this with tracked stock + expiry —
            “Already have” is its lightweight precursor.
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

      <Overlay visible={menu !== null} onClose={() => setMenu(null)}>
        {menu ? (
          <RowMenu
            name={menu.name}
            extraId={menu.extraId}
            isAlways={alwaysHaveMap[menu.name.toLowerCase().trim()] === true}
            onToggleAlways={() => {
              const k = menu.name.toLowerCase().trim();
              setAlways(menu.name, !(alwaysHaveMap[k] === true));
              setMenu(null);
            }}
            onDelete={() => {
              if (menu.extraId) removeExtra(menu.extraId);
              else dismissItem(menu.name);
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
          />
        ) : null}
      </Overlay>

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
          disabled={buyLines.length === 0}
          onPress={copy}
        />
      </BottomActionBar>
    </SafeAreaView>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

type RowProps = {
  name: string;
  qty: string;
  math: string | null;
  sources?: ShoppingSource[];
  origin?: string | null;
  expanded?: boolean;
  marked: boolean;
  /** Pinned by the user as "always have." Forces the row into the Already-
   *  have bucket regardless of session state, and shows a small tag. */
  always: boolean;
  likely: boolean;
  onTap: () => void;
  onToggleHave: () => void;
  onDelete: () => void;
  onLongPress?: () => void;
};

function ShoppingRow({
  name,
  qty,
  math,
  sources,
  origin,
  expanded,
  marked,
  always,
  likely,
  onTap,
  onToggleHave,
  onDelete,
  onLongPress,
}: RowProps) {
  return (
    <ReanimatedSwipeable
      friction={2}
      leftThreshold={32}
      rightThreshold={32}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <Pressable
          onPress={onToggleHave}
          style={styles.haveAction}
          accessibilityRole="button"
          accessibilityLabel={
            marked
              ? `Move ${name} back to the shopping list`
              : `Drop ${name} — already have it`
          }>
          <Text color="bg" variant="bodyStrong" style={styles.deleteLabel}>
            {marked ? 'To buy' : 'Have'}
          </Text>
        </Pressable>
      )}
      renderRightActions={() => (
        <Pressable
          onPress={onDelete}
          style={styles.deleteAction}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${name} from this run`}>
          <Text color="bg" variant="bodyStrong" style={styles.deleteLabel}>
            Delete
          </Text>
        </Pressable>
      )}>
      <View style={styles.rowSurface}>
        <GHPressable
          style={styles.item}
          onPress={onTap}
          onLongPress={onLongPress}
          delayLongPress={350}>
          <GHPressable
            hitSlop={10}
            onPress={onToggleHave}
            // Polarity: filled = "shopping for it" (the default), empty =
            // "already have it" (the user dropped it). The list IS the buy
            // list, so the rest state is checked.
            style={[styles.check, !marked && styles.checkOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !marked }}
            accessibilityLabel={
              marked
                ? `Move ${name} back to the shopping list`
                : `Drop ${name} — already have it`
            }>
            {!marked ? <Glyph name="done" size={12} color="bg" /> : null}
          </GHPressable>
          <View style={styles.flex}>
            <View style={styles.nameRow}>
              <Text color={marked ? 'textFaint' : 'text'}>
                {name}
              </Text>
              {always ? (
                <Text color="ok" style={styles.alwaysTag}>
                  always
                </Text>
              ) : likely && !marked ? (
                <Text color="textFaint" style={styles.likelyTag}>
                  likely already have
                </Text>
              ) : null}
            </View>
            {origin ? (
              <Text color="textFaint" style={styles.origin}>
                {origin}
              </Text>
            ) : null}
            {math ? (
              <Numeric color="textFaint" style={styles.breakdown}>
                {math}
              </Numeric>
            ) : null}
            {expanded && sources ? (
              <View style={styles.sources}>
                {sources.map((s, i) => (
                  <Text
                    key={`${s.recipe}-${i}`}
                    color="textFaint"
                    style={styles.sourceLine}>
                    · {srcQty(s)} {s.text} — {s.recipe}
                  </Text>
                ))}
              </View>
            ) : sources && sources.length > 0 ? (
              <Text color="textFaint" style={styles.expandHint}>
                {sources.length} source{sources.length > 1 ? 's' : ''} · tap for the math
              </Text>
            ) : null}
          </View>
          <Numeric color={marked ? 'textFaint' : 'text'} style={styles.qty}>
            {qty}
          </Numeric>
        </GHPressable>
      </View>
    </ReanimatedSwipeable>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strikethrough state: "marked" within the current shop run (last 6h). */
function isMarked(
  byName: Record<string, { count: number; lastAt: Date }>,
  name: string,
): boolean {
  const r = byName[name.toLowerCase().trim()];
  if (!r) return false;
  const at = r.lastAt instanceof Date ? r.lastAt.getTime() : new Date(r.lastAt).getTime();
  return Date.now() - at < 6 * 60 * 60 * 1000;
}

/** Pre-shop hint: "you’ve marked this name ≥ 3× in the last 60 days." */
function isLikelyHave(
  byName: Record<string, { count: number; lastAt: Date }>,
  name: string,
): boolean {
  const r = byName[name.toLowerCase().trim()];
  if (!r) return false;
  const at = r.lastAt instanceof Date ? r.lastAt.getTime() : new Date(r.lastAt).getTime();
  const ageDays = (Date.now() - at) / 86_400_000;
  return r.count >= 3 && ageDays <= 60;
}

function extraQty(ex: ExtraItem): string {
  return formatAmount(ex.amount, ex.unit) || 'some';
}

// ─── Long-press action sheet ────────────────────────────────────────────────

function RowMenu({
  name,
  extraId,
  isAlways,
  onToggleAlways,
  onDelete,
  onClose,
}: {
  name: string;
  extraId: string | null;
  isAlways: boolean;
  onToggleAlways: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.menu}>
      <Text variant="bodyStrong" style={styles.menuTitle}>
        {name}
      </Text>
      <Text color="textFaint" style={styles.menuHint}>
        {isAlways
          ? 'Pinned as “always have.” Auto-routes to the Already-have bucket every run.'
          : 'Pin items you always have at home (salt, oil, tahini, parmesan…) so they stop landing on the buy list.'}
      </Text>
      <Pressable
        style={styles.menuItem}
        onPress={onToggleAlways}
        accessibilityRole="button">
        <Text variant="bodyStrong" color={isAlways ? 'accent' : 'text'}>
          {isAlways ? 'Remove “always have” pin' : 'Always have'}
        </Text>
        <Text color="textFaint" style={styles.menuItemHint}>
          {isAlways
            ? 'Will surface as a regular buy item again.'
            : 'Will surface as already-have on every shopping list.'}
        </Text>
      </Pressable>
      <Pressable
        style={styles.menuItem}
        onPress={onDelete}
        accessibilityRole="button">
        <Text variant="bodyStrong" color="accent">
          {extraId ? 'Delete from extras' : 'Delete from this run'}
        </Text>
        <Text color="textFaint" style={styles.menuItemHint}>
          {extraId
            ? 'Permanent — removes the row from your Extras store.'
            : 'Hides the row for this shopping run only.'}
        </Text>
      </Pressable>
      <Pressable style={styles.menuCancel} onPress={onClose}>
        <Text color="textMuted">Cancel</Text>
      </Pressable>
    </View>
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
  rowSurface: { backgroundColor: colors.bg },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  origin: { fontSize: 11, fontStyle: 'italic', paddingTop: 2 },
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
  extrasCaption: { fontSize: 11, fontStyle: 'italic', paddingBottom: 4 },
  haveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  haveCaretClosed: { transform: [{ rotate: '-90deg' }] },
  likelyTag: {
    fontSize: 11,
    fontStyle: 'italic',
    backgroundColor: colors.lineSoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  deleteAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: 22,
    gap: 6,
  },
  haveAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ok,
    paddingHorizontal: 22,
    gap: 6,
  },
  deleteLabel: { fontSize: 13 },
  alwaysTag: {
    fontSize: 11,
    fontStyle: 'italic',
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.ok,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  menu: { gap: 6, paddingTop: 4 },
  menuTitle: { fontSize: 16, paddingBottom: 2 },
  menuHint: { fontStyle: 'italic', lineHeight: 18, paddingBottom: 6 },
  menuItem: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: 2,
  },
  menuItemHint: { fontSize: 12, fontStyle: 'italic' },
  menuCancel: {
    paddingTop: 16,
    paddingBottom: 2,
    alignItems: 'center',
  },
});
