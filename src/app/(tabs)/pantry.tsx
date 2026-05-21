import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
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
  Overlay,
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
import type { PantryItem, PantryStatus } from '@/types';

/**
 * Pantry status pill (spec §10). The right-side affordance: 'fine' renders
 * nothing (clean default), 'low' a warn pill, 'out' an accent pill. Includes
 * the stale-out hint ('out · 30d+') once an out flag is 30+ days old.
 */
function StatusPill({ status, since }: { status: PantryStatus; since?: Date }) {
  if (!status || status === 'fine') return null;
  const isStale =
    status === 'out' &&
    since &&
    Date.now() - since.getTime() > 30 * 86_400_000;
  return (
    <View style={[statusStyles.pill, status === 'out' ? statusStyles.out : statusStyles.low]}>
      <Text
        variant="sectionLabel"
        color={status === 'out' ? 'accent' : 'warn'}
        style={statusStyles.label}>
        {status}{isStale ? ' · 30d+' : ''}
      </Text>
    </View>
  );
}

const statusStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: colors.bg3,
  },
  out: {},
  low: {},
  label: { letterSpacing: 0.6 },
});

const STATUS_RANK: Record<PantryStatus, number> = { out: 0, low: 1, fine: 2 };
function sortByStatus(items: PantryItem[]): PantryItem[] {
  return [...items].sort((a, b) => {
    const ra = STATUS_RANK[a.status ?? 'fine'];
    const rb = STATUS_RANK[b.status ?? 'fine'];
    if (ra !== rb) return ra - rb;
    return a.canonicalName.localeCompare(b.canonicalName);
  });
}

/**
 * Pantry list (spec §10). Sectioned by Always-have · Recently-added · Fridge ·
 * Freezer. The pantry is math, not inventory: no counts to keep, just what
 * arrived and roughly how long it lasts.
 */
export default function PantryScreen() {
  const router = useRouter();
  const items = usePantryStore((s) => s.items);
  const toggleStaple = usePantryStore((s) => s.toggleStaple);
  const cycleStatus = usePantryStore((s) => s.cycleStatus);
  const setStatus = usePantryStore((s) => s.setStatus);
  const removeItem = usePantryStore((s) => s.remove);
  const [menu, setMenu] = useState<PantryItem | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const openMenu = (it: PantryItem) => {
    setMenu(it);
    setNoteDraft(it.statusNote ?? '');
  };
  const closeMenu = () => {
    setMenu(null);
    setNoteDraft('');
  };

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

  // Within each section, sort by status descending (out → low → fine) so the
  // actionable items land at the top (spec §10).
  const staples = sortByStatus(items.filter((i) => i.isStaple));
  const loose = items.filter((i) => !i.isStaple);
  const recent = sortByStatus(loose.filter((i) => isRecentlyAdded(i)));
  const olderThanWindow = loose.filter((i) => !isRecentlyAdded(i));
  const fridge = sortByStatus(olderThanWindow.filter((i) => i.location === 'fridge'));
  const freezer = sortByStatus(olderThanWindow.filter((i) => i.location === 'freezer'));
  const shelf = sortByStatus(olderThanWindow.filter((i) => i.location === 'pantry'));

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
              <StapleRow
                key={it.id}
                item={it}
                onCycle={() => cycleStatus(it.id)}
                onMenu={() => openMenu(it)}
              />
            ))}
          </Section>
        ) : null}

        {recent.length > 0 ? (
          <Section label={`Recently added · ${recent.length}`}>
            {recent.map((it) => (
              <LooseRow
                key={it.id}
                item={it}
                onCycle={() => cycleStatus(it.id)}
                onMenu={() => openMenu(it)}
              />
            ))}
          </Section>
        ) : null}

        {fridge.length > 0 ? (
          <Section label="Fridge">
            {fridge.map((it) => (
              <LooseRow
                key={it.id}
                item={it}
                onCycle={() => cycleStatus(it.id)}
                onMenu={() => openMenu(it)}
              />
            ))}
          </Section>
        ) : null}

        {freezer.length > 0 ? (
          <Section label="Freezer">
            {freezer.map((it) => (
              <LooseRow
                key={it.id}
                item={it}
                onCycle={() => cycleStatus(it.id)}
                onMenu={() => openMenu(it)}
              />
            ))}
          </Section>
        ) : null}

        {shelf.length > 0 ? (
          <Section label="Pantry shelf">
            {shelf.map((it) => (
              <LooseRow
                key={it.id}
                item={it}
                onCycle={() => cycleStatus(it.id)}
                onMenu={() => openMenu(it)}
              />
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

      <Overlay visible={menu != null} onClose={closeMenu}>
        {menu ? (
          <View style={styles.menu}>
            <Text variant="recipeTitle" numberOfLines={1}>
              {menu.canonicalName}
            </Text>
            <Text color="textFaint" style={styles.menuHint}>
              Tap the row to cycle status (fine → low → out → fine). Use this
              menu for direct selection, notes, or to manage the item.
            </Text>

            <View style={styles.menuStatusRow}>
              {(['fine', 'low', 'out'] as PantryStatus[]).map((s) => {
                const active = (menu.status ?? 'fine') === s;
                return (
                  <Pressable
                    key={s}
                    onPress={async () => {
                      await setStatus(menu.id, s, noteDraft);
                      closeMenu();
                    }}
                    style={[
                      styles.menuStatusBtn,
                      active && styles.menuStatusBtnActive,
                    ]}>
                    <Text
                      variant="bodyStrong"
                      color={active ? 'bg' : 'text'}>
                      {s === 'fine' ? 'Fine' : s === 'low' ? 'Running low' : 'Out'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.noteWrap}>
              <SectionLabel color="textMuted">Note</SectionLabel>
              <TextInput
                value={noteDraft}
                onChangeText={setNoteDraft}
                placeholder="brand: Maldon · almost gone · etc."
                placeholderTextColor={colors.textFaint}
                style={styles.noteInput}
                multiline
                onBlur={async () => {
                  if (noteDraft !== (menu.statusNote ?? '')) {
                    await setStatus(menu.id, menu.status ?? 'fine', noteDraft);
                  }
                }}
              />
            </View>

            <Pressable
              style={styles.menuItem}
              onPress={async () => {
                await toggleStaple(menu.id);
                closeMenu();
              }}>
              <Text variant="bodyStrong">
                {menu.isStaple ? 'Remove always-have' : 'Mark as always-have'}
              </Text>
              <Text color="textFaint" style={styles.menuItemHint}>
                {menu.isStaple
                  ? 'Treats this as a normal pantry item.'
                  : 'Pin to the Always-have section.'}
              </Text>
            </Pressable>

            <Pressable
              style={styles.menuItem}
              onPress={async () => {
                await removeItem(menu.id);
                closeMenu();
              }}>
              <Text variant="bodyStrong" color="accent">
                Remove from pantry
              </Text>
              <Text color="textFaint" style={styles.menuItemHint}>
                Forgets this item entirely (purchase history, cycle, status).
              </Text>
            </Pressable>

            <Pressable style={styles.menuCancel} onPress={closeMenu}>
              <Text color="textMuted">Cancel</Text>
            </Pressable>
          </View>
        ) : null}
      </Overlay>
    </View>
  );
}

/* ---------- staple row: cycle estimate; tap = status cycle; long-press = menu ---------- */
function StapleRow({
  item,
  onCycle,
  onMenu,
}: {
  item: PantryItem;
  onCycle: () => void;
  onMenu: () => void;
}) {
  const [open, setOpen] = useState(false);
  const est = cycleEstimateDays(item.purchaseHistory);
  const stable = isCycleStable(item.purchaseHistory);
  const cycle = formatCycle(est);
  const expandable = !stable && item.purchaseHistory.length >= 3;
  const status = item.status ?? 'fine';

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
    <Pressable onPress={onCycle} onLongPress={onMenu} delayLongPress={350} style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text style={styles.flexShrink} numberOfLines={1}>
            {item.canonicalName}
          </Text>
          <Pill label="always" tone="ok" />
          <View style={styles.rightPill}>
            <StatusPill status={status} since={item.statusUpdatedAt} />
          </View>
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
                <Pressable
                  onPress={() => setOpen((v) => !v)}
                  hitSlop={8}
                  accessibilityLabel="Show purchase history">
                  <Glyph
                    name="expand"
                    size={12}
                    color="textFaint"
                    style={styles.chev}
                  />
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text color="textFaint">building cycle</Text>
          )}
          {item.statusNote ? (
            <Text color="textFaint" style={styles.statusNote}>
              {' · '}
              {item.statusNote}
            </Text>
          ) : null}
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

/* ---------- loose row: tap = status cycle; long-press = menu ---------- */
function LooseRow({
  item,
  onCycle,
  onMenu,
}: {
  item: PantryItem;
  onCycle: () => void;
  onMenu: () => void;
}) {
  const fresh = freshnessStatus(item);
  const status = item.status ?? 'fine';
  return (
    <Pressable onPress={onCycle} onLongPress={onMenu} delayLongPress={350} style={styles.row}>
      <View style={styles.rowMain}>
        <View style={styles.nameLine}>
          <Text style={styles.flexShrink} numberOfLines={1}>
            {item.canonicalName}
          </Text>
          {fresh === 'wilting' ? (
            <Pill label="wilting?" tone="warn" />
          ) : fresh === 'aging' ? (
            <Pill label="use soon" tone="muted" />
          ) : null}
          <View style={styles.rightPill}>
            <StatusPill status={status} since={item.statusUpdatedAt} />
          </View>
        </View>
        <View style={styles.subLine}>
          <Numeric color="textFaint">added {shortDate(item.acquiredAt)}</Numeric>
          {item.statusNote ? (
            <Text color="textFaint" style={styles.statusNote}>
              {' · '}
              {item.statusNote}
            </Text>
          ) : null}
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
  rightPill: { marginLeft: 'auto' },
  statusNote: { fontSize: 12, fontStyle: 'italic' },
  menu: { gap: 10, paddingTop: 4 },
  menuHint: { fontStyle: 'italic', lineHeight: 18, paddingBottom: 6 },
  menuStatusRow: { flexDirection: 'row', gap: 8 },
  menuStatusBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg2,
    alignItems: 'center',
  },
  menuStatusBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  noteWrap: { gap: 6, paddingTop: 6 },
  noteInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.bg2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  menuItem: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: 2,
  },
  menuItemHint: { fontSize: 12, fontStyle: 'italic' },
  menuCancel: {
    paddingTop: 14,
    paddingBottom: 2,
    alignItems: 'center',
  },
});
