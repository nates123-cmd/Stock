/**
 * Substitutions — "I'm out of buttermilk, what now?"
 *
 * Two sources, in order:
 *  1. Claude (`findSubstitutes`, spec §11.5) — knows anything, needs a network.
 *  2. A curated local table — the couple of dozen swaps a home cook actually
 *     hits, with real ratios. Offline, instant, and free.
 *
 * The local table is not a fallback of last resort so much as the floor: Sub is
 * reached by long-pressing something mid-cook, which is exactly when a spinner
 * and a failed request are useless. `findSubstitutes` THROWS when Claude is
 * unavailable, so without this the whole feature is dead on a plain build.
 *
 * Ratios are expressed against the original amount. `unit` overrides the
 * original's unit when the swap is measured differently (1 egg → 1/4 cup
 * applesauce); absent means "same unit, scaled by ratio".
 */
import { findSubstitutes, type Substitute } from '@/lib/parsing/units';
import { makeMod } from '@/lib/recipe';
import type { Ingredient, Modification, Unit } from '@/types';

export type { Substitute };

export type LocalSub = {
  name: string;
  /** multiplies the original amount */
  ratio: number;
  /** measured in a different unit than the original */
  unit?: Unit;
  note: string;
};

type TableEntry = {
  /** lower-case substrings; any hit matches this entry */
  match: string[];
  subs: LocalSub[];
};

/**
 * Curated swaps. Ordered best-first within each entry — rank 1 is the closest
 * result, not the most common pantry item.
 */
export const SUB_TABLE: TableEntry[] = [
  {
    match: ['buttermilk'],
    subs: [
      { name: 'milk + lemon juice', ratio: 1, note: 'Rest 10 min to clabber. Same tang and rise.' },
      { name: 'plain yogurt, thinned', ratio: 1, note: 'Thicker crumb, slightly richer.' },
      { name: 'milk + cream of tartar', ratio: 1, note: 'Works for rise, less tang.' },
    ],
  },
  {
    match: ['heavy cream', 'heavy whipping cream', 'double cream'],
    subs: [
      { name: 'whole milk + melted butter', ratio: 1, note: 'Good in sauces. Will not whip.' },
      { name: 'evaporated milk', ratio: 1, note: 'Thinner, faintly cooked flavor.' },
      { name: 'coconut cream', ratio: 1, note: 'Dairy-free. Reads coconut.' },
    ],
  },
  {
    match: ['sour cream'],
    subs: [
      { name: 'full-fat greek yogurt', ratio: 1, note: 'Near-identical. Tangier.' },
      { name: 'creme fraiche', ratio: 1, note: 'Richer, less tang, will not split.' },
      { name: 'buttermilk', ratio: 0.75, note: 'For batters only — much looser.' },
    ],
  },
  {
    match: ['egg', 'eggs', 'large egg'],
    subs: [
      { name: 'flax egg (1 tbsp flax + 3 tbsp water)', ratio: 1, note: 'Binds. No lift, denser crumb.' },
      { name: 'unsweetened applesauce', ratio: 0.25, unit: 'cup', note: 'Binds and sweetens. Baking only.' },
      { name: 'mashed banana', ratio: 0.25, unit: 'cup', note: 'Binds. Tastes of banana.' },
    ],
  },
  {
    match: ['butter', 'unsalted butter'],
    subs: [
      { name: 'neutral oil', ratio: 0.8, note: 'Moister, no browning or creaming.' },
      { name: 'olive oil', ratio: 0.75, note: 'Savory. Good in cake, odd in cookies.' },
      { name: 'coconut oil', ratio: 1, note: 'Solid when cold, so creaming still works.' },
    ],
  },
  {
    match: ['whole milk', 'milk'],
    subs: [
      { name: 'half water, half heavy cream', ratio: 1, note: 'Closest fat and body.' },
      { name: 'oat milk', ratio: 1, note: 'Neutral, browns well. Dairy-free.' },
      { name: 'evaporated milk + water', ratio: 1, note: 'Slightly cooked flavor.' },
    ],
  },
  {
    match: ['creme fraiche'],
    subs: [
      { name: 'sour cream', ratio: 1, note: 'Tangier, splits at a hard boil.' },
      { name: 'mascarpone', ratio: 1, note: 'Sweeter, much richer.' },
    ],
  },
  {
    match: ['all-purpose flour', 'plain flour', 'ap flour'],
    subs: [
      { name: 'bread flour', ratio: 1, note: 'Chewier, needs a touch more liquid.' },
      { name: 'cake flour', ratio: 1.1, note: 'Softer crumb, less structure.' },
      { name: '1:1 gluten-free blend', ratio: 1, note: 'Rest the batter 20 min.' },
    ],
  },
  {
    match: ['bread flour'],
    subs: [
      { name: 'all-purpose flour', ratio: 1, note: 'Slightly less chew and rise.' },
      { name: 'all-purpose + vital wheat gluten', ratio: 1, note: 'Matches protein. Best swap.' },
    ],
  },
  {
    match: ['cornstarch', 'corn starch', 'cornflour'],
    subs: [
      { name: 'arrowroot', ratio: 1, note: 'Clearer gloss, do not boil hard.' },
      { name: 'all-purpose flour', ratio: 2, note: 'Cloudy, needs longer cooking.' },
      { name: 'potato starch', ratio: 1, note: 'Thickens lower and faster.' },
    ],
  },
  {
    match: ['baking powder'],
    subs: [
      { name: 'baking soda + cream of tartar', ratio: 1, note: 'Mix 1:2. Use immediately.' },
      { name: 'baking soda + buttermilk', ratio: 0.25, note: 'Cut other liquid to match.' },
    ],
  },
  {
    match: ['baking soda', 'bicarbonate of soda'],
    subs: [
      { name: 'baking powder', ratio: 3, note: 'Weaker. May read salty at volume.' },
    ],
  },
  {
    match: ['brown sugar', 'light brown sugar', 'dark brown sugar'],
    subs: [
      { name: 'white sugar + molasses', ratio: 1, note: '1 tbsp molasses per cup. Identical.' },
      { name: 'white sugar', ratio: 1, note: 'Drier, crisper, less caramel.' },
      { name: 'coconut sugar', ratio: 1, note: 'Less sweet, darker color.' },
    ],
  },
  {
    match: ['granulated sugar', 'white sugar', 'caster sugar'],
    subs: [
      { name: 'brown sugar', ratio: 1, note: 'Moister, chewier, caramel note.' },
      { name: 'honey', ratio: 0.75, note: 'Cut liquid by 2 tbsp/cup. Browns faster.' },
      { name: 'maple syrup', ratio: 0.75, note: 'Cut liquid. Distinct flavor.' },
    ],
  },
  {
    match: ['honey'],
    subs: [
      { name: 'maple syrup', ratio: 1, note: 'Thinner, less floral.' },
      { name: 'granulated sugar + water', ratio: 1.25, note: 'Neutral. Less browning.' },
    ],
  },
  {
    match: ['white wine', 'dry white wine'],
    subs: [
      { name: 'chicken stock + white wine vinegar', ratio: 1, note: 'Splash of vinegar for the acid.' },
      { name: 'dry vermouth', ratio: 1, note: 'Nearly identical, more herbal.' },
      { name: 'white grape juice + lemon', ratio: 1, note: 'Sweeter. Non-alcoholic.' },
    ],
  },
  {
    match: ['red wine', 'dry red wine'],
    subs: [
      { name: 'beef stock + red wine vinegar', ratio: 1, note: 'Less body, keeps the acid.' },
      { name: 'pomegranate juice', ratio: 1, note: 'Fruitier. Non-alcoholic.' },
    ],
  },
  {
    match: ['shallot', 'shallots'],
    subs: [
      { name: 'yellow onion + garlic', ratio: 1, note: 'Sharper. Mince fine.' },
      { name: 'red onion', ratio: 1, note: 'Closest raw, harsher cooked.' },
    ],
  },
  {
    match: ['fresh thyme', 'fresh rosemary', 'fresh oregano', 'fresh herbs'],
    subs: [
      { name: 'the dried herb', ratio: 0.333, note: 'Dried is ~3x stronger. Add early.' },
    ],
  },
  {
    match: ['lemon juice', 'fresh lemon juice'],
    subs: [
      { name: 'lime juice', ratio: 1, note: 'Same acid, different perfume.' },
      { name: 'white wine vinegar', ratio: 0.5, note: 'Sharper. Use less.' },
    ],
  },
  {
    match: ['creme de cassis', 'vermouth', 'sherry'],
    subs: [{ name: 'dry white wine', ratio: 1, note: 'Less aromatic, close enough.' }],
  },
  {
    match: ['parmesan', 'parmigiano', 'pecorino'],
    subs: [
      { name: 'grana padano', ratio: 1, note: 'Milder, melts the same.' },
      { name: 'aged asiago', ratio: 1, note: 'Sharper, less nutty.' },
    ],
  },
  {
    match: ['ricotta'],
    subs: [
      { name: 'cottage cheese, blended', ratio: 1, note: 'Blend smooth or it stays lumpy.' },
      { name: 'mascarpone', ratio: 1, note: 'Much richer and sweeter.' },
    ],
  },
  {
    match: ['soy sauce', 'shoyu'],
    subs: [
      { name: 'tamari', ratio: 1, note: 'Gluten-free, rounder.' },
      { name: 'coconut aminos', ratio: 1.25, note: 'Sweeter, much less salty.' },
    ],
  },
  {
    match: ['fish sauce'],
    subs: [
      { name: 'soy sauce + rice vinegar', ratio: 1, note: 'Loses the funk, keeps the salt.' },
      { name: 'worcestershire', ratio: 0.5, note: 'Anchovy-based. Stronger.' },
    ],
  },
  {
    match: ['stock', 'chicken stock', 'beef stock', 'broth', 'chicken broth'],
    subs: [
      { name: 'water + bouillon', ratio: 1, note: 'Check salt before seasoning.' },
      { name: 'water', ratio: 1, note: 'Works. Season harder at the end.' },
    ],
  },
  {
    match: ['creme', 'half and half', 'half-and-half'],
    subs: [
      { name: 'whole milk + heavy cream', ratio: 1, note: 'Mix 3:1. Matches fat.' },
    ],
  },
  {
    match: ['vegetable oil', 'neutral oil', 'canola oil'],
    subs: [
      { name: 'melted butter', ratio: 1.25, note: 'Adds flavor and browning.' },
      { name: 'light olive oil', ratio: 1, note: 'Neutral enough for most baking.' },
    ],
  },
  {
    match: ['mayonnaise', 'mayo'],
    subs: [
      { name: 'greek yogurt', ratio: 1, note: 'Tangier, far less fat.' },
      { name: 'sour cream', ratio: 1, note: 'Closest texture.' },
    ],
  },
  {
    match: ['dijon', 'dijon mustard'],
    subs: [
      { name: 'whole-grain mustard', ratio: 1, note: 'Seedier, emulsifies nearly as well.' },
      { name: 'yellow mustard', ratio: 1, note: 'Sharper, more vinegar-forward.' },
    ],
  },
];

/** Loose normalize for matching — lower-case, strip punctuation and prep tails. */
function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]!
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The table entry for an ingredient, or undefined. Longest match wins. */
export function localEntryFor(name: string): TableEntry | undefined {
  const n = norm(name);
  if (!n) return undefined;
  let best: { entry: TableEntry; len: number } | undefined;
  for (const entry of SUB_TABLE) {
    for (const m of entry.match) {
      if (n === m || n.includes(m)) {
        if (!best || m.length > best.len) best = { entry, len: m.length };
      }
    }
  }
  return best?.entry;
}

/** Round a scaled amount to something a cook would actually measure. */
function tidy(value: number): number {
  if (value >= 100) return Math.round(value);
  if (value >= 10) return Math.round(value * 2) / 2;
  return Math.round(value * 100) / 100;
}

/** Turn the local table into the same shape Claude returns. */
export function localSubstitutes(
  name: string,
  amount: { value: number; unit: Unit },
): Substitute[] {
  const entry = localEntryFor(name);
  if (!entry) return [];
  return entry.subs.slice(0, 3).map((s, i) => ({
    rank: (i + 1) as 1 | 2 | 3,
    name: s.name,
    amount: {
      value: tidy((amount.value || 1) * s.ratio),
      unit: s.unit ?? amount.unit,
    },
    note: s.note,
  }));
}

export type SubResult = {
  subs: Substitute[];
  source: 'claude' | 'local';
};

/**
 * Best substitutes for an ingredient. Claude when it can, the local table when
 * it cannot — and never throws, because this is reached mid-cook. An empty
 * `subs` means we genuinely have nothing, which the UI says plainly rather
 * than showing an error.
 */
export async function suggestSubstitutes(
  name: string,
  amount: { value: number; unit: Unit },
): Promise<SubResult> {
  try {
    const subs = await findSubstitutes(name, amount);
    if (subs.length > 0) return { subs, source: 'claude' };
  } catch {
    /* offline, no key, or a bad parse — fall through to the table */
  }
  return { subs: localSubstitutes(name, amount), source: 'local' };
}

/** An accepted swap, in the shape both the recipe and the shopping list use. */
export type AcceptedSub = {
  name: string;
  amount: number | null;
  unit: string | null;
  note?: string;
};

/**
 * Turn an ingredient INTO its substitute, recording the swap the way a mid-cook
 * edit does — so the recipe shows "~~1 cup buttermilk~~ 1 cup milk + 1 tbsp
 * lemon juice" through the existing IngredientAmount / IngredientName diff
 * renderers, and the change stays readable in the history instead of being a
 * silent overwrite.
 */
export function applySubToIngredient(
  ing: Ingredient,
  sub: AcceptedSub,
  opts: { cookId?: string } = {},
): Ingredient {
  const mods: Modification[] = [];
  const reason = sub.note ? `sub: ${sub.note}` : 'substitution';
  if (sub.amount !== ing.amount || (sub.unit ?? null) !== (ing.unit ?? null)) {
    mods.push(
      makeMod({
        type: 'amount',
        before: { amount: ing.amount, unit: ing.unit },
        after: { amount: sub.amount, unit: sub.unit },
        cookId: opts.cookId,
        reason,
      }),
    );
  }
  if (sub.name.trim().toLowerCase() !== ing.canonicalName.trim().toLowerCase()) {
    mods.push(
      makeMod({
        type: 'name',
        before: ing.canonicalName,
        after: sub.name,
        cookId: opts.cookId,
        reason,
      }),
    );
  }
  if (mods.length === 0) return ing;
  return {
    ...ing,
    canonicalName: sub.name,
    amount: sub.amount,
    unit: sub.unit,
    modificationHistory: [...ing.modificationHistory, ...mods],
  };
}
