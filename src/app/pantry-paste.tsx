import { useCallback, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Glyph,
  Card,
  Button,
  Pill,
  BottomActionBar,
  ProgressStepList,
  type ProgressStep,
} from '@/components';
import { colors, fonts, layout } from '@/design';
import { usePantryStore, type PasteInput } from '@/store/pantry';
import { useRecipeStore } from '@/store/recipes';
import { parseInstacartPaste, hasApiKey } from '@/lib/parsing';
import {
  categoryFor,
  tagAgainstPantry,
  recipeCoverage,
  canMakeNow,
  formatCycle,
  type PasteTag,
} from '@/lib/pantry';
import { formatAmount } from '@/lib/format';
import type { ShoppingCategory } from '@/types';

type Step = 'paste' | 'parsing' | 'review' | 'saved';

type ReviewItem = {
  key: string;
  canonicalName: string;
  amount?: number;
  unit?: string;
  original: string;
  tag: PasteTag;
  keep: boolean;
};

const CATEGORY_ORDER: ShoppingCategory[] = [
  'produce',
  'dairy',
  'meat',
  'bakery',
  'frozen',
  'pantry',
  'other',
];

const CATEGORY_LABEL: Record<ShoppingCategory, string> = {
  produce: 'Produce',
  dairy: 'Dairy',
  meat: 'Meat',
  bakery: 'Bakery',
  frozen: 'Frozen',
  pantry: 'Pantry',
  other: 'Other',
};

const TAG_TONE: Record<PasteTag, 'ok' | 'muted' | 'warn' | 'accent'> = {
  restock: 'ok',
  staple: 'muted',
  sub: 'warn',
  new: 'accent',
};

export default function PantryPasteFlow() {
  const router = useRouter();
  const pantry = usePantryStore((s) => s.items);
  const applyPaste = usePantryStore((s) => s.applyPaste);
  const recipes = useRecipeStore((s) => s.recipes);

  const [step, setStep] = useState<Step>('paste');
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<ReviewItem[]>([]);
  const [progress, setProgress] = useState<ProgressStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    added: number;
    restocks: number;
    cycle: { name: string; from?: number; to: number }[];
    unlocked: number;
    canMake: number;
  } | null>(null);
  const inputRef = useRef<TextInput>(null);

  const hasContent = raw.trim().length > 0;
  const close = () =>
    router.canGoBack() ? router.back() : router.replace('/pantry');

  const runParse = useCallback(async () => {
    setStep('parsing');
    setError(null);
    const seq: ProgressStep[] = [
      { label: 'Read the order', state: 'doing' },
      { label: 'De-branding & naming items', state: 'todo' },
      { label: 'Matching against your pantry', state: 'todo' },
      { label: 'Refreshing cycle estimates', state: 'todo' },
    ];
    setProgress(seq);
    const tick = (i: number, state: ProgressStep['state']) =>
      setProgress((p) => p.map((s, idx) => (idx === i ? { ...s, state } : s)));
    try {
      tick(0, 'done');
      tick(1, 'doing');
      const parsed = await parseInstacartPaste(raw);
      tick(1, 'done');
      tick(2, 'doing');
      if (parsed.length === 0) {
        setError('No items found in that text. Paste an order email or a list.');
        return;
      }
      const reviewed: ReviewItem[] = parsed.map((p, i) => ({
        key: `${i}_${p.value.canonicalName}`,
        canonicalName: p.value.canonicalName,
        amount: p.value.amount,
        unit: p.value.unit,
        original: p.value.originalInstacartText,
        tag: tagAgainstPantry(p.value.canonicalName, p.value.tag, pantry),
        keep: true,
      }));
      tick(2, 'done');
      tick(3, 'done');
      setRows(reviewed);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not parse that.');
    }
  }, [raw, pantry]);

  const save = async () => {
    const kept = rows.filter((r) => r.keep);
    const payload: PasteInput[] = kept.map((r) => ({
      canonicalName: r.canonicalName,
      amount: r.amount,
      unit: r.unit,
      originalInstacartText: r.original,
    }));
    const before = recipes.filter((rec) =>
      canMakeNow(recipeCoverage(rec.ingredients, pantry)),
    ).length;
    const res = await applyPaste(payload);
    const after = usePantryStore.getState().items;
    const canMake = recipes.filter((rec) =>
      canMakeNow(recipeCoverage(rec.ingredients, after)),
    ).length;
    setResult({
      added: res.added,
      restocks: res.restocks,
      cycle: res.cycleChanges.map((c) => ({
        name: c.name,
        from: c.fromDays,
        to: c.toDays,
      })),
      unlocked: Math.max(0, canMake - before),
      canMake,
    });
    setStep('saved');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {step === 'paste' && (
          <PasteStep
            raw={raw}
            setRaw={setRaw}
            inputRef={inputRef}
            hasContent={hasContent}
            recent={pantry.slice(0, 4).map((p) => p.canonicalName)}
            onCancel={close}
            onNext={runParse}
          />
        )}
        {step === 'parsing' && (
          <ParsingStep progress={progress} error={error} onRetry={() => setStep('paste')} />
        )}
        {step === 'review' && (
          <ReviewStep
            rows={rows}
            setRows={setRows}
            onCancel={() => setStep('paste')}
            onSave={save}
          />
        )}
        {step === 'saved' && result && (
          <SavedStep
            result={result}
            onView={() => {
              close();
            }}
            onAnother={() => {
              setRaw('');
              setRows([]);
              setResult(null);
              setStep('paste');
            }}
            onDone={close}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------- Step 1 + 2: paste / detected ---------- */
function PasteStep({
  raw,
  setRaw,
  inputRef,
  hasContent,
  recent,
  onCancel,
  onNext,
}: {
  raw: string;
  setRaw: (s: string) => void;
  inputRef: React.RefObject<TextInput | null>;
  hasContent: boolean;
  recent: string[];
  onCancel: () => void;
  onNext: () => void;
}) {
  const lineCount = raw.split(/\r?\n/).filter((l) => l.trim()).length;
  return (
    <>
      <View style={styles.modalHeader}>
        <Heading variant="screenTitle">Paste an order</Heading>
        <Pressable onPress={onCancel} hitSlop={8}>
          <Text variant="bodyStrong" color="textMuted">
            Cancel
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => inputRef.current?.focus()}>
          <View style={[styles.paste, hasContent && styles.pasteActive]}>
            {hasContent ? (
              <View style={styles.detectedRow}>
                <Glyph name="pantry" size={14} color="accent" />
                <Text variant="sectionLabel" color="accent">
                  {lineCount} line{lineCount === 1 ? '' : 's'} · ready
                </Text>
              </View>
            ) : null}
            <TextInput
              ref={inputRef}
              value={raw}
              onChangeText={setRaw}
              multiline
              placeholder="Paste here · order email, cart text, or just a list of items"
              placeholderTextColor={colors.textFaint}
              style={styles.pasteInput}
            />
          </View>
        </Pressable>

        {!hasApiKey() ? (
          <Text color="textFaint" style={styles.tip}>
            No Claude API key set — using the built-in parser. Add
            EXPO_PUBLIC_ANTHROPIC_API_KEY for sharper brand-stripping (spec
            §11.6/§14.2).
          </Text>
        ) : null}

        {recent.length > 0 ? (
          <View style={styles.recent}>
            <SectionLabel color="textMuted">Already tracked</SectionLabel>
            {recent.map((name) => (
              <Text key={name} color="textMuted" numberOfLines={1}>
                {name}
              </Text>
            ))}
          </View>
        ) : null}

        <Text color="textFaint" style={styles.tip}>
          Restocks merge into what you already have and refresh the cycle
          estimate. You never count anything.
        </Text>
      </ScrollView>

      <BottomActionBar>
        <Button label="Cancel" variant="secondary" flex onPress={onCancel} />
        <Button
          label="Next"
          glyph="next"
          flex
          disabled={!hasContent}
          onPress={onNext}
        />
      </BottomActionBar>
    </>
  );
}

/* ---------- Step 3: parsing ---------- */
function ParsingStep({
  progress,
  error,
  onRetry,
}: {
  progress: ProgressStep[];
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <View style={styles.bodyCentered}>
      <Heading variant="screenTitle" style={styles.center}>
        {error ? 'Could not read that' : 'Reading your order'}
      </Heading>
      {error ? (
        <>
          <Text color="warn" style={styles.parseNote}>
            {error}
          </Text>
          <Button label="Back" variant="secondary" onPress={onRetry} />
        </>
      ) : (
        <>
          <ProgressStepList steps={progress} />
          <Text color="textFaint" style={styles.parseNote}>
            Brands and pack sizes are best-guess. Review everything next.
          </Text>
        </>
      )}
    </View>
  );
}

/* ---------- Step 4: review ---------- */
function ReviewStep({
  rows,
  setRows,
  onCancel,
  onSave,
}: {
  rows: ReviewItem[];
  setRows: React.Dispatch<React.SetStateAction<ReviewItem[]>>;
  onCancel: () => void;
  onSave: () => void;
}) {
  const kept = rows.filter((r) => r.keep);
  const restocks = kept.filter((r) => r.tag === 'restock' || r.tag === 'staple').length;
  const toConfirm = rows.filter((r) => r.tag === 'sub').length;

  const grouped = useMemo(() => {
    const by = new Map<ShoppingCategory, ReviewItem[]>();
    for (const r of rows) {
      const c = categoryFor(r.canonicalName);
      (by.get(c) ?? by.set(c, []).get(c)!).push(r);
    }
    return CATEGORY_ORDER.filter((c) => by.has(c)).map(
      (c) => [c, by.get(c)!] as const,
    );
  }, [rows]);

  const setKeep = (key: string, keep: boolean) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, keep } : r)));

  return (
    <>
      <View style={styles.modalHeader}>
        <Heading variant="screenTitle">Review</Heading>
        <Text variant="bodyStrong" color="textMuted">
          {rows.length} parsed
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled">
        <View style={styles.tiles}>
          <Tile label="Items" value={kept.length} />
          <Tile label="Restocks" value={restocks} />
          <Tile label="To confirm" value={toConfirm} alert={toConfirm > 0} />
        </View>

        {grouped.map(([cat, list]) => (
          <View key={cat} style={styles.reviewSection}>
            <SectionLabel color="textMuted">
              {CATEGORY_LABEL[cat]} · {list.length}
            </SectionLabel>
            <Card style={styles.groupCard}>
              {list.map((r) => (
                <View key={r.key}>
                  <View style={[styles.itemRow, !r.keep && styles.itemDropped]}>
                    <View style={styles.itemMain}>
                      <Text numberOfLines={1}>{r.canonicalName}</Text>
                      <Text color="textFaint" style={styles.origText} numberOfLines={1}>
                        {r.original}
                      </Text>
                    </View>
                    <Numeric color="textMuted" style={styles.qty}>
                      {formatAmount(r.amount ?? null, r.unit ?? null) || '—'}
                    </Numeric>
                    <View style={styles.tagCell}>
                      <Pill label={r.tag} tone={TAG_TONE[r.tag]} />
                    </View>
                  </View>
                  {r.tag === 'sub' ? (
                    <View style={styles.subBlock}>
                      <Text color="warn" style={styles.subNote}>
                        Substituted by the store — keep it?
                      </Text>
                      <View style={styles.subActions}>
                        <Pressable onPress={() => setKeep(r.key, true)} hitSlop={6}>
                          <Text color={r.keep ? 'ok' : 'textFaint'} variant="bodyStrong">
                            Keep
                          </Text>
                        </Pressable>
                        <Pressable onPress={() => setKeep(r.key, false)} hitSlop={6}>
                          <Text color={!r.keep ? 'accent' : 'textFaint'} variant="bodyStrong">
                            Reject
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>

      <BottomActionBar>
        <Button label="Back" variant="secondary" flex onPress={onCancel} />
        <Button
          label={`Save ${kept.length} item${kept.length === 1 ? '' : 's'}`}
          glyph="done"
          flex
          disabled={kept.length === 0}
          onPress={onSave}
        />
      </BottomActionBar>
    </>
  );
}

function Tile({
  label,
  value,
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <Card tone="bg3" style={styles.tile}>
      <Numeric color={alert ? 'accent' : 'text'} style={styles.tileValue}>
        {value}
      </Numeric>
      <SectionLabel color="textMuted">{label}</SectionLabel>
    </Card>
  );
}

/* ---------- Step 5: saved ---------- */
function SavedStep({
  result,
  onView,
  onAnother,
  onDone,
}: {
  result: {
    added: number;
    restocks: number;
    cycle: { name: string; from?: number; to: number }[];
    unlocked: number;
    canMake: number;
  };
  onView: () => void;
  onAnother: () => void;
  onDone: () => void;
}) {
  return (
    <>
      <ScrollView contentContainerStyle={styles.bodyCentered}>
        <View style={styles.checkDisk}>
          <Glyph name="done" size={30} color="bg" />
        </View>
        <Heading variant="screenTitle">Pantry updated.</Heading>
        <Text color="textMuted" style={styles.center}>
          {result.added} added · {result.restocks} restock
          {result.restocks === 1 ? '' : 's'} merged · cycle estimates refreshed
        </Text>

        {result.cycle.length > 0 ? (
          <Card style={styles.cycleCard}>
            <SectionLabel color="textMuted">Cycle estimates</SectionLabel>
            {result.cycle.map((c) => (
              <View key={c.name} style={styles.cycleRow}>
                <Text numberOfLines={1} style={styles.flexShrink}>
                  {c.name}
                </Text>
                <Numeric color="ok">
                  {c.from ? `${formatCycle(c.from)} → ` : ''}
                  {formatCycle(c.to)}
                </Numeric>
              </View>
            ))}
          </Card>
        ) : null}

        <View style={styles.nextList}>
          <SectionLabel color="textMuted">What's next</SectionLabel>
          <Pressable style={styles.nextRow} onPress={onView}>
            <Text color="accent">
              Can make {result.canMake} recipe{result.canMake === 1 ? '' : 's'} now
              {result.unlocked > 0 ? ` · ${result.unlocked} newly unlocked` : ''}
            </Text>
            <Glyph name="next" size={15} color="accent" />
          </Pressable>
          <View style={styles.nextRow}>
            <Text color="textFaint">Pipeline ideas within reach — spec §8</Text>
          </View>
          <Pressable style={styles.nextRow} onPress={onView}>
            <Text color="accent">View pantry</Text>
            <Glyph name="next" size={15} color="accent" />
          </Pressable>
        </View>
      </ScrollView>

      <BottomActionBar>
        <Button label="Done" variant="secondary" flex onPress={onDone} />
        <Button label="Paste another" glyph="add" flex onPress={onAnother} />
      </BottomActionBar>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  center: { textAlign: 'center' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding,
    paddingTop: 14,
    paddingBottom: 12,
  },
  body: { paddingHorizontal: layout.screenPadding, paddingBottom: 28, gap: 16 },
  bodyCentered: {
    flexGrow: 1,
    paddingHorizontal: layout.screenPadding,
    paddingTop: 40,
    alignItems: 'center',
    gap: 18,
  },
  paste: {
    minHeight: 150,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderStyle: 'dashed',
    borderRadius: layout.cardRadius,
    backgroundColor: colors.bg2,
    padding: 14,
    gap: 8,
  },
  pasteActive: { borderColor: colors.accent, borderStyle: 'solid' },
  detectedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pasteInput: {
    flex: 1,
    minHeight: 110,
    fontSize: 15,
    color: colors.text,
    textAlignVertical: 'top',
  },
  tip: { fontStyle: 'italic', lineHeight: 19 },
  recent: { gap: 6, paddingTop: 6 },
  parseNote: { textAlign: 'center', fontStyle: 'italic', lineHeight: 20 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14 },
  tileValue: { fontSize: 20 },
  reviewSection: { gap: 8 },
  groupCard: { padding: 4, gap: 0 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineSoft,
  },
  itemDropped: { opacity: 0.4 },
  itemMain: { flex: 1, gap: 3 },
  origText: { fontFamily: fonts.mono, fontSize: 11.5 },
  qty: { minWidth: 52, textAlign: 'right' },
  tagCell: { width: 64, alignItems: 'flex-end' },
  subBlock: {
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.warn,
    borderRadius: 10,
    gap: 8,
  },
  subNote: { fontStyle: 'italic', fontSize: 12.5 },
  subActions: { flexDirection: 'row', gap: 22 },
  checkDisk: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleCard: { width: '100%', gap: 10 },
  cycleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  nextList: { width: '100%', gap: 12, paddingTop: 6 },
  nextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
