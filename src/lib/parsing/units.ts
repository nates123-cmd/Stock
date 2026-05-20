/**
 * Bench tools — spec §11 tasks 4, 5 (§9 Bench; build order §13 step 8).
 */
import type { Unit } from '@/types';
import { CLAUDE_AVAILABLE, claudeText } from '@/lib/api/claudeBridge';

export type ConvertedIngredient = {
  name: string;
  grams: number;
  /** baker's % vs. flour when flour is detected, else omitted (spec §9) */
  bakersPercent?: number;
};

export type GramResult = { id: string; grams: number };

const CONVERT_SYSTEM = `You convert recipe ingredient amounts to grams using
typical kitchen-density values (all-purpose flour ~ 125g/cup, granulated
sugar ~ 200g/cup, brown sugar packed ~ 213g/cup, butter 1 stick = 113g,
water 1 cup = 240g, milk 1 cup = 240g, olive oil ~ 218g/cup, honey ~ 340g/cup,
kosher salt 1 tsp ~ 3g, table salt 1 tsp ~ 6g, baking powder 1 tsp ~ 4g).
Use your best gram estimate for ingredients not in those examples.

SKIP (do NOT include in output):
- items already in grams or kilograms or milligrams
- items counted as discrete units (1 lemon, 2 eggs, 3 cloves garlic, 1 stalk celery)
- items with no amount or amounts like "to taste" / "a pinch"
- items with no unit when the amount is a whole-item count

STRICT JSON, no prose, no markdown.
Schema: {"items":[{"id":string,"grams":number}]}
where id matches the input. Output ONLY the JSON object.`;

/** §11.4 — convert non-gram amounts to grams via Claude. */
export async function convertToGrams(
  ingredients: {
    id: string;
    canonicalName: string;
    amount: number | null;
    unit: string | null;
  }[],
): Promise<GramResult[]> {
  if (!CLAUDE_AVAILABLE) {
    throw new Error(
      'Conversion to grams needs Claude — sign-in not required, just configure your key or the proxy.',
    );
  }
  const candidates = ingredients.filter(
    (i) =>
      i.amount != null &&
      i.amount > 0 &&
      i.unit &&
      !/^(g|kg|mg)$/i.test(i.unit.trim()),
  );
  if (candidates.length === 0) return [];

  const payload = candidates.map((i) => ({
    id: i.id,
    name: i.canonicalName,
    amount: i.amount,
    unit: i.unit,
  }));
  const out = await claudeText(
    'bench-convert-grams',
    CONVERT_SYSTEM,
    JSON.stringify(payload),
  );

  const cleaned = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('Bench parse: no JSON in response');
  const parsed = JSON.parse(cleaned.slice(s, e + 1)) as {
    items?: { id?: unknown; grams?: unknown }[];
  };
  if (!Array.isArray(parsed.items)) throw new Error('Bench parse: no items array');
  return parsed.items
    .filter(
      (x): x is GramResult =>
        typeof x.id === 'string' && typeof x.grams === 'number' && x.grams > 0,
    )
    .map((x) => ({ id: x.id, grams: Math.round(x.grams) }));
}

export type Substitute = {
  rank: 1 | 2 | 3;
  name: string;
  amount: { value: number; unit: Unit };
  /** what changes in the result */
  note: string;
};

/** §11.5 — 3 ranked substitutes with amounts and notes. */
export async function findSubstitutes(
  _ingredient: string,
  _amount: { value: number; unit: Unit },
): Promise<Substitute[]> {
  // TODO: callClaude(MODELS.fast), cache on ingredient+amount.
  throw new Error('not implemented — spec §11.5');
}
