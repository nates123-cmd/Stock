import { CLAUDE_AVAILABLE, claudeText } from '@/lib/api/claudeBridge';

/**
 * AI cross-unit reconcile for the wizard's combine step. Same-unit amounts add
 * locally (src/lib/qty.ts); this handles the case where recipes call for the
 * same ingredient in DIFFERENT units — "300 g cherry tomatoes" + "1 pint" — and
 * returns the single amount to BUY, in the unit you'd actually purchase it in
 * (cherry tomatoes by the pint, not grams). Rounds up so there's enough.
 *
 * Returns null when Claude isn't available or there's nothing to reconcile —
 * the caller then falls back to the side-by-side sum.
 */
const SYSTEM = `You reconcile grocery shopping quantities.

Given ONE ingredient and the amounts a set of recipes need — possibly in
different units — return the SINGLE quantity to BUY, in the unit you'd actually
purchase that item in at a store:
- cherry tomatoes, berries, mushrooms → pints / containers
- fresh herbs, scallions, kale → bunches
- garlic → heads; lemons/limes/onions/eggs → count
- liquids → the bottle/carton size that covers it
- meat/cheese/flour/etc → lb or the common pack size
Convert across units as needed (e.g. 300 g cherry tomatoes ≈ 1 pint), sum, then
ROUND UP to a whole purchasable unit so there's enough.

Reply with ONLY the quantity string — e.g. "2 pints", "1 bunch", "1 lb",
"3" — no ingredient name, no words, no explanation.`;

export async function reconcileQty(
  ingredient: string,
  amounts: string[],
): Promise<string | null> {
  if (!CLAUDE_AVAILABLE) return null;
  const clean = amounts.map((a) => a.trim()).filter(Boolean);
  if (clean.length < 2) return null; // nothing to reconcile
  try {
    const out = await claudeText(
      'qty-reconcile',
      SYSTEM,
      JSON.stringify({ ingredient, amounts: clean }),
    );
    const line = out
      .replace(/```[a-z]*/gi, '')
      .replace(/```/g, '')
      .trim()
      .split('\n')[0]
      ?.trim();
    return line || null;
  } catch {
    return null;
  }
}
