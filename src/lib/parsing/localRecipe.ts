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

const UNITS = new Set([
  'g', 'kg', 'mg', 'ml', 'l', 'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons',
  'tsp', 'teaspoon', 'teaspoons', 'oz', 'lb', 'lbs', 'clove', 'cloves',
  'pc', 'piece', 'pieces', 'pinch', 'can', 'stick', 'sticks',
]);

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
  if (maybeUnit && UNITS.has(maybeUnit)) unit = maybeUnit;
  else if (maybeUnit) name = `${maybeUnit} ${name}`.trim();
  if (!name) return null;
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

  for (const line of lines) {
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
    yield: { serves: 4 },
    ingredients,
    steps,
    tags: [],
    fieldConfidence: {
      title: 'guessed',
      ingredients: 'guessed',
      steps: 'guessed',
      yield: 'guessed',
    },
  };
}
