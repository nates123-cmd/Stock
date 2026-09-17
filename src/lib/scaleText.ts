/**
 * Scale the amounts written INTO step prose.
 *
 * A step body reads "Whisk 2 eggs with 1 1/2 cups milk". The Scale tool
 * rewrites the ingredient list, but the steps kept saying "2 eggs" after a
 * ½× — so the recipe contradicted itself at the stove. This rewrites the
 * measured amounts inside step text by the same ratio, with the same 2dp
 * rounding and the same fraction formatter the ingredient rows use, so the
 * two always agree.
 *
 * What gets scaled (and only this):
 *  - a number followed by a measure word: "2 cups", "500g", "1½ tbsp", "3 cloves"
 *  - a number followed by an ingredient the recipe lists: "2 eggs", "3 large lemons"
 *  - ranges of either: "2–3 cups", "2 to 3 eggs", "1 or 2 tbsp"
 *
 * Never touched: temperatures (350°F), durations (10 minutes), "Step 2",
 * pan sizes (9x13-inch), percentages, and bare numbers with nothing edible
 * after them — those are not quantities of food.
 *
 * Pure module — no store, no IO.
 */
import { toFraction } from '@/lib/format';
import { matchTerms, stem } from '@/lib/stepAmounts';
import type { Ingredient, Step } from '@/types';

/** Measure words a number can be "of". Singular forms; plurals fold to these. */
const MEASURES = new Set([
  'g', 'gram', 'kg', 'kilogram', 'mg', 'ml', 'milliliter', 'millilitre', 'l',
  'liter', 'litre', 'dl', 'cup', 'tbsp', 'tbs', 'tablespoon', 'tsp', 'teaspoon',
  'oz', 'ounce', 'lb', 'lbs', 'pound', 'qt', 'quart', 'pt', 'pint', 'gallon',
  'stick', 'clove', 'can', 'slice', 'sprig', 'bunch', 'head', 'stalk', 'piece',
  'pinch', 'handful', 'knob', 'pat', 'sheet', 'fillet', 'filet', 'strip', 'rib',
  'ear', 'jar', 'bottle', 'packet', 'package', 'bag', 'box', 'dash', 'splash',
]);

/** Adjectives that may sit between a count and its noun: "2 large eggs". */
const SIZE_WORDS = new Set([
  'large', 'small', 'medium', 'big', 'whole', 'fresh', 'ripe', 'thin', 'thick',
  'heaping', 'heaped', 'scant', 'level', 'generous', 'rounded', 'extra-large',
  'jumbo', 'more', 'additional', 'extra', 'remaining',
]);

const UNICODE_FRACTIONS: Record<string, [number, number]> = {
  '½': [1, 2], '¼': [1, 4], '¾': [3, 4], '⅓': [1, 3], '⅔': [2, 3],
  '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8],
};
const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');
const ASCII_TO_UNICODE = new Map(
  Object.entries(UNICODE_FRACTIONS).map(([ch, [a, b]]) => [`${a}/${b}`, ch]),
);

// One number, in any of the ways recipes write them:
//   "1 1/2"  "1/2"  "1½"  "1 ½"  "½"  "1.5"  "1,5"  "2"
const NUM = String.raw`(?:\d+ \d+/\d+|\d+/\d+|\d+(?:[.,]\d+)? ?[${FRACTION_CHARS}]|[${FRACTION_CHARS}]|\d+(?:[.,]\d+)?)`;
// A number, optionally a range ("2-3", "2 – 3", "2 to 3", "1 or 2"). The
// leading group is the boundary: we don't want the "13" out of "9x13", nor
// the "2" out of "1/2".
const AMOUNT_RE = new RegExp(
  String.raw`(^|[^\w/.,${FRACTION_CHARS}])(${NUM})(?:( *(?:[-–—]|to|or) *)(${NUM}))?`,
  'g',
);
// Up to three words after the number, keeping the gaps so we can re-emit
// them verbatim. The first gap may be empty ("500g") or a hyphen ("2-cup").
const WORDS_RE = /^([ \t-]*)([a-zA-Z][a-zA-Z-]*)(?:([ \t]+)([a-zA-Z][a-zA-Z-]*))?(?:([ \t]+)([a-zA-Z][a-zA-Z-]*))?/;

/** "1 1/2" | "1½" | "½" | "1.5" | "2" → number. */
export function parseWrittenAmount(text: string): number | null {
  const t = text.trim().replace(',', '.');
  const m = t.match(new RegExp(String.raw`^(\d+)? ?(?:(\d+)/(\d+)|([${FRACTION_CHARS}]))$`));
  if (m && (m[2] || m[4])) {
    const whole = m[1] ? parseInt(m[1], 10) : 0;
    let frac: number;
    if (m[4]) {
      const [a, b] = UNICODE_FRACTIONS[m[4]] ?? [0, 1];
      frac = a / b;
    } else {
      const den = parseInt(m[3] as string, 10);
      if (den === 0) return null;
      frac = parseInt(m[2] as string, 10) / den;
    }
    return whole + frac;
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Scaled number written the way the ingredient rows write it ("1 1/2"), or
 * in the source's own unicode style ("1½") when that is how it was written.
 */
export function formatWrittenAmount(n: number, unicode = false): string {
  const s = toFraction(Math.round(n * 100) / 100);
  if (!unicode) return s;
  return s.replace(/ ?(\d\/\d)$/, (_, f: string) => ASCII_TO_UNICODE.get(f) ?? ` ${f}`);
}

/** "cups" → "cup", "pinches" → "pinch", "tomatoes" → "tomato", "berries" → "berry". */
function singular(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ch|sh|x|s|o)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function plural(word: string): string {
  const w = word.toLowerCase();
  if (/(ch|sh|x|s)$/.test(w)) return `${word}es`;
  if (/[^aeiou]y$/.test(w)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * Make `word` (as written) agree with the new amount, but only when the
 * amount crosses one: "2 cups" → "1 cup", "1/2 cup" ×4 → "2 cups". Anything
 * else keeps the writer's own inflection — we are not a grammar checker.
 */
function agree(word: string, before: number, after: number): string {
  if (ABBREVIATIONS.has(word.toLowerCase())) return word;
  const wasOne = before <= 1;
  const isOne = after <= 1;
  if (isOne && !wasOne) return singular(word);
  if (!isOne && wasOne) return plural(word);
  return word;
}

/** Never inflect these: "1 tbsp", "2 tbsp", "500g", "2 oz". */
const ABBREVIATIONS = new Set(['g', 'kg', 'mg', 'ml', 'l', 'dl', 'oz', 'lb', 'lbs', 'qt', 'pt', 'tbsp', 'tbs', 'tsp']);

type Kind = 'measure' | 'noun' | 'size' | null;

/**
 * Words that identify a counted ingredient in prose: every content word of
 * every ingredient name, stemmed — "eggs" → "egg", "chicken thighs" →
 * "chicken", "thigh".
 */
function countNouns(ingredients: Ingredient[]): Set<string> {
  const out = new Set<string>();
  for (const ing of ingredients) {
    for (const term of matchTerms(ing.canonicalName)) {
      for (const w of term.split(' ')) if (w.length > 2) out.add(stem(w));
    }
  }
  return out;
}

function classify(word: string, nouns: Set<string>): Kind {
  const w = word.toLowerCase();
  if (MEASURES.has(singular(w)) || MEASURES.has(w)) return 'measure';
  if (SIZE_WORDS.has(w)) return 'size';
  if (nouns.has(stem(w))) return 'noun';
  return null;
}

/**
 * Scale every written food amount in `text` by `ratio`. Returns the text
 * unchanged (same string) when it holds nothing to scale.
 */
export function scaleAmountsInText(text: string, ratio: number, ingredients: Ingredient[]): string {
  if (!text || ratio === 1) return text;
  const nouns = countNouns(ingredients);
  let out = '';
  let cursor = 0;
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(text)) !== null) {
    const [whole, lead = '', a = '', sep, b] = m;
    const end = m.index + whole.length;
    const words = WORDS_RE.exec(text.slice(end));
    if (!words) continue;

    // Walk the words: size adjectives may lead, then the measure/noun run.
    const toks: { gap: string; word: string; kind: Kind }[] = [];
    for (let i = 1; i < 7; i += 2) {
      const word = words[i + 1];
      if (!word) break;
      toks.push({ gap: words[i] ?? '', word, kind: classify(word, nouns) });
    }
    let i = 0;
    while (i < toks.length && toks[i]?.kind === 'size') i++;
    const firstKind = toks[i]?.kind;
    if (firstKind !== 'measure' && firstKind !== 'noun') continue;
    // The head is the word that agrees with the number: the first measure if
    // there is one ("2 cups flour", "2 garlic cloves"), else the last noun of
    // the run ("2 chicken thighs").
    let head = i;
    for (let j = i; j < toks.length; j++) {
      const k = toks[j]?.kind;
      if (k === 'measure') {
        head = j;
        break;
      }
      if (k === 'noun') head = j;
      else break;
    }

    const na = parseWrittenAmount(a);
    const nb = b ? parseWrittenAmount(b) : null;
    if (na == null || (b && nb == null)) continue;
    const sa = Math.round(na * ratio * 100) / 100;
    const sb = nb != null ? Math.round(nb * ratio * 100) / 100 : null;
    const unicode = new RegExp(`[${FRACTION_CHARS}]`).test(a);

    let piece = `${lead}${formatWrittenAmount(sa, unicode)}`;
    if (sb != null) piece += `${sep}${formatWrittenAmount(sb, unicode)}`;
    let consumed = end;
    for (let j = 0; j <= head; j++) {
      const t = toks[j];
      if (!t) break;
      piece += t.gap;
      piece += j === head ? agree(t.word, nb ?? na, sb ?? sa) : t.word;
      consumed += t.gap.length + t.word.length;
    }
    out += text.slice(cursor, m.index) + piece;
    cursor = consumed;
    AMOUNT_RE.lastIndex = consumed;
  }
  if (cursor === 0) return text;
  return out + text.slice(cursor);
}

/** Every step's title and body with its written amounts scaled by `ratio`. */
export function scaleSteps(steps: Step[], ratio: number, ingredients: Ingredient[]): Step[] {
  if (ratio === 1) return steps;
  return steps.map((s) => {
    const title = scaleAmountsInText(s.title, ratio, ingredients);
    const body = scaleAmountsInText(s.body, ratio, ingredients);
    return title === s.title && body === s.body ? s : { ...s, title, body };
  });
}
