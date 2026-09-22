/**
 * Rewrite the volume amounts written INTO step prose after "To grams".
 *
 * Scale already keeps steps honest (scaleText.ts). Convert did not: the
 * ingredient row would say "63 g sugar" while step 2 still said "whisk in
 * 5 tablespoons sugar". Nate, 2026-09-22: "when I scale things, it shows up
 * in the description, but when I convert it to grams, that doesn't work."
 *
 * For every converted ingredient we know its own density from the row
 * itself (grams ÷ (amount × mL of its unit)), so a step that names a
 * DIFFERENT amount of the same thing — "sprinkle 1 tablespoon of the sugar"
 * — gets its proportional share, not the row total.
 *
 * What gets rewritten (and only this):
 *  - a number (or range) + a volume or mass measure word, followed within a
 *    few words by a noun of an ingredient that was just converted:
 *    "5 tablespoons sugar" → "63 g sugar", "1½ cups of milk" → "368 g of milk"
 *  - the same with no noun nearby, only when exactly one converted row has
 *    that exact amount and unit: "add the 6 tablespoons and whisk"
 *
 * Never touched: amounts of ingredients that were not converted, counts
 * ("2 eggs", "3 cloves"), temperatures, durations, and anything already in
 * grams.
 *
 * Pure module — no store, no IO.
 */
import { volumeMl } from '@/lib/parsing/density';
import { parseWrittenAmount } from '@/lib/scaleText';
import { matchTerms, stem } from '@/lib/stepAmounts';
import type { Ingredient, Step } from '@/types';

/** A row as it was BEFORE conversion, and the grams it became. */
export type GramConversion = { ingredient: Ingredient; grams: number };

const MASS_G: Record<string, number> = {
  g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, mg: 0.001,
  oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
};

const SIZE_WORDS = new Set([
  'large', 'small', 'medium', 'big', 'whole', 'heaping', 'heaped', 'scant',
  'level', 'generous', 'rounded', 'more', 'additional', 'extra', 'remaining',
]);

const UNICODE_FRACTIONS = '½¼¾⅓⅔⅛⅜⅝⅞';
const NUM = String.raw`(?:\d+ \d+/\d+|\d+/\d+|\d+(?:[.,]\d+)? ?[${UNICODE_FRACTIONS}]|[${UNICODE_FRACTIONS}]|\d+(?:[.,]\d+)?)`;
const AMOUNT_RE = new RegExp(
  String.raw`(^|[^\w/.,${UNICODE_FRACTIONS}])(${NUM})(?:( *(?:[-–—]|to|or) *)(${NUM}))?`,
  'g',
);
/** Up to two words after the number (a size adjective, then the measure). */
const WORDS_RE = /^([ \t-]*)([a-zA-Z][a-zA-Z.-]*)(?:([ \t]+)([a-zA-Z][a-zA-Z.-]*))?/;
/** The next handful of words after the measure — where the noun should be. */
const LOOKAHEAD_RE = /^[ \t]*(?:of[ \t]+)?((?:[a-zA-Z-]+[ \t,]*){0,5})/;

/** "cups" → "cup", "tablespoons" → "tablespoon"; abbreviations untouched. */
function singularUnit(word: string): string {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

type Prepared = {
  conv: GramConversion;
  stems: Set<string>;
  gPerMl: number | null;
  origAmount: number | null;
  origUnit: string | null;
};

function prepare(conversions: GramConversion[]): Prepared[] {
  return conversions.map((conv) => {
    const { ingredient: ing, grams } = conv;
    const stems = new Set<string>();
    for (const term of matchTerms(ing.canonicalName)) {
      for (const w of term.split(' ')) if (w.length > 2) stems.add(stem(w));
    }
    const ml = volumeMl(ing.unit);
    const gPerMl = ml != null && ing.amount != null && ing.amount > 0 ? grams / (ing.amount * ml) : null;
    return {
      conv,
      stems,
      gPerMl,
      origAmount: ing.amount,
      origUnit: ing.unit ? singularUnit(ing.unit) : null,
    };
  });
}

/** Grams for `n` of `unitWord` of this ingredient, or null if unconvertible. */
function gramsFor(n: number, unitWord: string, p: Prepared): number | null {
  const u = singularUnit(unitWord);
  const mass = MASS_G[u];
  if (mass != null) return n * mass;
  const ml = volumeMl(u);
  if (ml != null && p.gPerMl != null) return n * ml * p.gPerMl;
  return null;
}

function isMeasure(word: string): boolean {
  const u = singularUnit(word);
  return MASS_G[u] != null || volumeMl(u) != null;
}

/**
 * Rewrite every written amount of a converted ingredient in `text` to grams.
 * Returns the same string when nothing applies.
 */
export function convertAmountsInText(text: string, conversions: GramConversion[]): string {
  if (!text || conversions.length === 0) return text;
  const prepared = prepare(conversions);
  let out = '';
  let cursor = 0;
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(text)) !== null) {
    const [whole, lead = '', a = '', sep, b] = m;
    const end = m.index + whole.length;
    const words = WORDS_RE.exec(text.slice(end));
    if (!words) continue;
    // "1 heaping tablespoon" — skip one size word to reach the measure.
    let gap = words[1] ?? '';
    let measure = words[2] ?? '';
    let consumed = end + gap.length + measure.length;
    if (SIZE_WORDS.has(measure.toLowerCase()) && words[4]) {
      gap = words[3] ?? '';
      measure = words[4];
      consumed += gap.length + measure.length;
    }
    if (!isMeasure(measure)) continue;
    // Already in grams: leave it.
    if (MASS_G[singularUnit(measure)] === 1) continue;

    const na = parseWrittenAmount(a);
    const nb = b ? parseWrittenAmount(b) : null;
    if (na == null || (b && nb == null)) continue;

    // Which converted ingredient is this? The noun within the next few words.
    const ahead = LOOKAHEAD_RE.exec(text.slice(consumed));
    const aheadStems = (ahead?.[1] ?? '')
      .toLowerCase()
      .split(/[^a-z-]+/)
      .filter((w) => w.length > 2)
      .map(stem);
    let pick: Prepared | undefined;
    let best = Infinity;
    for (const p of prepared) {
      const idx = aheadStems.findIndex((s) => p.stems.has(s));
      if (idx >= 0 && idx < best) {
        best = idx;
        pick = p;
      }
    }
    if (!pick) {
      // No noun nearby: accept only an unambiguous exact amount+unit match.
      const exact = prepared.filter(
        (p) => p.origAmount === (nb != null ? (na + nb) / 2 : na) && p.origUnit === singularUnit(measure),
      );
      if (exact.length === 1) pick = exact[0];
    }
    if (!pick) continue;

    const ga = gramsFor(na, measure, pick);
    const gb = nb != null ? gramsFor(nb, measure, pick) : null;
    if (ga == null || (nb != null && gb == null)) continue;

    let piece = `${lead}${Math.round(ga)}`;
    if (gb != null) piece += `${sep}${Math.round(gb)}`;
    piece += ' g';
    out += text.slice(cursor, m.index) + piece;
    cursor = consumed;
    AMOUNT_RE.lastIndex = consumed;
  }
  if (cursor === 0) return text;
  return out + text.slice(cursor);
}

/** Every step's title and body with the converted ingredients' amounts in grams. */
export function convertSteps(steps: Step[], conversions: GramConversion[]): Step[] {
  if (conversions.length === 0) return steps;
  return steps.map((s) => {
    const title = convertAmountsInText(s.title, conversions);
    const body = convertAmountsInText(s.body, conversions);
    return title === s.title && body === s.body ? s : { ...s, title, body };
  });
}
