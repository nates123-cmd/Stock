/**
 * Auto-tagging — derived tags that you can fully edit.
 *
 * Two rules shape this file:
 *
 * 1. **Derive locally, not with a model.** Every tag here is decidable from the
 *    ingredients, the time, and the steps. A model call would be slower, cost
 *    money per recipe, and — worst — give a different answer each run, so a tag
 *    could quietly appear or vanish between builds. Same reason Break's feed
 *    uses a bundled dataset for its canonical sets.
 *
 * 2. **Your edits win, permanently.** A derived list that overwrites what you
 *    changed is the shopping list's old bug in another costume. So the recipe
 *    records WHICH tags the machine added and WHICH auto tags you deleted.
 *    Re-running the tagger never re-adds something you removed and never
 *    removes something you added.
 *
 * The vocabulary is closed: the tagger only ever emits {@link AUTO_TAGS}. You
 * can still type any free-form tag you like; those are yours and are never
 * touched.
 */

/** Every tag the auto-tagger is allowed to emit. */
export const AUTO_TAGS = [
  'vegetarian',
  'vegan',
  'quick',
  'weeknight',
  'project',
  'baking',
  'one-pot',
  'no-cook',
  'spicy',
  'healthy',
] as const;

export type AutoTag = (typeof AUTO_TAGS)[number];

const AUTO_SET = new Set<string>(AUTO_TAGS);
export const isAutoTag = (t: string): boolean => AUTO_SET.has(norm(t));

/** Tag normalization: lowercase, trimmed, inner whitespace collapsed. */
export function norm(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Provenance for a recipe's tags. Absent on recipes that have never been
 * auto-tagged, which reads as "every tag here is yours" — so turning the
 * feature on cannot take anything away.
 */
export type TagMeta = {
  /** Tags currently on the recipe because the tagger put them there. */
  auto?: string[];
  /** Auto tags you deleted. The tagger will not bring these back. */
  removed?: string[];
};

/* ------------------------------------------------------------------ *
 * Word matching
 * ------------------------------------------------------------------ */

/**
 * Does `text` contain `needle` as a whole word (allowing a plural s/es)?
 *
 * Substring matching is what makes naive dietary tagging wrong: "egg" hits
 * "eggplant", "beef" hits "beefsteak tomato", "ham" hits "hamburger bun".
 *
 * Exported because lib/cuisine.ts needs exactly this and learned the lesson the
 * expensive way: matching its signature terms as plain substrings made "hing"
 * (asafoetida) hit "somet-hing", "was-hing", "not-hing", and labelled a key lime
 * pie and a stack of buttermilk pancakes as Indian. One notion of word matching,
 * shared.
 */
export function hasWord(text: string, needle: string): boolean {
  const re = new RegExp(`(^|[^a-z])${escapeRe(needle)}(e?s)?([^a-z]|$)`, 'i');
  return re.test(text);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasAny = (text: string, needles: readonly string[]) =>
  needles.some((n) => hasWord(text, n));

/* ------------------------------------------------------------------ *
 * Dietary vocabularies
 * ------------------------------------------------------------------ */

const MEAT = [
  'beef', 'pork', 'chicken', 'turkey', 'lamb', 'veal', 'duck', 'goose',
  'bacon', 'pancetta', 'prosciutto', 'guanciale', 'sausage', 'chorizo',
  'ham', 'salami', 'pepperoni', 'brisket', 'steak', 'meatball', 'mince',
  'oxtail', 'liver', 'gelatin', 'lard', 'tallow', 'suet', 'bone broth',
  'chicken stock', 'chicken broth', 'beef stock', 'beef broth',
] as const;

const SEAFOOD = [
  'fish', 'anchovy', 'anchovies', 'shrimp', 'prawn', 'salmon', 'tuna', 'cod',
  'halibut', 'scallop', 'clam', 'mussel', 'oyster', 'crab', 'lobster', 'squid',
  'calamari', 'octopus', 'sardine', 'mackerel', 'trout', 'snapper', 'bass',
  'fish sauce', 'worcestershire', 'bonito', 'dashi',
] as const;

const DAIRY = [
  'milk', 'butter', 'cream', 'cheese', 'yogurt', 'yoghurt', 'ghee', 'custard',
  'parmesan', 'parmigiano', 'pecorino', 'mozzarella', 'feta', 'ricotta',
  'mascarpone', 'gruyere', 'cheddar', 'halloumi', 'buttermilk', 'kefir',
  'creme fraiche', 'half and half',
] as const;

const EGG = ['egg', 'eggs', 'mayonnaise', 'mayo', 'aioli', 'meringue'] as const;

const SWEET_ANIMAL = ['honey'] as const;

/**
 * Names that LOOK animal but aren't. Checked first, so "peanut butter",
 * "coconut milk" and "beyond beef" don't make a vegan recipe read as meat.
 */
const PLANT_QUALIFIERS = [
  'vegan', 'vegetarian', 'plant-based', 'plant based', 'meatless', 'meat-free',
  'coconut', 'almond', 'oat', 'soy', 'soya', 'cashew', 'peanut', 'sesame',
  'sunflower', 'hazelnut', 'macadamia', 'pistachio', 'rice milk', 'hemp',
  'nutritional yeast', 'beyond', 'impossible', 'tofu', 'tempeh', 'seitan',
  'jackfruit', 'shea', 'cocoa', 'apple butter', 'nut butter',
] as const;

/** Ingredient names that trip a keyword but are plants. */
const FALSE_FRIENDS = [
  'eggplant', 'beefsteak tomato', 'chickpea', 'chickpeas', 'buttermilk squash',
  'butternut', 'butterhead', 'butter lettuce', 'butter bean', 'butter beans',
  'creamer potato', 'cream of tartar', 'honeydew', 'milk thistle',
  'hamburger bun', 'hot dog bun', 'fishcake sauce',
] as const;

/** Is this ingredient plainly a plant, despite containing an animal keyword? */
function isPlantQualified(name: string): boolean {
  const n = name.toLowerCase();
  if (FALSE_FRIENDS.some((f) => n.includes(f))) return true;
  return PLANT_QUALIFIERS.some((q) => n.includes(q));
}

function anyIngredient(names: string[], vocab: readonly string[]): boolean {
  return names.some((n) => !isPlantQualified(n) && hasAny(n, vocab));
}

/* ------------------------------------------------------------------ *
 * Other vocabularies
 * ------------------------------------------------------------------ */

const HEAT_VERBS = [
  'bake', 'baked', 'roast', 'roasted', 'fry', 'fried', 'saute', 'sauté',
  'sear', 'simmer', 'boil', 'grill', 'broil', 'steam', 'braise', 'toast',
  'cook', 'heat', 'microwave', 'griddle', 'poach', 'blanch', 'preheat',
] as const;

const BAKING_SIGNALS = [
  'flour', 'yeast', 'baking powder', 'baking soda', 'sugar', 'butter',
  'cocoa', 'chocolate chips', 'vanilla extract',
] as const;

const SPICY = [
  'chili', 'chilli', 'chile', 'jalapeno', 'jalapeño', 'serrano', 'habanero',
  'cayenne', 'harissa', 'gochujang', 'gochugaru', 'sriracha', 'chipotle',
  'sambal', 'peperoncino', 'scotch bonnet', 'red pepper flakes', 'hot sauce',
  "n'duja", 'curry paste', 'aleppo',
] as const;

const ONE_VESSEL = [
  'one pot', 'one-pot', 'one pan', 'one-pan', 'sheet pan', 'sheet-pan',
  'single skillet', 'dutch oven', 'traybake', 'tray bake', 'skillet supper',
] as const;

/** Whole foods that make a dish read as vegetable-forward. */
const WHOLESOME = [
  'spinach', 'kale', 'broccoli', 'cauliflower', 'carrot', 'zucchini',
  'courgette', 'tomato', 'pepper', 'onion', 'garlic', 'mushroom', 'cabbage',
  'lentil', 'chickpea', 'bean', 'quinoa', 'farro', 'barley', 'brown rice',
  'sweet potato', 'squash', 'cucumber', 'celery', 'asparagus', 'green bean',
  'chard', 'arugula', 'lettuce', 'avocado', 'edamame', 'tofu', 'salmon',
  'yogurt', 'oats',
] as const;

const INDULGENT = [
  'heavy cream', 'double cream', 'deep-fry', 'deep fry', 'shortening',
  'condensed milk', 'buttercream', 'frosting', 'lard', 'puff pastry',
] as const;

/* ------------------------------------------------------------------ *
 * Derivation
 * ------------------------------------------------------------------ */

/** The slice of a recipe the tagger reads. */
export type TaggableRecipe = {
  title?: string;
  ingredients: { canonicalName: string }[];
  steps: { title?: string; body?: string }[];
  yield?: { totalMinutes?: number };
  nutrition?: { calories?: number; fat?: number; protein?: number };
};

const stepText = (r: TaggableRecipe) =>
  r.steps
    .map((s) => `${s.title ?? ''} ${s.body ?? ''}`)
    .join(' \n ')
    .toLowerCase();

/**
 * The tags this recipe earns right now. Pure and deterministic — the same
 * recipe always produces the same list, which is what lets the reconcile below
 * treat any difference as a real change rather than noise.
 */
export function deriveTags(r: TaggableRecipe): AutoTag[] {
  const names = r.ingredients.map((i) => i.canonicalName.toLowerCase());
  const steps = stepText(r);
  const all = `${(r.title ?? '').toLowerCase()} ${names.join(' ')} ${steps}`;
  const minutes = r.yield?.totalMinutes;
  const stepCount = r.steps.length;
  const out: AutoTag[] = [];

  /* -- diet -- */
  const hasMeat = anyIngredient(names, MEAT) || anyIngredient(names, SEAFOOD);
  const hasDairy = anyIngredient(names, DAIRY);
  const hasEgg = anyIngredient(names, EGG);
  const hasHoney = anyIngredient(names, SWEET_ANIMAL);
  // Only claim a diet tag when there ARE ingredients to judge; an empty or
  // unparsed recipe must not be labelled vegan by default.
  if (names.length > 0 && !hasMeat) {
    out.push('vegetarian');
    if (!hasDairy && !hasEgg && !hasHoney) out.push('vegan');
  }

  /* -- effort -- */
  if (minutes != null && minutes > 0 && minutes <= 30) out.push('quick');
  if (minutes != null && minutes > 0 && minutes <= 45 && stepCount <= 10)
    out.push('weeknight');
  if ((minutes != null && minutes >= 120) || stepCount >= 18) out.push('project');

  /* -- method -- */
  if (
    hasAny(all, ['bake', 'oven', 'baked']) &&
    names.some((n) => hasAny(n, BAKING_SIGNALS))
  )
    out.push('baking');
  if (ONE_VESSEL.some((v) => all.includes(v))) out.push('one-pot');
  if (stepCount > 0 && !hasAny(steps, HEAT_VERBS)) out.push('no-cook');
  if (names.some((n) => hasAny(n, SPICY)) || SPICY.some((s) => all.includes(s)))
    out.push('spicy');

  /* -- healthy --
   * Nutrition when we have it, otherwise a vegetable-forward heuristic. This is
   * the softest rule in the file by some distance, which is exactly why it is
   * editable: disagree once and it stays disagreed. */
  if (isHealthy(r, names, all)) out.push('healthy');

  // 'project' and 'quick'/'weeknight' are contradictory; the time rules can't
  // both fire, but a 20-step 25-minute recipe would. Effort tags rank by time.
  const deduped = out.filter(
    (t, i) => out.indexOf(t) === i && !(t === 'project' && out.includes('quick')),
  );
  // Emit in vocabulary order so the chip row is stable between recipes.
  return AUTO_TAGS.filter((t) => deduped.includes(t));
}

function isHealthy(r: TaggableRecipe, names: string[], all: string): boolean {
  if (INDULGENT.some((i) => all.includes(i))) return false;
  const n = r.nutrition;
  if (n?.calories != null && n.calories > 0) {
    if (n.calories > 700) return false;
    if (n.fat != null && n.fat > 35) return false;
    return true;
  }
  // No nutrition: call it healthy when it is built on whole foods and isn't
  // fried or sugar-led.
  if (all.includes('deep-fry') || all.includes('deep fry')) return false;
  const wholesome = names.filter((x) => hasAny(x, WHOLESOME)).length;
  return wholesome >= 4 && wholesome >= Math.ceil(names.length / 3);
}

/* ------------------------------------------------------------------ *
 * Reconciling with your edits
 * ------------------------------------------------------------------ */

export type ReconcileResult = { tags: string[]; tagMeta: TagMeta };

/**
 * Fold a fresh derivation into a recipe's tags without losing an edit.
 *
 *  - Tags you typed stay, always.
 *  - Auto tags you deleted stay deleted, however many times this runs.
 *  - An auto tag the recipe no longer earns (you halved the cook time, so it is
 *    no longer a "project") comes off — but only if it was the tagger's to
 *    begin with.
 */
export function reconcileTags(
  currentTags: string[],
  derived: readonly string[],
  meta: TagMeta | undefined,
): ReconcileResult {
  const auto = new Set((meta?.auto ?? []).map(norm));
  const removed = new Set((meta?.removed ?? []).map(norm));

  // Anything on the recipe that the tagger didn't put there is yours.
  const mine = currentTags.filter((t) => !auto.has(norm(t)));
  const mineSet = new Set(mine.map(norm));

  const nextAuto = derived
    .map(norm)
    .filter((t) => !removed.has(t) && !mineSet.has(t));

  return {
    tags: [...mine, ...nextAuto],
    tagMeta: {
      auto: nextAuto,
      // Keep only removals that still refer to a tag the tagger can emit —
      // otherwise the list grows forever with stale free-form names.
      removed: [...removed].filter(isAutoTag),
    },
  };
}

/**
 * Record what an edit in the tag editor meant.
 *
 * Deleting an auto tag is a standing instruction ("not this one"), not a
 * one-off — so it is remembered. Typing a tag back in withdraws that
 * instruction and makes the tag yours.
 */
export function applyTagEdit(
  prevTags: readonly string[],
  nextTags: readonly string[],
  meta: TagMeta | undefined,
): TagMeta {
  const auto = new Set((meta?.auto ?? []).map(norm));
  const removed = new Set((meta?.removed ?? []).map(norm));
  const prev = new Set(prevTags.map(norm));
  const next = new Set(nextTags.map(norm));

  for (const t of prev) {
    if (!next.has(t) && auto.has(t)) {
      removed.add(t);
      auto.delete(t);
    }
  }
  for (const t of next) {
    if (!prev.has(t)) {
      // You typed it: it is yours now, and it is no longer refused.
      removed.delete(t);
      auto.delete(t);
    }
  }
  // Drop bookkeeping for tags that left the recipe entirely.
  for (const t of [...auto]) if (!next.has(t)) auto.delete(t);

  return { auto: [...auto], removed: [...removed].filter(isAutoTag) };
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export type SearchableRecipe = {
  title: string;
  tags: string[];
  ingredients: { canonicalName: string }[];
};

/**
 * Free-text search over the library.
 *
 * Every whitespace-separated term must match SOMETHING (title, a tag, or an
 * ingredient) — so "quick chicken" narrows instead of widening, which a single
 * substring test could not do. A `tag:` prefix restricts a term to tags, for
 * when an ingredient name and a tag collide.
 */
export function matchesQuery(r: SearchableRecipe, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const title = r.title.toLowerCase();
  const tags = r.tags.map((t) => t.toLowerCase());
  const ings = r.ingredients.map((i) => i.canonicalName.toLowerCase());

  return terms.every((raw) => {
    const tagOnly = raw.startsWith('tag:');
    const term = tagOnly ? raw.slice(4) : raw;
    if (!term) return true;
    if (tags.some((t) => t.includes(term))) return true;
    if (tagOnly) return false;
    return title.includes(term) || ings.some((i) => i.includes(term));
  });
}
