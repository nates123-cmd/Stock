/**
 * Which ingredients belong to which step — the ChefSteps layout, where every
 * step opens with a small block of the ingredients it brings in ("400 g Onion,
 * 140 g Celery…") and then the prose.
 *
 * Nate: "if I half the recipe, I want the new amounts shown in the steps as
 * well." So this never stores anything. It is computed at render from the
 * recipe's live ingredient list, which is where Scale, To grams and manual
 * edits all write. Halve the recipe and every step block follows.
 *
 * Rules:
 *
 *  1. **First mention only.** An ingredient appears at the first step that
 *     names it. Pancake butter shows at "melt the butter", not again at
 *     "stream in half of the melted butter".
 *
 *  2. **Longest phrase wins.** "chicken stock" in a step belongs to the stock,
 *     not to the rotisserie chicken. Each ingredient is matched by its full
 *     name and by its single content words; a longer span beats any shorter
 *     span it overlaps.
 *
 *  3. **Shared words are a last resort.** A word several ingredients share
 *     ("chicken" in bouillon / stock / rotisserie chicken, "frozen" in frozen
 *     peas / frozen mirepoix) never places an ingredient on the first pass.
 *     Only after every clear match is in does a still-unplaced ingredient get
 *     to claim a free occurrence of such a word, and only when it is the one
 *     unplaced ingredient that shares it. A shared word right next to a match
 *     for an ingredient that also owns it ("chicken bouillon") is part of
 *     that match, not free.
 *
 *  4. **Exact ties go to the earlier ingredient.** "butter" names both the
 *     140 g unsalted and the grassfed garnish butter; the list order decides,
 *     and the garnish butter is placed by its own full name later.
 *
 * Anything no step names comes back in `unplaced`, shown above step 1.
 *
 * Pure module — no store, no IO.
 */
import { toFraction } from '@/lib/format';
import { densityFor, ML_PER_CUP } from '@/lib/parsing/density';
import { stem } from '@/lib/stepAmounts';
import type { Ingredient, Step } from '@/types';

/** Words that describe an ingredient without identifying it. */
const STOP = new Set([
  'fresh', 'dried', 'ground', 'large', 'small', 'medium', 'whole', 'chopped',
  'minced', 'sliced', 'grated', 'good', 'quality', 'extra', 'virgin', 'kosher',
  'freshly', 'plain', 'unsalted', 'salted', 'raw', 'ripe', 'boneless',
  'skinless', 'of', 'the', 'a', 'an', 'and', 'or', 'to', 'for', 'in', 'at',
  'than', 'with', 'into', 'about', 'cut', 'peeled', 'diced', 'packed', 'all',
]);

/**
 * Words that end an ingredient's name but also mean something else in a
 * method ("Mix well", "the meat", "the mixture"). Never matched on their own;
 * the full name still matches.
 */
const GENERIC = new Set(['mix', 'mixture', 'blend', 'paste', 'meat', 'juice', 'seasoning', 'piece']);

/** Lower-case word tokens, stemmed, punctuation and parentheticals gone. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(stem);
}

type Phrase = { words: string[]; score: number; weak: boolean };

/**
 * An ingredient's phrases: the full name (strong, scored by length), its head
 * noun (strong), and every other content word (weak — may be shared).
 */
function phrasesFor(canonicalName: string): { phrases: Phrase[]; words: Set<string> } {
  const base = canonicalName.split(',')[0] ?? '';
  const content = tokens(base).filter(
    (w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w),
  );
  const phrases: Phrase[] = [];
  if (content.length > 1) phrases.push({ words: content, score: content.length * 3, weak: false });
  content.forEach((w, i) => {
    if (GENERIC.has(w)) return;
    const head = i === content.length - 1;
    phrases.push({ words: [w], score: head ? 2 : 1, weak: !head });
  });
  return { phrases, words: new Set(content) };
}

type Hit = { ing: number; start: number; end: number; score: number; word?: string };

export type StepPlacement = {
  /** step id → the ingredients it brings in, in the order the step names them */
  byStep: Map<string, Ingredient[]>;
  /** ingredients no step names */
  unplaced: Ingredient[];
};

export function placeIngredients(
  steps: Pick<Step, 'id' | 'ordinal' | 'body' | 'title'>[],
  ingredients: Ingredient[],
): StepPlacement {
  const ordered = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const info = ingredients.map((i) => phrasesFor(i.canonicalName));

  // How many ingredients own each single word — a word owned by 2+ is shared.
  const owners = new Map<string, number[]>();
  info.forEach(({ words }, idx) => {
    for (const w of words) owners.set(w, [...(owners.get(w) ?? []), idx]);
  });
  const shared = (w: string) => (owners.get(w)?.length ?? 0) > 1;

  const stepTokens = ordered.map((s) => tokens(s.body || s.title || ''));
  const firstStep = new Map<number, { step: number; at: number }>();
  /** per step: token positions already claimed, by which ingredient */
  const claimed = stepTokens.map((t) => new Array<number | null>(t.length).fill(null));

  // Keep the earliest mention: pass 2 can find a step before the one a pass-1
  // word placed it at ("chopped chicken" in 5 vs "rotisserie" in 8).
  const place = (ing: number, step: number, at: number) => {
    const f = firstStep.get(ing);
    if (!f || step < f.step || (step === f.step && at < f.at)) firstStep.set(ing, { step, at });
  };

  // ---- pass 1: clear matches ----
  stepTokens.forEach((toks, s) => {
    const hits: Hit[] = [];
    info.forEach(({ phrases }, ing) => {
      for (const p of phrases) {
        if (p.weak && shared(p.words[0]!)) continue;
        const n = p.words.length;
        for (let i = 0; i + n <= toks.length; i++) {
          if (p.words.every((w, k) => toks[i + k] === w)) {
            hits.push({ ing, start: i, end: i + n, score: p.score });
          }
        }
      }
    });
    // Longest/strongest first; exact ties → earlier ingredient in the list.
    hits.sort((a, b) => b.score - a.score || a.ing - b.ing || a.start - b.start);
    const taken = claimed[s]!;
    for (const h of hits) {
      let free = true;
      for (let i = h.start; i < h.end; i++) if (taken[i] != null) free = false;
      if (!free) continue;
      for (let i = h.start; i < h.end; i++) taken[i] = h.ing;
      place(h.ing, s, h.start);
    }
    // A shared word touching a claimed span of an ingredient that owns it
    // ("chicken bouillon") belongs to that span.
    let grew = true;
    while (grew) {
      grew = false;
      toks.forEach((w, i) => {
        if (taken[i] != null || !shared(w)) return;
        for (const j of [i - 1, i + 1]) {
          const by = taken[j];
          if (by != null && info[by]!.words.has(w)) {
            taken[i] = by;
            grew = true;
            return;
          }
        }
      });
    }
  });

  // ---- pass 2: unplaced ingredients may claim a free shared word ----
  stepTokens.forEach((toks, s) => {
    const taken = claimed[s]!;
    toks.forEach((w, i) => {
      if (taken[i] != null || !shared(w)) return;
      const candidates = (owners.get(w) ?? []).filter((ing) => {
        const f = firstStep.get(ing);
        return !f || f.step > s;
      });
      if (candidates.length !== 1) return;
      taken[i] = candidates[0]!;
      place(candidates[0]!, s, i);
    });
  });

  const byStep = new Map<string, Ingredient[]>();
  const unplaced: Ingredient[] = [];
  const perStep = new Map<number, { ing: number; at: number }[]>();
  ingredients.forEach((_, ing) => {
    const f = firstStep.get(ing);
    if (!f) return;
    perStep.set(f.step, [...(perStep.get(f.step) ?? []), { ing, at: f.at }]);
  });
  ordered.forEach((step, s) => {
    const list = perStep.get(s);
    if (!list) return;
    list.sort((a, b) => a.at - b.at || a.ing - b.ing);
    byStep.set(step.id, list.map((x) => ingredients[x.ing]!));
  });
  ingredients.forEach((ing, idx) => {
    if (!firstStep.has(idx)) unplaced.push(ing);
  });
  return { byStep, unplaced };
}

const GRAMS_PER: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000 };

/**
 * "about 5 cups" for a weighed ingredient the density table knows: the
 * volume column from Modernist Cuisine, as a faint hint beside the name.
 * Rounded to what a measuring set can hit: cups (from ½) to the quarter, tablespoons
 * to the half, teaspoons to the quarter (eighth under 1 tsp). Null for counts, volumes, and
 * anything the table doesn't cover — no guessing.
 */
export function approxVolume(ing: Pick<Ingredient, 'amount' | 'unit' | 'canonicalName'>): string | null {
  if (ing.amount == null || !(ing.amount > 0) || !ing.unit) return null;
  const perUnit = GRAMS_PER[ing.unit.trim().toLowerCase()];
  if (!perUnit) return null;
  const entry = densityFor(ing.canonicalName);
  if (!entry) return null;
  const ml = (ing.amount * perUnit) / entry.gPerMl;
  const cups = ml / ML_PER_CUP;
  const tbsp = ml / 14.79;
  const tsp = ml / 4.93;
  const nice = (n: number, step: number) => Math.round(n / step) * step;
  // Cups only when the quarter-cup rounding stays honest (140 g butter is
  // 0.62 cup: "1/2 cup" is 20% short, "10 tbsp" is right).
  const c = nice(cups, 0.25);
  if (cups >= 0.5 && (Math.abs(c - cups) / cups <= 0.08 || tbsp > 16)) {
    return `about ${toFraction(c)} ${c > 1 ? 'cups' : 'cup'}`;
  }
  if (tbsp >= 1) return `${toFraction(nice(tbsp, 0.5))} tbsp`;
  const t = tsp >= 1 ? nice(tsp, 0.25) : Math.max(0.125, nice(tsp, 0.125));
  return `${toFraction(t)} tsp`;
}
