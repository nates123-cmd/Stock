import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
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
  categorizePantryItem,
  PANTRY_CATEGORY_ORDER,
  PANTRY_CATEGORY_LABEL,
  type PantryCategory,
} from '@/lib/pantryCategories';
import { useExtrasStore } from '@/store/extras';
import {
  cycleEstimateDays,
  formatCycle,
  freshnessStatus,
  isCycleStable,
  isRecentlyAdded,
  shortDate,
} from '@/lib/pantry';
import type { PantryItem, PantryLocation, PantryStatus } from '@/types';

/**
 * Pantry status pill (spec §10). The right-side affordance: 'fine' renders
 * nothing (clean default), 'low' a warn pill, 'out' an accent pill. Includes
 * the stale-out hint ('out · 30d+') once an out flag is 30+ days old.
 */
function StatusPill({ status, since }: { status: PantryStatus; since?: Date }) {
  if (!status || status === 'fine') return null;
  // `since` can arrive as an ISO string, not a Date, if it ever slips past the
  // sync revivers or sits in an already-persisted store — calling .getTime() on
  // a string blanked the whole Pantry screen (patch #1ef184bd). Coerce here so a
  // bad value degrades to "no stale hint" instead of crashing the render.
  const sinceMs = since ? new Date(since).getTime() : NaN;
  const isStale =
    status === 'out' &&
    !Number.isNaN(sinceMs) &&
    Date.now() - sinceMs > 30 * 86_400_000;
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
  const items = usePantryStore((s) => s.items);
  const toggleStaple = usePantryStore((s) => s.toggleStaple);
  const cycleStatus = usePantryStore((s) => s.cycleStatus);
  const setStatus = usePantryStore((s) => s.setStatus);
  const setCategory = usePantryStore((s) => s.setCategory);
  const removeItem = usePantryStore((s) => s.remove);
  const applyPaste = usePantryStore((s) => s.applyPaste);
  const addExtras = useExtrasStore((s) => s.add);
  const extras = useExtrasStore((s) => s.items);
  const [menu, setMenu] = useState<PantryItem | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [pushedToShop, setPushedToShop] = useState<number | null>(null);

  // Manual single-item add (spec §10 — was paste-only; this is the in-tab path).
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState('');
  const [addLocation, setAddLocation] = useState<PantryLocation>('pantry');
  const [addStaple, setAddStaple] = useState(false);
  const [addToast, setAddToast] = useState<string | null>(null);
  const openAdd = () => {
    setAddName('');
    setAddLocation('pantry');
    setAddStaple(false);
    setAdding(true);
  };
  const submitAdd = async () => {
    const name = addName.trim();
    if (!name) return;
    const res = await applyPaste([
      { canonicalName: name, location: addLocation, isStaple: addStaple },
    ]);
    setAdding(false);
    setAddToast(
      res.restocks > 0 ? `Restocked ${name}.` : `Added ${name} to the pantry.`,
    );
    setTimeout(() => setAddToast(null), 3500);
  };

  const openMenu = (it: PantryItem) => {
    setMenu(it);
    setNoteDraft(it.statusNote ?? '');
  };
  const closeMenu = () => {
    setMenu(null);
    setNoteDraft('');
  };

  // Cross-section running-low view (spec §10). Shows everything `low` or
  // `out` at the top of the pantry, sorted: out first, then low, alpha within.
  const lowOrOut = useMemo(() => {
    return items
      .filter((i) => i.status === 'low' || i.status === 'out')
      .sort((a, b) => {
        const ra = a.status === 'out' ? 0 : 1;
        const rb = b.status === 'out' ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return a.canonicalName.localeCompare(b.canonicalName);
      });
  }, [items]);

  const pushOutToShopping = () => {
    const outs = items.filter((i) => i.status === 'out');
    if (outs.length === 0) return;
    // De-dupe against extras already pushed from this pantry origin to keep
    // the shopping list quiet on repeat taps.
    const existing = new Set(
      extras.filter((e) => e.originId === 'pantry:running-low').map((e) => e.canonicalName.toLowerCase()),
    );
    const fresh = outs.filter((o) => !existing.has(o.canonicalName.toLowerCase()));
    if (fresh.length === 0) {
      setPushedToShop(0);
      setTimeout(() => setPushedToShop(null), 3000);
      return;
    }
    addExtras(
      fresh.map((o) => ({
        canonicalName: o.canonicalName,
        amount: null,
        unit: null,
        originLabel: 'from pantry: running low',
        originId: 'pantry:running-low',
      })),
    );
    setPushedToShop(fresh.length);
    setTimeout(() => setPushedToShop(null), 4000);
  };

  /**
   * Everything that ISN'T already surfaced in Running-low at the top, grouped by
   * shelf category. Two deliberate changes:
   *
   *  1. An item appears in exactly ONE place. A low/out staple used to show in
   *     Running-low AND again in its own section below (the pine-nuts duplicate).
   *     Running-low wins; it doesn't repeat underneath.
   *  2. Grouped by what the thing IS (oils, spices, baked goods…), not by where
   *     it's stored. Fridge/freezer/pantry lumped every shelf-stable item into
   *     one giant bucket.
   */
  const inLowOrOut = useMemo(
    () => new Set(lowOrOut.map((i) => i.id)),
    [lowOrOut],
  );
  const categorized = useMemo(() => {
    const rest = items.filter((i) => !inLowOrOut.has(i.id));
    const groups = new Map<PantryCategory, typeof rest>();
    for (const it of rest) {
      // A manual reassignment always beats the keyword guess.
      const cat = it.category ?? categorizePantryItem(it.canonicalName);
      const g = groups.get(cat);
      if (g) g.push(it);
      else groups.set(cat, [it]);
    }
    return PANTRY_CATEGORY_ORDER.filter((c) => (groups.get(c)?.length ?? 0) > 0).map(
      (c) => ({
        cat: c,
        label: PANTRY_CATEGORY_LABEL[c],
        items: sortByStatus(groups.get(c)!),
      }),
    );
  }, [items, inLowOrOut]);

  return (
    <View style={styles.root}>
      <Screen>
        <View style={styles.header}>
          <Heading variant="screenTitle">Pantry</Heading>
          <View style={styles.headerRight}>
            <Text color="textMuted">{items.length} tracked</Text>
            <Button label="Add" glyph="add" onPress={openAdd} />
          </View>
        </View>

        {addToast ? (
          <Text color="ok" style={styles.addToast}>
            {addToast}
          </Text>
        ) : null}

        {lowOrOut.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.runningLowHead}>
              <SectionLabel style={styles.sectionLabel} color="accent">
                Running low · {lowOrOut.length}
              </SectionLabel>
              {lowOrOut.some((i) => i.status === 'out') ? (
                <Pressable onPress={pushOutToShopping} hitSlop={6}>
                  <Text variant="bodyStrong" color="accent">
                    → Add out to shopping list
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {pushedToShop != null ? (
              <Text color={pushedToShop > 0 ? 'ok' : 'textFaint'} style={styles.pushHint}>
                {pushedToShop > 0
                  ? `Added ${pushedToShop} item${pushedToShop === 1 ? '' : 's'} to this week's shopping list (Extras).`
                  : 'Already staged on this run.'}
              </Text>
            ) : null}
            <Card style={styles.runningLowCard}>
              {lowOrOut.map((it) => (
                <LooseRow
                  key={`rl:${it.id}`}
                  item={it}
                  onCycle={() => cycleStatus(it.id)}
                  onMenu={() => openMenu(it)}
                />
              ))}
            </Card>
          </View>
        ) : null}

        {/* Grouped by what the thing IS. A staple is just a pantry item like any
            other now — it sits in its category, not in a separate "Always have"
            pile. Anything low/out is already up top and is NOT repeated here. */}
        {categorized.map((g) => (
          <Section key={g.cat} label={`${g.label} · ${g.items.length}`}>
            {g.items.map((it) => (
              <LooseRow
                key={it.id}
                item={it}
                onCycle={() => cycleStatus(it.id)}
                onMenu={() => openMenu(it)}
              />
            ))}
          </Section>
        ))}

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Text color="textMuted">Nothing tracked yet.</Text>
            <Text color="textFaint">Add an item to fill the pantry.</Text>
            <View style={styles.emptyActions}>
              <Button label="Add item" glyph="add" onPress={openAdd} />
            </View>
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

            {/* Manual reassignment. The keyword guess will never be right for
                everything (it once filed chamomile tea under Meat & fish), so
                every item can be moved by hand and the choice sticks. */}
            <View style={styles.noteWrap}>
              <SectionLabel color="textMuted">Category</SectionLabel>
              <View style={styles.catChips}>
                {PANTRY_CATEGORY_ORDER.map((c) => {
                  const active =
                    (menu.category ?? categorizePantryItem(menu.canonicalName)) === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={async () => {
                        await setCategory(menu.id, c);
                        closeMenu();
                      }}
                      style={[styles.catChip, active && styles.catChipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}>
                      <Text
                        variant="sectionLabel"
                        color={active ? 'bg' : 'textMuted'}>
                        {PANTRY_CATEGORY_LABEL[c]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
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

      <Overlay visible={adding} onClose={() => setAdding(false)}>
        <View style={styles.menu}>
          <Text variant="recipeTitle">Add to pantry</Text>
          <Text color="textFaint" style={styles.menuHint}>
            One item. If it matches something you already track, it merges in as a
            restock and refreshes the cycle estimate.
          </Text>

          <View style={styles.noteWrap}>
            <SectionLabel color="textMuted">Item</SectionLabel>
            <TextInput
              value={addName}
              onChangeText={setAddName}
              placeholder="e.g. olive oil"
              placeholderTextColor={colors.textFaint}
              style={styles.noteInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitAdd}
            />
          </View>

          <View style={styles.noteWrap}>
            <SectionLabel color="textMuted">Where</SectionLabel>
            <View style={styles.menuStatusRow}>
              {(['pantry', 'fridge', 'freezer'] as PantryLocation[]).map((loc) => {
                const active = addLocation === loc;
                return (
                  <Pressable
                    key={loc}
                    onPress={() => setAddLocation(loc)}
                    style={[
                      styles.menuStatusBtn,
                      active && styles.menuStatusBtnActive,
                    ]}>
                    <Text variant="bodyStrong" color={active ? 'bg' : 'text'}>
                      {loc === 'pantry' ? 'Shelf' : loc === 'fridge' ? 'Fridge' : 'Freezer'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            style={styles.menuItem}
            onPress={() => setAddStaple((v) => !v)}>
            <Text variant="bodyStrong">
              {addStaple ? '✓ Always-have' : 'Mark as always-have'}
            </Text>
            <Text color="textFaint" style={styles.menuItemHint}>
              Pins it to the Always-have section and tracks a restock cycle.
            </Text>
          </Pressable>

          <View style={styles.addActions}>
            <Pressable style={styles.menuCancel} onPress={() => setAdding(false)}>
              <Text color="textMuted">Cancel</Text>
            </Pressable>
            <Button
              label="Add"
              glyph="done"
              disabled={addName.trim().length === 0}
              onPress={submitAdd}
            />
          </View>
        </View>
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
          ) : (
            // Discoverability for the long-press note affordance — without
            // this, the only entry point was a hidden gesture (fix #5).
            <Pressable onPress={onMenu} hitSlop={6}>
              <Text color="textFaint" style={styles.addNoteHint}>
                {'  · + note'}
              </Text>
            </Pressable>
          )}
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addToast: { fontStyle: 'italic', paddingBottom: 8 },
  emptyActions: { paddingTop: 12 },
  addActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 16,
    paddingTop: 6,
  },
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
  addNoteHint: { fontSize: 12, fontStyle: 'italic' },
  runningLowHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  runningLowCard: { padding: 4, gap: 0, backgroundColor: colors.bg2 },
  pushHint: { fontSize: 12, fontStyle: 'italic', paddingBottom: 6 },
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
  catChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: colors.bg3,
  },
  catChipOn: { backgroundColor: colors.accent },
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
