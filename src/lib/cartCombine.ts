/**
 * Cart-combine review (redesign Phase D, note 5) — DISTINCT from the Cook
 * combine timeline.
 *
 * The consolidation already groups the same ingredient from several recipes
 * into one buy line. Instead of silently trusting that merge, we surface each
 * multi-recipe group for a one-at-a-time decision: Combine (default), Keep
 * separate, or Edit qty. Same-unit groups get the summed quantity; unit
 * mismatches (1 cup + 200 ml) get a converted total via convert-units, falling
 * back to keep-separate when the units can't convert.
 */
import convert from 'convert-units';
import type { ShoppingLine, ShoppingSource } from '@/lib/shopping';

/** Stock unit string → convert-units identifier (mass + volume). */
const UNIT_MAP: Record<string, string> = {
  g: 'g',
  kg: 'kg',
  mg: 'mg',
  oz: 'oz',
  lb: 'lb',
  ml: 'ml',
  l: 'l',
  tsp: 'tsp',
  tbsp: 'Tbs',
  cup: 'cup',
  'fl-oz': 'fl-oz',
  floz: 'fl-oz',
  pt: 'pnt',
  pint: 'pnt',
  qt: 'qt',
  quart: 'qt',
  gal: 'gal',
};

const describer = convert();

function convId(unit: string | null | undefined): string | null {
  if (!unit) return null;
  return UNIT_MAP[unit.trim().toLowerCase()] ?? null;
}

function measureOf(id: string): string | null {
  try {
    return describer.describe(id as never).measure ?? null;
  } catch {
    return null;
  }
}

const trimNum = (n: number): string => `${+n.toFixed(2)}`;

/** One-line label for a single source contribution, e.g. "1 lemon (Shakshuka)". */
export function sourceLabel(s: ShoppingSource, fallbackName: string): string {
  const name = (s.text || fallbackName).trim();
  if (s.amount == null) return `${name} (${s.recipe})`;
  const q =
    s.unit && s.unit !== 'pc' ? `${trimNum(s.amount)} ${s.unit} ` : `${trimNum(s.amount)} `;
  return `${q}${name} (${s.recipe})`;
}

export type CombineResult = {
  /** the offered combined quantity, e.g. "2 lemons" or "about 440 ml" */
  text: string;
  /** false when the sources use units that don't convert together */
  convertible: boolean;
};

/**
 * Offer a single combined quantity for a group of sources. Unitless / `pc`
 * amounts add as counts; unit'd amounts sum in-unit, converting to the first
 * source's unit when they share a measure. Returns convertible:false when
 * distinct, non-convertible units remain (caller should suggest keep-separate).
 */
export function combinedQty(name: string, sources: ShoppingSource[]): CombineResult {
  let count = 0;
  const withUnit: { amount: number; unit: string }[] = [];
  for (const s of sources) {
    if (s.amount == null) continue;
    if (!s.unit || s.unit === 'pc') count += s.amount;
    else withUnit.push({ amount: s.amount, unit: s.unit });
  }

  const parts: string[] = [];
  let convertible = true;
  if (count > 0) parts.push(`${trimNum(count)} ${name}`);

  if (withUnit.length > 0) {
    const targetUnit = withUnit[0]!.unit;
    const targetId = convId(targetUnit);
    const targetMeasure = targetId ? measureOf(targetId) : null;
    const allSameMeasure =
      !!targetMeasure &&
      withUnit.every((w) => {
        const id = convId(w.unit);
        return id && measureOf(id) === targetMeasure;
      });

    if (allSameMeasure && targetId) {
      let sum = 0;
      for (const w of withUnit) sum += convert(w.amount).from(convId(w.unit)! as never).to(targetId as never);
      parts.push(`${trimNum(sum)} ${targetUnit}`);
    } else {
      // Not convertible together — sum per-unit buckets, keep them distinct.
      const buckets = new Map<string, number>();
      for (const w of withUnit) buckets.set(w.unit, (buckets.get(w.unit) ?? 0) + w.amount);
      if (buckets.size > 1) convertible = false;
      for (const [u, a] of buckets) parts.push(`${trimNum(a)} ${u}`);
    }
  }

  return { text: parts.join(' + ') || 'as needed', convertible };
}

export type CombineGroup = {
  name: string;
  sources: ShoppingSource[];
  /** per-source labels: ["1 lemon (Shakshuka)", "1 lemon (Chana)"] */
  perSource: string[];
  /** offered combined quantity string */
  suggestion: string;
  /** false when units don't convert — combine still allowed, keep-separate advised */
  convertible: boolean;
};

/**
 * Which consolidated lines should go through cart-combine review: those whose
 * sources span two or more distinct recipes (a genuine cross-recipe merge).
 */
export function reviewGroups(lines: ShoppingLine[]): CombineGroup[] {
  const out: CombineGroup[] = [];
  for (const l of lines) {
    const recipes = new Set(l.sources.map((s) => s.recipe));
    if (l.sources.length < 2 || recipes.size < 2) continue;
    const { text, convertible } = combinedQty(l.name, l.sources);
    out.push({
      name: l.name,
      sources: l.sources,
      perSource: l.sources.map((s) => sourceLabel(s, l.name)),
      suggestion: text,
      convertible,
    });
  }
  return out;
}
