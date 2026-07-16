/**
 * Quantity string math — sum a set of amount strings, folding unit aliases, and
 * keeping mixed units side-by-side ("300 g + 1 pint"). Shared by the shopping
 * list's combine and the build wizard's combine step so they agree.
 *
 * NOTE: this does NOT convert across units (g ↔ pint) — that needs a density and
 * is the job of the Claude reconcile pass. Here, same-unit parts sum; different
 * units are listed side-by-side for you to reconcile/edit.
 */
const UNIT_ALIAS: Record<string, string> = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
  cups: 'cup',
  gram: 'g', grams: 'g',
  kilogram: 'kg', kilograms: 'kg',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml',
  liter: 'l', liters: 'l',
  cloves: 'clove',
  bunches: 'bunch',
  cans: 'can',
  pints: 'pint',
};

export function normUnit(u: string): string {
  const k = u.trim().toLowerCase();
  return UNIT_ALIAS[k] ?? k;
}

/** Loose "2 cups" / "3" / "a pinch" → {amount, unit}. */
export function parseQty(raw: string): { amount: number | null; unit: string | null } {
  const t = raw.trim();
  if (!t) return { amount: null, unit: null };
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (m) {
    const amount = Number(m[1]);
    return {
      amount: Number.isFinite(amount) ? amount : null,
      unit: (m[2] ?? '').trim() || null,
    };
  }
  return { amount: null, unit: t };
}

/** Sum a set of qty strings: same units add, different units stay side-by-side. */
export function sumQtyStrings(qtys: string[]): string {
  const real = qtys.map((q) => q.trim()).filter((q) => q && q !== 'as needed');
  if (real.length === 0) return qtys.some((q) => q === 'as needed') ? 'as needed' : '';
  const buckets = new Map<string, number>();
  const freeform: string[] = [];
  for (const q of real) {
    const { amount, unit } = parseQty(q);
    if (amount == null) {
      freeform.push(q);
      continue;
    }
    const u = normUnit(unit ?? '');
    buckets.set(u, (buckets.get(u) ?? 0) + amount);
  }
  const parts = [...buckets.entries()].map(([u, a]) => {
    const n = `${+a.toFixed(2)}`;
    return u ? `${n} ${u}` : n;
  });
  return [...parts, ...freeform].join(' + ');
}

/** True when a summed qty string still mixes ≥2 different units — i.e. it needs
 *  reconciling ("300 g + 1 pint"). Used to flag rows for the AI reconcile / edit. */
export function isMixedUnits(qty: string): boolean {
  return qty.includes(' + ');
}
