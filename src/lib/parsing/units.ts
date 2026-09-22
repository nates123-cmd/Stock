/**
 * Bench tools — spec §11 tasks 4, 5 (§9 Bench; build order §13 step 8).
 */
import convert from 'convert-units';
import type { Unit } from '@/types';
import { CLAUDE_AVAILABLE, claudeText } from '@/lib/api/claudeBridge';
import { ML_PER_CUP, localGramsFromVolume, plausibleDensity, volumeMl } from './density';

/**
 * Stock unit code → convert-units identifier, for the units convert-units
 * knows by name. Mass units convert to grams with no density needed; the rest
 * (cup, tbsp, tsp, etc.) are volume and still need Claude's density estimate,
 * so they're intentionally absent here. "stick"/"clove"/"can"/"pinch"/"pc"
 * are counts/ambiguous and never map.
 */
const STOCK_TO_CONVERT: Record<string, convert.Unit> = {
  g: 'g',
  kg: 'kg',
  mg: 'mg',
  oz: 'oz',
  lb: 'lb',
};

/**
 * Convert a mass amount to grams locally via convert-units — no Claude needed.
 * Returns null for volume/count units (cup, tbsp, stick…) or unknown units,
 * which still require a density estimate from the Claude path.
 */
export function localGramsFromUnit(
  amount: number | null,
  unit: string | null,
): number | null {
  if (amount == null || amount <= 0 || !unit) return null;
  const id = STOCK_TO_CONVERT[unit.trim().toLowerCase()];
  if (!id) return null;
  try {
    return convert(amount).from(id).to('g');
  } catch {
    return null;
  }
}

export type ConvertedIngredient = {
  name: string;
  grams: number;
  /** baker's % vs. flour when flour is detected, else omitted (spec §9) */
  bakersPercent?: number;
};

export type GramResult = {
  id: string;
  grams: number;
  /** 'table' = deterministic local density, 'claude' = model density × local math */
  source: 'table' | 'claude';
};

/** An ingredient we refused to convert, and why — surfaced in the hint line. */
export type GramRejection = { id: string; name: string; reason: string };

export type GramsOutcome = { results: GramResult[]; rejected: GramRejection[] };

const CONVERT_SYSTEM = `You are a kitchen-density reference. For each ingredient
return its DENSITY as grams per US cup (236.6 mL) — NOT the grams for the amount
given. The caller multiplies. Reference points:
all-purpose flour 125, granulated sugar 200, brown sugar packed 213,
butter 227, water 240, milk 245, olive oil 218, honey 340, kosher salt 145,
table salt 288, baking powder 192, chopped raw vegetables 130-160,
leafy greens packed 60-90, shredded cheese 100, cooked rice 185.
Every real food lands between 50 and 380 grams per cup.

SKIP (do NOT include in output):
- items counted as discrete units (1 lemon, 2 eggs, 3 cloves garlic)
- items with no amount or amounts like "to taste" / "a pinch"

STRICT JSON, no prose, no markdown.
Schema: {"items":[{"id":string,"gramsPerCup":number}]}
where id matches the input. Output ONLY the JSON object.`;

/**
 * §11.4 — convert non-gram amounts to grams.
 *
 * Order of trust (see density.ts for why):
 *   1. mass unit → grams, local
 *   2. volume unit × known ingredient → grams, local density table
 *   3. volume unit × unknown ingredient → Claude gives grams/cup, we multiply,
 *      and reject any density outside the plausible band
 *   4. anything Claude can't or won't price is left untouched, never guessed
 *
 * Never throws for a single bad item: the caller gets both lists and decides
 * what to show. Throws only when Claude is unreachable or returns no JSON.
 */
export async function convertToGrams(
  ingredients: {
    id: string;
    canonicalName: string;
    amount: number | null;
    unit: string | null;
  }[],
): Promise<GramsOutcome> {
  const results: GramResult[] = [];
  const rejected: GramRejection[] = [];
  const needClaude: typeof ingredients = [];

  for (const i of ingredients) {
    if (i.amount == null || !(i.amount > 0) || !i.unit) continue;
    if (/^(g|kg|mg|gram|grams)$/i.test(i.unit.trim())) continue;
    const mass = localGramsFromUnit(i.amount, i.unit);
    if (mass != null) {
      results.push({ id: i.id, grams: Math.round(mass), source: 'table' });
      continue;
    }
    const local = localGramsFromVolume(i.canonicalName, i.amount, i.unit);
    if (local) {
      results.push({ id: i.id, grams: local.grams, source: 'table' });
      continue;
    }
    if (volumeMl(i.unit) == null) {
      rejected.push({
        id: i.id,
        name: i.canonicalName,
        reason: `"${i.unit}" isn't a weight or volume unit`,
      });
      continue;
    }
    needClaude.push(i);
  }

  if (needClaude.length === 0) return { results, rejected };

  if (!CLAUDE_AVAILABLE) {
    for (const i of needClaude) {
      rejected.push({ id: i.id, name: i.canonicalName, reason: 'needs Claude (proxy not configured)' });
    }
    return { results, rejected };
  }

  const payload = needClaude.map((i) => ({
    id: i.id,
    name: i.canonicalName,
    amount: i.amount,
    unit: i.unit,
  }));
  const out = await claudeText(
    'bench-convert-density',
    CONVERT_SYSTEM,
    JSON.stringify(payload),
  );

  const cleaned = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('Bench parse: no JSON in response');
  const parsed = JSON.parse(cleaned.slice(s, e + 1)) as {
    items?: { id?: unknown; gramsPerCup?: unknown }[];
  };
  if (!Array.isArray(parsed.items)) throw new Error('Bench parse: no items array');

  const byId = new Map<string, number>();
  for (const x of parsed.items) {
    if (typeof x.id === 'string' && typeof x.gramsPerCup === 'number') byId.set(x.id, x.gramsPerCup);
  }

  for (const i of needClaude) {
    const gPerCup = byId.get(i.id);
    if (gPerCup == null) {
      rejected.push({ id: i.id, name: i.canonicalName, reason: 'no density returned' });
      continue;
    }
    const gPerMl = gPerCup / ML_PER_CUP;
    if (!plausibleDensity(gPerMl)) {
      rejected.push({
        id: i.id,
        name: i.canonicalName,
        reason: `implausible density (${Math.round(gPerCup)} g/cup)`,
      });
      continue;
    }
    const ml = volumeMl(i.unit)!;
    results.push({ id: i.id, grams: Math.round(i.amount! * ml * gPerMl), source: 'claude' });
  }

  return { results, rejected };
}

export type Substitute = {
  rank: 1 | 2 | 3;
  name: string;
  amount: { value: number; unit: Unit };
  /** what changes in the result */
  note: string;
};

const SUB_SYSTEM = `You are a cooking-substitution expert. Given an ingredient
and the amount a recipe calls for, return the 3 best one-for-one substitutes,
ranked (1 = closest result). For each: the substitute's name, the concrete
amount to use IN PLACE of the original (scaled to the requested amount — e.g.
1 cup buttermilk → 1 cup milk + 1 tbsp lemon juice, so lead with the milk),
and a short note on what changes (flavor, texture, rise, browning).

Pick substitutes a home cook is likely to have. Keep notes under 15 words.

STRICT JSON, no prose, no markdown.
Schema: {"subs":[{"rank":1|2|3,"name":string,"amount":{"value":number,"unit":string},"note":string}]}
Output ONLY the JSON object, exactly 3 items ranked 1..3.`;

/** §11.5 — 3 ranked substitutes with amounts and notes. */
export async function findSubstitutes(
  ingredient: string,
  amount: { value: number; unit: Unit },
): Promise<Substitute[]> {
  if (!CLAUDE_AVAILABLE) {
    throw new Error(
      'Substitutions need Claude — configure your key or the proxy (sign-in not required).',
    );
  }
  const input = JSON.stringify({
    ingredient: ingredient.trim(),
    amount: amount.value,
    unit: amount.unit,
  });
  const out = await claudeText('bench-substitutes', SUB_SYSTEM, input);

  const cleaned = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('Bench parse: no JSON in response');
  const parsed = JSON.parse(cleaned.slice(s, e + 1)) as {
    subs?: {
      rank?: unknown;
      name?: unknown;
      amount?: { value?: unknown; unit?: unknown };
      note?: unknown;
    }[];
  };
  if (!Array.isArray(parsed.subs)) throw new Error('Bench parse: no subs array');

  return parsed.subs
    .filter(
      (x): x is { rank: number; name: string; amount: { value: number; unit: string }; note: string } =>
        typeof x.name === 'string' &&
        x.name.trim().length > 0 &&
        typeof x.note === 'string' &&
        typeof x.amount?.value === 'number' &&
        typeof x.amount?.unit === 'string',
    )
    .slice(0, 3)
    .map((x, i) => ({
      rank: (i + 1) as 1 | 2 | 3,
      name: x.name.trim(),
      amount: { value: x.amount.value, unit: x.amount.unit },
      note: x.note.trim(),
    }));
}
