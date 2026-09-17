/**
 * Amounts on a cook-plan step.
 *
 * A plan step reads "Toss the potatoes with the oil and roast" — which is
 * useless at the stove without *how much*. This resolves the amounts for the
 * ingredients a given step actually mentions.
 *
 * Two rules make it trustworthy:
 *
 *  1. **Only what the step names.** The run screen used to print every one of
 *     the component's ingredients under every one of its steps, which is noise
 *     you learn to skip — and skipping it is how you miss the one amount that
 *     mattered.
 *
 *  2. **Live, never the snapshot.** A PlanComponent carries a copy of the
 *     ingredients as they were when the plan was built, plus a `recipeId`. If
 *     the recipe has since been scaled (Scale writes the new amounts onto the
 *     recipe) or converted to grams, the snapshot is stale and the plan would
 *     contradict the recipe. So we read through `recipeId` to the live recipe
 *     and re-apply the component's own `scale`, falling back to the snapshot
 *     only when the recipe is gone. Scaling or converting the recipe therefore
 *     updates the cook plan with no rebuild.
 *
 * Pure module — no store, no IO.
 */
import { formatAmount } from '@/lib/format';
import type { Ingredient, PlanComponent, Recipe } from '@/types';

/** Lower-case, drop parentheticals and the prep tail after the first comma. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Singular/plural-tolerant stem so "lemons" in a step finds "lemon". */
export function stem(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

const STOP = new Set([
  'fresh', 'dried', 'ground', 'large', 'small', 'medium', 'whole', 'chopped',
  'minced', 'sliced', 'grated', 'good', 'quality', 'extra', 'virgin', 'kosher',
  'freshly', 'plain', 'unsalted', 'salted', 'raw', 'ripe', 'boneless',
  'skinless', 'of', 'the', 'a', 'an', 'and', 'or', 'to', 'for', 'in', 'at',
]);

/**
 * The words that identify an ingredient in prose: its full name, and its head
 * noun. "olive oil, EVOO" → ["olive oil", "oil"]; "chicken thighs, bone-in" →
 * ["chicken thighs", "thighs", "chicken"].
 */
export function matchTerms(canonicalName: string): string[] {
  const base = norm(canonicalName.split(',')[0] ?? '');
  if (!base) return [];
  const words = base.split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  const terms = new Set<string>();
  if (words.length > 0) terms.add(words.join(' '));
  // head noun last, then any other content word — a step may name either half
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (w && w.length > 2) terms.add(w);
  }
  return [...terms];
}

/** Does this step's text name this ingredient? */
export function stepMentions(stepText: string, canonicalName: string): boolean {
  const words = norm(stepText).split(' ').map(stem);
  const haystack = ` ${words.join(' ')} `;
  return matchTerms(canonicalName).some((term) => {
    const t = term.split(' ').map(stem).join(' ');
    return t.length > 0 && haystack.includes(` ${t} `);
  });
}

/**
 * The component's ingredients as they stand RIGHT NOW: the live recipe's, with
 * the component's scale re-applied. Falls back to the stored snapshot when the
 * recipe has been deleted, so an old plan still shows something.
 */
export function liveIngredients(
  component: PlanComponent | undefined,
  lookup: (id: string) => Recipe | undefined,
): Ingredient[] {
  if (!component) return [];
  const live = component.recipeId ? lookup(component.recipeId) : undefined;
  if (!live) return component.ingredients;
  const scale = component.scale ?? 1;
  if (scale === 1) return live.ingredients;
  return live.ingredients.map((i) =>
    i.amount == null ? i : { ...i, amount: i.amount * scale },
  );
}

/**
 * The ingredients a step names, in the order the step names them. Empty when
 * the step is pure procedure ("heat the oven", "rest 15 minutes") — which is
 * the point: no row, no noise.
 */
export function amountsForStep(
  stepText: string,
  ingredients: Ingredient[],
): Ingredient[] {
  const text = norm(stepText);
  const hits = ingredients
    .filter((i) => stepMentions(stepText, i.canonicalName))
    .map((i) => {
      const term = matchTerms(i.canonicalName).find((t) => text.includes(norm(t)));
      return { ing: i, at: term ? text.indexOf(norm(term)) : Number.MAX_SAFE_INTEGER };
    });
  hits.sort((a, b) => a.at - b.at);
  // De-dupe by canonical name — two recipes in one plan can both call for salt.
  const seen = new Set<string>();
  const out: Ingredient[] = [];
  for (const { ing } of hits) {
    const key = norm(ing.canonicalName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ing);
  }
  return out;
}

/** "2 cups flour" — the same formatter the recipe screens use, so they match. */
export function formatStepAmount(ing: Ingredient): string {
  const amount = formatAmount(ing.amount, ing.unit ?? null);
  const name = (ing.canonicalName.split(',')[0] ?? ing.canonicalName).trim();
  return amount ? `${amount} ${name}` : name;
}

/** One line of amounts for a step, or null when it names no ingredient. */
export function stepAmountLine(
  stepText: string,
  ingredients: Ingredient[],
): string | null {
  const hits = amountsForStep(stepText, ingredients);
  if (hits.length === 0) return null;
  return hits.map(formatStepAmount).join('  ·  ');
}
