/**
 * Keyless heuristic recipe parser — the fallback used when no Claude API key
 * is configured (spec §14.2). Deterministic, dependency-free, intentionally
 * conservative: everything it produces is flagged "guessed" so the §6 review
 * screen styles it as low-confidence.
 *
 * When a key IS present, parsing/recipe.ts prefers Claude (spec §11) and only
 * falls back here on error.
 */
import type { Ingredient, Step } from '@/types';
import { uid } from '@/lib/id';
import type { ParsedRecipeDraft } from './recipe';

const FRACTIONS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125,
};

/**
 * Synonyms → canonical Unit codes (spec §4 Unit). This both recognizes a
 * token as a unit AND normalizes its spelling, so formatAmount and Bench see
 * one form ("grams"→"g", "teaspoons"→"tsp") instead of whatever the source
 * happened to write.
 */
const UNIT_SYNONYMS: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g', gms: 'g', gr: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  cup: 'cup', cups: 'cup',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  clove: 'clove', cloves: 'clove',
  stick: 'stick', sticks: 'stick',
  can: 'can', cans: 'can',
  pinch: 'pinch', pinches: 'pinch',
  pc: 'pc', piece: 'pc', pieces: 'pc',
};

// Yield lines ("Serves 6", "6 servings", or a lone "6" above "servings")
// must set the recipe yield, never list as an ingredient (spec §6).
const YIELD_INLINE_RE = /^\s*(?:serves|makes|yields?)\s*:?\s*(\d+)\b/i;
const YIELD_SERVINGS_RE = /^\s*(\d+)\s*servings?\s*$/i;
const SERVINGS_WORD_RE = /^servings?$/i;
const NON_INGREDIENT_NAMES = new Set(['servings', 'serving', 'yield', 'makes']);

function parseQuantity(token: string): number | null {
  let t = token.trim();
  let total = 0;
  // mixed number with unicode fraction: "1½"
  const m = t.match(/^(\d+)?\s*([½¼¾⅓⅔⅛])$/);
  if (m) {
    if (m[1]) total += parseInt(m[1], 10);
    total += FRACTIONS[m[2] as string] ?? 0;
    return total;
  }
  const frac = FRACTIONS[t];
  if (frac != null) return frac;
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number);
    return b ? (a as number) / (b as number) : null;
  }
  t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

const INGREDIENT_RE =
  /^[-•*\s]*((?:\d+[\d./]*\s*[½¼¾⅓⅔⅛]?)|[½¼¾⅓⅔⅛])\s*([a-zA-Z]+)?\s*(.*)$/;

function toIngredient(line: string): Ingredient | null {
  const m = line.match(INGREDIENT_RE);
  if (!m) return null;
  const amount = parseQuantity(m[1] as string);
  if (amount == null) return null;
  let unit: string | null = null;
  let name = (m[3] ?? '').trim();
  const maybeUnit = (m[2] ?? '').toLowerCase();
  const canon = UNIT_SYNONYMS[maybeUnit];
  if (canon) unit = canon;
  else if (maybeUnit) name = `${maybeUnit} ${name}`.trim();
  if (!name) return null;
  // "6 servings" slipping through as an ingredient (spec §6).
  if (NON_INGREDIENT_NAMES.has(name.toLowerCase())) return null;
  return {
    id: uid('ing'),
    amount,
    unit,
    canonicalName: name.replace(/\s+/g, ' ').toLowerCase(),
    originalText: line.trim(),
    modificationHistory: [],
  };
}

function toStep(line: string, ordinal: number): Step {
  const body = line.replace(/^\s*\d+[.)]\s*/, '').trim();
  const title = body.split(/[,.]/)[0]?.split(/\s+/).slice(0, 6).join(' ') ?? `Step ${ordinal}`;
  return {
    id: uid('stp'),
    ordinal,
    title,
    body,
    parsedTimers: [],
    parsedAmounts: [],
    modificationHistory: [],
  };
}

/** Best-effort structure from raw pasted/scraped text. */
export function localParseRecipe(text: string, fallbackTitle = 'Untitled recipe'): ParsedRecipeDraft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const ingredients: Ingredient[] = [];
  const stepLines: string[] = [];
  let title = '';
  let serves = 4;
  let servesFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    // Yield, not an ingredient.
    const ym = line.match(YIELD_SERVINGS_RE) ?? line.match(YIELD_INLINE_RE);
    if (ym) {
      serves = parseInt(ym[1] as string, 10) || serves;
      servesFound = true;
      continue;
    }
    // NYT two-line shape: "6" on its own line, "servings" on the next.
    if (
      /^\d+$/.test(line) &&
      i + 1 < lines.length &&
      SERVINGS_WORD_RE.test(lines[i + 1] as string)
    ) {
      serves = parseInt(line, 10) || serves;
      servesFound = true;
      i++; // consume the "servings" line too
      continue;
    }

    const ing = toIngredient(line);
    if (ing) {
      ingredients.push(ing);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line) || line.length > 60) {
      stepLines.push(line);
      continue;
    }
    if (!title && line.length <= 80) title = line;
  }

  const steps = stepLines.map((l, i) => toStep(l, i + 1));

  return {
    title: title || fallbackTitle,
    yield: { serves },
    ingredients,
    steps,
    tags: [],
    fieldConfidence: {
      title: 'guessed',
      ingredients: 'guessed',
      steps: 'guessed',
      yield: servesFound ? 'parsed' : 'guessed',
    },
  };
}
