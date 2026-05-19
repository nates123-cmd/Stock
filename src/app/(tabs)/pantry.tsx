import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Screen,
  Heading,
  Text,
  Numeric,
  SectionLabel,
  Card,
  Button,
  Pill,
  Glyph,
} from '@/components';
import { colors } from '@/design';
import { usePantryStore } from '@/store/pantry';
import {
  cycleEstimateDays,
  formatCycle,
  freshnessStatus,
  isCycleStable,
  isRecentlyAdded,
  shortDate,
} from '@/lib/pantry';
import type { PantryItem } from '@/types';

/**
 * Pantry list (spec §10). Sectioned by Always-have · Recently-added · Fridge ·
 * Freezer. The pantry is math, not inventory: no counts to keep, just what
 * arrived and roughly how long it lasts.
 */
export default function PantryScreen() {
  const router = useRouter();
  const items = usePantryStore((s) => s.items);
  const toggleStaple = usePantryStore((s) => s.toggleStaple);

  const last = useMemo(() => {
    if (items.length === 0) return null;
    const latest = items.reduce(
      (m, i) => (i.acquiredAt.getTime() > m.getTime() ? i.acquiredAt : m),
      items[0]!.acquiredAt,
    );
    const day = latest.toDateString();
    const count = items.filter((i) => i.acquiredAt.toDateString() === day).length;
    return { date: latest, count };
  }, [items]);

  const staples = items.filter((i) => i.isStaple);
  const loose = items.filter((i) => !i.isStaple);
  const recent = loose.filter((i) => isRecentlyAdded(i));
  const olderThanWindow = loose.filter((i) => !isRecentlyAdded(i));
  const fridge = olderThanWindow.filter((i) => i.location === 'fridge');
  const freezer = olderThanWindow.filter((i) => i.location === 'freezer');
  const shelf = olderThanWindow.filter((i) => i.location === 'pantry');

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <Heading variant="screenTitle">Pantry</Heading>
          <Text color="textMuted">{items.length} tracked</Text>
        </View>

        <Card style={styles.lastCard}>
          <View style={styles.flex}>
            <SectionLabel color="textMuted">Last Instacart</SectionLabel>
            <View style={styles.lastMeta}>
              {last ? (
                <>
                  <Text variant="recipeTitle">{shortDate(last.date)}</Text>
                  <Numeric color="textMuted">
                    {' '}
                    · {last.count} item{last.count === 1 ? '' : 's'}
                  </Numeric>
                </>
              ) : (
                <Text color="textMuted">No orders yet</Text>
              )}
            </View>
          </View>
          <Button
            label="Paste order"
            glyph="add"
            onPress={() => router.push('/pantry-paste')}
          />
        </Card>

        {staples.length > 0 ? (
          <Section label="Always have">
            {staples.map((it) => (
              <StapleRow key={it.id} item={it} />
            ))}
          </Section>
        ) : null}

        {recent.length > 0 ? (
          <Section label={`Recently added · ${recent.length}`}>
            {recent.map((it) => (
              <LooseRow key={it.id} item={it} onStaple={() => toggleStaple(it.id)} />
            ))}
          </Section>
        ) : null}

        {fridge.length > 0 ? (
          <Section label="Fridge">
            {fridge.map((it) => (
              <LooseRow key={it.id} item={it} onStaple={() => toggleStaple(it.id)} />
            ))}
          </Section>
        ) : null}

        {freezer.length > 0 ? (
          <Section label="Freezer">
            {freezer.map((it) => (
              <LooseRow key={it.id} item={it} onStaple={() => toggleStaple(it.id)} />
            ))}
          </Section>
        ) : null}

        {shelf.length > 0 ? (
          <Section label="Pantry shelf">
            {shelf.map((it) => (
              <LooseRow key={it.id} item={it} onStaple={() => toggleStaple(it.id)} />
            ))}
          </Section>
        ) : null}

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text color="textMuted">Nothing tracked yet.</Text>
            <Text color="textFaint">Paste an order to fill the pantry.</Text>
          </View>
        ) : null}
      </Screen>
    </View>
  );
}

/* ---------- staple row: cycle estimate, tap for history ---------- */
function StapleRow({ item }: { item: PantryItem }) {
  const [open, setOpen] = useState(false);
  const est = cycleEstimateDays(item.purchaseHistory);
  const stable = isCycleStable(item.purchaseHistory);
  const cycle = formatCycle(est);
  const expandable = !stable && item.purchaseHistory.length >= 3;

  const gaps = useMemo(() => {
    const sorted = [...item.purchaseHistory].sort((a, b) => a.getTime() - b.getTime());
    const out: { from: Date; to: Date; days: number }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      out.push({
        from: sorted[i - 1]!,
        to: sorted[i]!,
        days: Math.round((sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / 86_400_000),
      });
    }
    return out;
  }, [item.purchaseHistory]);

  return (
    <Pressable
      disabled={!expandable}
      onPress={() => setOpen((v) => !v)}
      style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text style={styles.flexShrink} numberOfLines={1}>
            {item.canonicalName}
          </Text>
          <Pill label="always" tone="ok" />
        </View>
        <View style={styles.subLine}>
          {cycle ? (
            <>
              <Numeric color="textMuted">{cycle} cycle</Numeric>
              {!stable ? (
                <Text color="textFaint" style={styles.stableNote}>
                  {' '}
                  · refining
                </Text>
              ) : null}
              {expandable ? (
                <Glyph
                  name="expand"
                  size={12}
                  color="textFaint"
                  style={styles.chev}
                />
              ) : null}
            </>
          ) : (
            <Text color="textFaint">building cycle</Text>
          )}
        </View>
      </View>

      {open && expandable ? (
        <View style={styles.history}>
          {gaps.map((g, i) => (
            <View key={i} style={styles.histRow}>
              <Text color="textMuted" style={styles.histText}>
                {shortDate(g.from)} → {shortDate(g.to)}
              </Text>
              <Numeric color="textFaint">{g.days}d</Numeric>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

/* ---------- loose row: acquired date + freshness warning ---------- */
function LooseRow({ item, onStaple }: { item: PantryItem; onStaple: () => void }) {
  const status = freshnessStatus(item);
  return (
    <Pressable onLongPress={onStaple} style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text style={styles.flexShrink} numberOfLines={1}>
            {item.canonicalName}
          </Text>
          {status === 'wilting' ? (
            <Pill label="wilting?" tone="warn" />
          ) : status === 'aging' ? (
            <Pill label="use soon" tone="muted" />
          ) : null}
        </View>
        <View style={styles.subLine}>
          <Numeric color="textFaint">added {shortDate(item.acquiredAt)}</Numeric>
        </View>
      </View>
    </Pressable>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionLabel style={styles.sectionLabel}>{label}</SectionLabel>
      <Card style={styles.sectionCard}>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 14,
  },
  lastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  lastMeta: { flexDirection: 'row', alignItems: 'baseline', paddingTop: 4 },
  section: { paddingTop: 18 },
  sectionLabel: { paddingBottom: 8 },
  sectionCard: { padding: 4, gap: 0 },
  row: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineSoft,
  },
  rowMain: { gap: 5 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subLine: { flexDirection: 'row', alignItems: 'center' },
  stableNote: { fontSize: 12, fontStyle: 'italic' },
  chev: { marginLeft: 6 },
  histText: { fontSize: 12 },
  history: {
    marginTop: 10,
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  histRow: { flexDirection: 'row', justifyContent: 'space-between' },
  empty: { paddingTop: 60, alignItems: 'center', gap: 6 },
});
