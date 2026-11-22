import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Text, Heading, Numeric, SectionLabel } from './Text';
import { Glyph } from './Glyph';
import { Button } from './Button';
import { AwakeIndicator } from './AwakeIndicator';
import { colors, layout } from '@/design';
import { useShopModeStore } from '@/store/shopMode';
import {
  groupBySection,
  locationForSection,
  SECTION_LABEL,
  SECTION_ORDER,
  sinkGot,
  type ShopSection,
} from '@/lib/shopSections';
import { PANTRY_LOCATION_LABEL, PANTRY_LOCATION_ORDER } from '@/lib/pantry';
import { STORES, type StoreId } from '@/lib/shopStores';
import type { PantryLocation, PantryStatus } from '@/types';

/** One row as shopping mode sees it — the list screen resolves these. */
export type ShopModeRow = {
  /** Stable row key (the list's own key). */
  key: string;
  name: string;
  /** Original name — what the pantry and the section memory are keyed on. */
  baseName: string;
  qty: string;
  recipes?: string[];
  /** From the Staples list (a low/out restock) rather than Active. */
  staple: boolean;
  status?: PantryStatus;
  store: StoreId | null;
  section: ShopSection;
};

type StoreFilter = 'all' | StoreId | 'none';

/**
 * Shopping mode: the list, reorganised for standing in a store.
 *
 * Deliberately a different surface from the list screen rather than another
 * toggle on it. The list is for BUILDING (edit, select, push, merge, swipe);
 * in a store every one of those gestures is a way to wreck the list with a
 * thumb. Here a row does exactly one thing — tap it when it is in the cart.
 *
 * Nothing is written to the list or the pantry until "Done shopping", so a
 * mis-tap costs one more tap, and backing out leaves everything as it was.
 */
export function ShoppingMode({
  rows,
  stapleRows,
  onClose,
  onFinish,
  onMoveSection,
}: {
  /** Active rows. */
  rows: ShopModeRow[];
  /** Low/out staples, shown only when the toggle is on. */
  stapleRows: ShopModeRow[];
  onClose: () => void;
  /**
   * Settle the trip for the rows that were got. `placements` maps row key →
   * pantry location; null means "just clear them, leave the pantry alone".
   */
  onFinish: (
    got: ShopModeRow[],
    placements: Record<string, PantryLocation> | null,
  ) => void | Promise<void>;
  /** Remember that this item lives in a different section. */
  onMoveSection: (row: ShopModeRow, section: ShopSection) => void;
}) {
  // A store is no place for the screen to sleep mid-aisle. Activated by hand
  // rather than with useKeepAwake(): a browser may refuse the wake lock (low
  // battery, no permission), and the hook lets that rejection go unhandled.
  // Refused just means the screen dims as usual — never a reason to fail.
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    const tag = 'stock-shopping-mode';
    let live = true;
    activateKeepAwakeAsync(tag)
      .then(() => live && setAwake(true))
      .catch(() => undefined);
    return () => {
      live = false;
      void deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, []);

  const gotMap = useShopModeStore((s) => s.got);
  const toggleGot = useShopModeStore((s) => s.toggleGot);
  const includeStaples = useShopModeStore((s) => s.includeStaples);
  const setIncludeStaples = useShopModeStore((s) => s.setIncludeStaples);

  const [store, setStore] = useState<StoreFilter>('all');
  const [stage, setStage] = useState<'shop' | 'done'>('shop');
  const [moving, setMoving] = useState<ShopModeRow | null>(null);
  /** Manual open/closed per section; absent = automatic (closed once done). */
  const [openOverride, setOpenOverride] = useState<Partial<Record<ShopSection, boolean>>>({});
  const [busy, setBusy] = useState(false);

  const all = useMemo(
    () => (includeStaples ? [...rows, ...stapleRows] : rows),
    [rows, stapleRows, includeStaples],
  );

  // Store chips only earn their row when the list is actually split across
  // stores; an untagged list would just show a pointless "All".
  const storesInUse = useMemo(() => {
    const ids = new Set(all.map((r) => r.store ?? 'none'));
    const out: { id: StoreFilter; label: string }[] = [];
    for (const s of STORES) if (ids.has(s.id)) out.push({ id: s.id, label: s.label });
    if (out.length > 0 && ids.has('none')) out.push({ id: 'none', label: 'No store' });
    return out;
  }, [all]);
  // A filter pointing at a store that has since emptied would show nothing.
  const activeStore: StoreFilter = storesInUse.some((s) => s.id === store) ? store : 'all';

  const visible = useMemo(
    () =>
      activeStore === 'all'
        ? all
        : all.filter((r) => (r.store ?? 'none') === activeStore),
    [all, activeStore],
  );

  const isGot = (r: ShopModeRow) => gotMap[r.key] === true;
  const groups = useMemo(
    () => groupBySection(visible, (r) => r.section),
    [visible],
  );
  // "Got" counts every row in play, not just the store filter — the trip total.
  const gotRows = all.filter(isGot);
  const leftCount = all.length - gotRows.length;

  /* ---------- done stage: where each thing goes ---------- */
  const [placeOverride, setPlaceOverride] = useState<Record<string, PantryLocation>>({});
  const placeFor = (r: ShopModeRow): PantryLocation =>
    placeOverride[r.key] ?? locationForSection(r.section);
  const cyclePlace = (r: ShopModeRow) => {
    const i = PANTRY_LOCATION_ORDER.indexOf(placeFor(r));
    const next = PANTRY_LOCATION_ORDER[(i + 1) % PANTRY_LOCATION_ORDER.length]!;
    setPlaceOverride((p) => ({ ...p, [r.key]: next }));
  };
  const finish = async (toPantry: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const placements = toPantry
        ? Object.fromEntries(gotRows.map((r) => [r.key, placeFor(r)]))
        : null;
      await onFinish(gotRows, placements);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Heading variant="screenTitle">
              {stage === 'shop' ? 'Shopping' : 'Done shopping'}
            </Heading>
            <View style={styles.headerMeta}>
              <Text color="textMuted">
                {stage === 'shop'
                  ? all.length === 0
                    ? 'Nothing to get'
                    : leftCount === 0
                      ? `All ${all.length} in the cart`
                      : `${leftCount} left · ${gotRows.length} in the cart`
                  : `${gotRows.length} item${gotRows.length === 1 ? '' : 's'} in the cart`}
              </Text>
              {stage === 'shop' && awake ? <AwakeIndicator /> : null}
            </View>
          </View>
          <Pressable
            onPress={stage === 'shop' ? onClose : () => setStage('shop')}
            hitSlop={10}
            accessibilityRole="button">
            <Text variant="bodyStrong" color="textMuted">
              {stage === 'shop' ? 'Exit' : 'Back'}
            </Text>
          </Pressable>
        </View>

        {stage === 'shop' ? (
          <>
            <ScrollView contentContainerStyle={styles.body}>
              <View style={styles.chips}>
                {storesInUse.length > 0 ? (
                  <>
                    <Chip label="All" on={activeStore === 'all'} onPress={() => setStore('all')} />
                    {storesInUse.map((s) => (
                      <Chip
                        key={s.id}
                        label={s.label}
                        on={activeStore === s.id}
                        onPress={() => setStore(s.id)}
                      />
                    ))}
                  </>
                ) : null}
                {stapleRows.length > 0 ? (
                  <Chip
                    label={`Low/out staples · ${stapleRows.length}`}
                    on={includeStaples}
                    onPress={() => setIncludeStaples(!includeStaples)}
                  />
                ) : null}
              </View>

              {visible.length === 0 ? (
                <Text color="textMuted" style={styles.empty}>
                  {all.length === 0
                    ? 'Your list is empty. Build one from the plan, or add items on the list.'
                    : 'Nothing for this store.'}
                </Text>
              ) : null}

              {groups.map((g) => {
                const left = g.rows.filter((r) => !isGot(r)).length;
                const open = openOverride[g.section] ?? left > 0;
                return (
                  <View key={g.section} style={styles.section}>
                    <Pressable
                      style={styles.sectionHead}
                      onPress={() =>
                        setOpenOverride((p) => ({ ...p, [g.section]: !open }))
                      }
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`${g.label}, ${left === 0 ? 'done' : `${left} left`}`}>
                      <SectionLabel color={left === 0 ? 'textFaint' : 'text'}>
                        {g.label}
                      </SectionLabel>
                      <SectionLabel color={left === 0 ? 'ok' : 'textMuted'}>
                        {left === 0 ? 'Done' : `${left} left`}
                      </SectionLabel>
                    </Pressable>
                    {open
                      ? sinkGot(g.rows, isGot).map((r) => (
                          <Row
                            key={r.key}
                            row={r}
                            got={isGot(r)}
                            onToggle={() => toggleGot(r.key)}
                            onLongPress={() => setMoving(r)}
                          />
                        ))
                      : null}
                  </View>
                );
              })}

              {visible.length > 0 ? (
                <Text color="textFaint" style={styles.hint}>
                  Tap an item when it is in the cart. Hold one to move it to a different
                  section.
                </Text>
              ) : null}
            </ScrollView>

            <View style={styles.bar}>
              {gotRows.length > 0 ? (
                <Button
                  label={`Done shopping · ${gotRows.length}`}
                  glyph="done"
                  flex
                  onPress={() => setStage('done')}
                />
              ) : (
                <Button label="Exit" variant="secondary" flex onPress={onClose} />
              )}
            </View>
          </>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.body}>
              <Text color="textMuted" style={styles.doneIntro}>
                These come off the list. Add them to your pantry so the next shopping list
                knows you have them. Tap a location to change it.
              </Text>
              {gotRows.map((r) => (
                <View key={r.key} style={styles.doneRow}>
                  <Text style={styles.flex} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Pressable
                    onPress={() => cyclePlace(r)}
                    hitSlop={6}
                    style={styles.placePill}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.name} goes in ${PANTRY_LOCATION_LABEL[placeFor(r)]}. Tap to change.`}>
                    <Text variant="sectionLabel" color="text">
                      {PANTRY_LOCATION_LABEL[placeFor(r)]}
                    </Text>
                  </Pressable>
                </View>
              ))}
              {leftCount > 0 ? (
                <Text color="textFaint" style={styles.hint}>
                  {leftCount} item{leftCount === 1 ? '' : 's'} you did not get stay
                  {leftCount === 1 ? 's' : ''} on your list.
                </Text>
              ) : null}
            </ScrollView>
            <View style={[styles.bar, styles.barStack]}>
              <Button
                label={`Add ${gotRows.length} to pantry`}
                glyph="done"
                disabled={busy}
                onPress={() => void finish(true)}
              />
              <Button
                label="Just clear them"
                variant="secondary"
                disabled={busy}
                onPress={() => void finish(false)}
              />
            </View>
          </>
        )}

        {/* Move-to-section sheet. Drawn inside this Modal rather than through
            <Overlay> (itself a Modal) so it cannot end up underneath. */}
        {moving ? (
          <View style={StyleSheet.absoluteFill}>
            <Pressable
              style={styles.backdrop}
              onPress={() => setMoving(null)}
              accessibilityRole="button"
              accessibilityLabel="Close"
            />
            <View style={styles.sheet}>
              <Text variant="bodyStrong" numberOfLines={1}>
                Where is {moving.name}?
              </Text>
              <Text color="textFaint" style={styles.sheetHint}>
                Remembered for next time.
              </Text>
              <View style={styles.sheetChips}>
                {SECTION_ORDER.map((s) => (
                  <Chip
                    key={s}
                    label={SECTION_LABEL[s]}
                    on={moving.section === s}
                    onPress={() => {
                      onMoveSection(moving, s);
                      setMoving(null);
                    }}
                  />
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}>
      <Text variant="sectionLabel" color={on ? 'bg' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  row,
  got,
  onToggle,
  onLongPress,
}: {
  row: ShopModeRow;
  got: boolean;
  onToggle: () => void;
  onLongPress: () => void;
}) {
  const sub = [
    // Only claim low/out when the pantry says so — a staple added by hand has
    // no status at all.
    row.status === 'out' ? 'out at home' : row.status === 'low' ? 'running low' : row.staple ? 'staple' : null,
    row.recipes?.length ? `for ${row.recipes.join(' · ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={onToggle}
      onLongPress={onLongPress}
      delayLongPress={450}
      // @ts-expect-error web-only: stop iOS hijacking the long-press
      style={[styles.row, { userSelect: 'none', WebkitTouchCallout: 'none' }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: got }}
      accessibilityLabel={`${row.name}${row.qty ? `, ${row.qty}` : ''}`}>
      <View style={[styles.check, got && styles.checkOn]}>
        {got ? <Glyph name="done" size={14} color="bg" /> : null}
      </View>
      <View style={styles.flex}>
        <Text
          variant="bodyStrong"
          color={got ? 'textFaint' : 'text'}
          style={got ? styles.struck : undefined}
          numberOfLines={2}>
          {row.name}
        </Text>
        {sub && !got ? (
          <Text variant="sectionLabel" color="textFaint" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {/* "some" is the list's placeholder for no quantity; in a store it is noise. */}
      {row.qty && row.qty !== 'some' ? (
        <Numeric color={got ? 'textFaint' : 'textMuted'} style={styles.qty} numberOfLines={2}>
          {row.qty}
        </Numeric>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 12,
  },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { paddingHorizontal: layout.screenPadding, paddingBottom: 30, gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  empty: { textAlign: 'center', fontStyle: 'italic', paddingVertical: 32 },
  section: { paddingTop: 10 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 58,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.textFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.ok, borderColor: colors.ok },
  struck: { textDecorationLine: 'line-through' },
  qty: { maxWidth: 110, textAlign: 'right' },
  hint: { paddingTop: 18, lineHeight: 18, fontStyle: 'italic' },
  bar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
  },
  barStack: { flexDirection: 'column' },
  doneIntro: { lineHeight: 20, paddingBottom: 6 },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  placePill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.bg3,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(18,33,49,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: layout.screenPadding,
    paddingBottom: 28,
    gap: 4,
  },
  sheetHint: { paddingBottom: 10 },
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

export default ShoppingMode;
