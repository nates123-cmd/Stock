import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Text,
  Heading,
  Numeric,
  SectionLabel,
  Card,
  Button,
  Screen,
} from '@/components';
import { colors, fonts, glyph, layout } from '@/design';
import {
  convertToGrams,
  findSubstitutes,
  localGramsFromUnit,
  localParseRecipe,
  type Substitute,
} from '@/lib/parsing';

type BenchTab = 'convert' | 'sub';

/** One converted line: grams known (or null for counted/to-taste), with the
 *  baker's-% computed against detected flour (spec §9). */
type ConvertRow = {
  name: string;
  /** unscaled grams — null when the amount is a count / to-taste / unitless */
  grams: number | null;
  /** % of flour weight; only set when the recipe contains flour */
  bakersPercent?: number;
};

/**
 * Gram weight for amounts already in a mass unit — no Claude needed. Backed by
 * convert-units (parsing/units.ts), so it now also handles oz/lb locally, not
 * just g/kg/mg; volume units (cup, tbsp…) return null and still go to Claude
 * for a density estimate.
 */
function localGrams(amount: number | null, unit: string | null): number | null {
  return localGramsFromUnit(amount, unit);
}

/** Bench (workbench) — Convert recipe amounts to grams + baker's %, and look
 *  up ranked ingredient substitutes (spec §9, §11.4–5). */
export default function BenchScreen() {
  const params = useLocalSearchParams<{
    tab?: BenchTab;
    text?: string; // Convert: pre-load ingredient lines (launched from a recipe)
    sub?: string; // Sub: ingredient name to pre-load
    amount?: string; // Sub: amount value
    unit?: string; // Sub: amount unit
  }>();

  const [tab, setTab] = useState<BenchTab>(params.tab === 'sub' ? 'sub' : 'convert');

  // The Bench tab stays mounted, so a fresh long-press from a recipe (or any
  // new deep-link params) must re-drive the tab choice. Depend on the payload
  // params too, so re-launching with a *different* ingredient still switches
  // to Sub even when params.tab is unchanged.
  useEffect(() => {
    if (params.tab === 'sub' || params.sub) setTab('sub');
    else if (params.tab === 'convert' || params.text) setTab('convert');
  }, [params.tab, params.sub, params.text]);

  return (
    <Screen>
      <View style={styles.header}>
        <Heading variant="wordmark">Stock</Heading>
        <SectionLabel>Workbench</SectionLabel>
      </View>

      <View style={styles.tabs}>
        <TabButton label="Convert" active={tab === 'convert'} onPress={() => setTab('convert')} />
        <TabButton label="Sub" active={tab === 'sub'} onPress={() => setTab('sub')} />
      </View>

      {tab === 'convert' ? (
        // key re-seeds the paste box from new params (state init runs once).
        <ConvertTool key={`convert:${params.text ?? ''}`} initialText={params.text ?? ''} />
      ) : (
        // key re-seeds the inputs each time a recipe long-press hands off new
        // ingredient params — without it the once-only useState keeps the old
        // (empty) values and the row never fills.
        <SubTool
          key={`sub:${params.sub ?? ''}:${params.amount ?? ''}:${params.unit ?? ''}`}
          initialName={params.sub ?? ''}
          initialAmount={params.amount ?? ''}
          initialUnit={params.unit ?? 'cup'}
        />
      )}
    </Screen>
  );
}

function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
      accessibilityRole="button">
      <Text variant="bodyStrong" color={active ? 'bg' : 'textMuted'}>
        {label}
      </Text>
    </Pressable>
  );
}

/* ─────────────────────────── Convert ─────────────────────────── */

function ConvertTool({ initialText }: { initialText: string }) {
  const router = useRouter();
  const [paste, setPaste] = useState(initialText);
  const [rows, setRows] = useState<ConvertRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scale controls — both override each other (spec §9). `source` records which
  // input the user last touched so the other one stays a derived hint.
  const [scaleX, setScaleX] = useState('');
  const [targetG, setTargetG] = useState('');
  const [source, setSource] = useState<'x' | 'target' | null>(null);
  /** Pivot row for "target grams" — tap any output row to scale off it. Null =
   *  default (flour total, else first weighed row). */
  const [pivotIdx, setPivotIdx] = useState<number | null>(null);

  const hasFlour = rows?.some((r) => r.bakersPercent != null) ?? false;
  /** Reference weight for "target grams": the pinned row, else flour, else first. */
  const refGrams = useMemo(() => {
    if (!rows) return null;
    if (pivotIdx != null && rows[pivotIdx]?.grams != null) return rows[pivotIdx]!.grams;
    const flour = rows.find((r) => r.bakersPercent != null && r.grams != null);
    if (flour) return flour.grams;
    return rows.find((r) => r.grams != null)?.grams ?? null;
  }, [rows, pivotIdx]);
  const refLabel =
    pivotIdx != null && rows?.[pivotIdx] ? rows[pivotIdx]!.name : hasFlour ? 'flour' : 'base';

  const multiplier = useMemo(() => {
    if (source === 'x') {
      const n = parseFloat(scaleX);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }
    if (source === 'target' && refGrams) {
      const t = parseFloat(targetG);
      return Number.isFinite(t) && t > 0 ? t / refGrams : 1;
    }
    return 1;
  }, [source, scaleX, targetG, refGrams]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const draft = localParseRecipe(paste, 'Converted recipe');
      const ings = draft.ingredients ?? [];
      if (ings.length === 0) {
        throw new Error('No ingredients found — paste an ingredient list (one per line).');
      }
      // Grams we can do locally (already mass units); the rest go to Claude.
      const baseGrams = new Map<string, number>();
      for (const ing of ings) {
        const g = localGrams(ing.amount, ing.unit);
        if (g != null) baseGrams.set(ing.id, g);
      }
      const needClaude = ings.filter((i) => !baseGrams.has(i.id));
      if (needClaude.length > 0) {
        const converted = await convertToGrams(needClaude);
        for (const c of converted) baseGrams.set(c.id, c.grams);
      }

      const flourGrams = ings.reduce((sum, ing) => {
        const g = baseGrams.get(ing.id);
        return g != null && (ing.canonicalName ?? '').includes('flour') ? sum + g : sum;
      }, 0);

      const next: ConvertRow[] = ings.map((ing) => {
        const grams = baseGrams.get(ing.id) ?? null;
        return {
          name: ing.canonicalName || ing.originalText || 'ingredient',
          grams,
          bakersPercent:
            flourGrams > 0 && grams != null
              ? Math.round((grams / flourGrams) * 1000) / 10
              : undefined,
        };
      });
      setRows(next);
      setScaleX('');
      setTargetG('');
      setSource(null);
      setPivotIdx(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveAsRecipe = () => {
    if (!rows) return;
    const lines = rows.map((r) =>
      r.grams != null ? `${Math.round(r.grams * multiplier)} g ${r.name}` : r.name,
    );
    router.push({ pathname: '/capture', params: { prefillText: lines.join('\n') } });
  };

  return (
    <View style={styles.body}>
      <SectionLabel>Paste recipe text</SectionLabel>
      <TextInput
        value={paste}
        onChangeText={setPaste}
        multiline
        placeholder={'2 cups flour\n1 stick butter\n1 cup sugar'}
        placeholderTextColor={colors.textFaint}
        style={styles.paste}
      />

      {/* Scale row — target weight OR ×N, each overrides the other (spec §9). */}
      <View style={styles.scaleRow}>
        <View style={styles.scaleField}>
          <SectionLabel>Target</SectionLabel>
          <View style={styles.scaleInputWrap}>
            <TextInput
              value={source === 'x' ? '' : targetG}
              onChangeText={(t) => {
                setTargetG(t);
                setSource('target');
              }}
              keyboardType="numeric"
              editable={refGrams != null}
              placeholder={refGrams != null ? String(refGrams) : '—'}
              placeholderTextColor={colors.textFaint}
              style={styles.scaleInput}
            />
            <Text color="textMuted" numberOfLines={1} style={styles.refLabel}>
              g {refLabel}
            </Text>
          </View>
        </View>
        <Text color="textFaint" style={styles.scaleOr}>
          or
        </Text>
        <View style={styles.scaleField}>
          <SectionLabel>Scale</SectionLabel>
          <View style={styles.scaleInputWrap}>
            <TextInput
              value={source === 'target' ? '' : scaleX}
              onChangeText={(t) => {
                setScaleX(t);
                setSource('x');
              }}
              keyboardType="numeric"
              placeholder="1"
              placeholderTextColor={colors.textFaint}
              style={styles.scaleInput}
            />
            <Text color="textMuted">×</Text>
          </View>
        </View>
      </View>

      <Button
        label={busy ? 'Converting…' : 'Convert'}
        glyph="bench"
        disabled={busy || paste.trim().length === 0}
        onPress={run}
      />

      {error ? (
        <Text color="accent" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {rows ? (
        <Card bordered tone="bg2" style={styles.output}>
          <View style={styles.outputHead}>
            <SectionLabel color="accent">
              Converted{hasFlour ? " · baker's %" : ''}
            </SectionLabel>
            {multiplier !== 1 ? (
              <Numeric color="textMuted">×{Math.round(multiplier * 100) / 100}</Numeric>
            ) : null}
          </View>
          <Text color="textFaint" style={styles.pivotHint}>
            Tap a row to scale off it — set how much you have in Target.
          </Text>
          {rows.map((r, i) => {
            const isPivot = pivotIdx === i;
            return (
              <Pressable
                key={`${r.name}-${i}`}
                disabled={r.grams == null}
                onPress={() => {
                  setPivotIdx(i);
                  setScaleX('');
                  setSource('target');
                }}
                style={[styles.outRow, isPivot && styles.outRowPivot]}>
                <Numeric color="accent" style={styles.outGrams}>
                  {r.grams != null ? `${Math.round(r.grams * multiplier)} g` : '—'}
                </Numeric>
                <Numeric color="textMuted" style={styles.outPct}>
                  {r.bakersPercent != null ? `${r.bakersPercent}%` : ''}
                </Numeric>
                <Text style={styles.outName} numberOfLines={1}>
                  {isPivot ? '📌 ' : ''}{r.name}
                </Text>
              </Pressable>
            );
          })}
          <View style={styles.outActions}>
            <Button label="Save as recipe" glyph="add" flex onPress={saveAsRecipe} />
            <Button label="Edit" variant="secondary" flex onPress={() => setRows(null)} />
          </View>
        </Card>
      ) : null}
    </View>
  );
}

/* ───────────────────────────── Sub ───────────────────────────── */

const RANK_COLOR = ['accent', 'accentSoft', 'textMuted'] as const;

function SubTool({
  initialName,
  initialAmount,
  initialUnit,
}: {
  initialName: string;
  initialAmount: string;
  initialUnit: string;
}) {
  const [name, setName] = useState(initialName);
  const [amount, setAmount] = useState(initialAmount);
  const [unit, setUnit] = useState(initialUnit);
  const [subs, setSubs] = useState<Substitute[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const value = parseFloat(amount);
      const result = await findSubstitutes(name, {
        value: Number.isFinite(value) && value > 0 ? value : 1,
        unit: unit.trim() || 'cup',
      });
      if (result.length === 0) throw new Error('No substitutes came back — try again.');
      setSubs(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Substitution lookup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.body}>
      <SectionLabel>Ingredient</SectionLabel>
      <View style={styles.subInputs}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="buttermilk"
          placeholderTextColor={colors.textFaint}
          style={[styles.subInput, styles.subName]}
        />
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="1"
          placeholderTextColor={colors.textFaint}
          style={[styles.subInput, styles.subAmt]}
        />
        <TextInput
          value={unit}
          onChangeText={setUnit}
          placeholder="cup"
          placeholderTextColor={colors.textFaint}
          style={[styles.subInput, styles.subUnit]}
        />
      </View>

      <Button
        label={busy ? 'Finding…' : 'Find substitutes'}
        glyph="bench"
        disabled={busy || name.trim().length === 0}
        onPress={run}
      />

      {error ? (
        <Text color="accent" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {subs ? (
        <View style={styles.subList}>
          {subs.map((s) => (
            <Card key={s.rank} bordered style={styles.subCard}>
              <View style={styles.subRow}>
                <View
                  style={[
                    styles.rankBadge,
                    { backgroundColor: colors[RANK_COLOR[s.rank - 1] ?? 'textMuted'] },
                  ]}>
                  <Numeric color="bg" style={styles.rankNum}>
                    {s.rank}
                  </Numeric>
                </View>
                <View style={styles.subText}>
                  <Heading variant="recipeTitle">{s.name}</Heading>
                  <View style={styles.subMeta}>
                    <Numeric color="accent">
                      {s.amount.value} {s.amount.unit}
                    </Numeric>
                    <Text color="textMuted" style={styles.subNote}>
                      {s.note}
                    </Text>
                  </View>
                </View>
              </View>
            </Card>
          ))}
        </View>
      ) : (
        <Text color="textFaint" style={styles.hint}>
          {glyph.next} Long-press any ingredient in a recipe to launch Sub with the amount
          pre-loaded.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 16,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  body: { gap: 12 },
  paste: {
    minHeight: 130,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: layout.cardRadius,
    padding: 14,
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.text,
    textAlignVertical: 'top',
  },
  scaleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  scaleField: { flex: 1, gap: 4 },
  scaleOr: { paddingBottom: 12 },
  scaleInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  scaleInput: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.text,
  },
  error: { marginTop: 2 },
  output: { gap: 8, marginTop: 4 },
  outputHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    paddingBottom: 8,
  },
  outRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  outRowPivot: { backgroundColor: colors.bg3 },
  outGrams: { width: 72 },
  outPct: { width: 56 },
  outName: { flex: 1 },
  refLabel: { maxWidth: 90 },
  pivotHint: { fontStyle: 'italic', fontSize: 12, paddingTop: 4, paddingBottom: 2 },
  outActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  subInputs: { flexDirection: 'row', gap: 8 },
  subInput: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
  },
  subName: { flex: 1 },
  subAmt: { width: 56, fontFamily: fonts.mono, textAlign: 'center' },
  subUnit: { width: 70, textAlign: 'center' },
  subList: { gap: 10, marginTop: 4 },
  subCard: {},
  subRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rankNum: { fontSize: 14 },
  subText: { flex: 1, gap: 4 },
  subMeta: { gap: 2 },
  subNote: { lineHeight: 19 },
  hint: { marginTop: 8, lineHeight: 19 },
});
