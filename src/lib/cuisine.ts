/**
 * Cuisine style — ONE value per recipe, auto-assigned, always overridable.
 *
 * Why a single field and not another tag:
 *   * A recipe has one cuisine in practice. Tags are a set, so "italian" and
 *     "thai" could both be on, and a filter built on that answers a question
 *     nobody asked.
 *   * The tag chips AND-together (see RecipeLibrary). Cuisines are mutually
 *     exclusive, so they must OR — "italian or thai", never "italian and thai".
 *     That is a different control, and modelling it as a tag would have made
 *     the obvious multi-select behave backwards.
 *   * It filters and groups cleanly: one column, one chip row, no ambiguity.
 *
 * Free-form tags are untouched by any of this. Cuisine sits alongside them.
 *
 * Derivation follows the same two rules as lib/recipeTags.ts, for the same
 * reasons: derive LOCALLY (deterministic, free, identical every run — a model
 * would re-label recipes differently between builds), and YOUR EDIT WINS
 * permanently (`cuisineAuto` marks a value as the machine's; once you set one
 * by hand the flag is gone and nothing here will ever touch it again).
 */
import { hasWord } from './recipeTags';

/** The closed vocabulary. `other` is a real, user-choosable answer. */
export const CUISINES = [
  'italian',
  'french',
  'spanish',
  'greek',
  'middle eastern',
  'north african',
  'indian',
  'thai',
  'vietnamese',
  'chinese',
  'japanese',
  'korean',
  'mexican',
  'latin american',
  'caribbean',
  'american',
  'british',
  'german',
  'eastern european',
  'other',
] as const;

export type Cuisine = (typeof CUISINES)[number];

const CUISINE_SET = new Set<string>(CUISINES);

/** Lowercase/trim/collapse — same normalization the tagger uses. */
export function normCuisine(c: string): string {
  return c.trim().toLowerCase().replace(/\s+/g, ' ');
}

export const isKnownCuisine = (c: string): boolean => CUISINE_SET.has(normCuisine(c));

/** Title case for display ("middle eastern" → "Middle Eastern"). */
export function cuisineLabel(c: string): string {
  return normCuisine(c)
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/* ------------------------------------------------------------------ *
 * Signals
 * ------------------------------------------------------------------ */

/**
 * Signature terms per cuisine. These are chosen to be DISCRIMINATING, not
 * merely typical: "onion" and "garlic" appear in almost every cuisine on this
 * list, so they earn nothing. A term is here only if seeing it meaningfully
 * shifts the answer.
 *
 * `strong` terms are close to decisive on their own (gochujang → korean).
 * `weak` terms only count in aggregate (parmesan alone is not Italian; parmesan
 * plus basil plus pancetta is).
 */
type Signals = { strong: readonly string[]; weak: readonly string[] };

const SIGNALS: Record<Exclude<Cuisine, 'other'>, Signals> = {
  italian: {
    strong: [
      'pasta', 'risotto', 'parmigiano', 'pancetta', 'guanciale', 'ricotta',
      'mozzarella', 'pecorino', 'polenta', 'gnocchi', 'prosciutto', 'marinara',
      'bolognese', 'carbonara', 'cacio e pepe', 'focaccia', 'pesto', 'burrata',
      'mascarpone', "n'duja", 'passata', 'spaghetti', 'rigatoni', 'orecchiette',
      'lasagna', 'lasagne', 'tagliatelle', 'pappardelle', 'bucatini', 'penne',
    ],
    weak: ['parmesan', 'basil', 'oregano', 'balsamic', 'olive oil', 'san marzano'],
  },
  french: {
    strong: [
      'creme fraiche', 'crème fraîche', 'beurre blanc', 'bearnaise', 'béarnaise',
      'hollandaise', 'ratatouille', 'cassoulet', 'confit', 'gruyere', 'gruyère',
      'baguette', 'roux', 'mirepoix', 'bouquet garni', 'dijon', 'tarragon',
      'puff pastry', 'brie', 'camembert', 'coq au vin', 'bouillabaisse',
      'clafoutis', 'quiche', 'creme brulee', 'crème brûlée',
    ],
    weak: ['white wine', 'butter', 'thyme', 'chervil', 'lardon', 'shallot'],
  },
  spanish: {
    strong: [
      'chorizo', 'paella', 'manchego', 'saffron', 'piquillo', 'romesco',
      'sherry vinegar', 'jamon', 'jamón', 'serrano ham', 'gazpacho', 'tortilla espanola',
      'pimenton', 'pimentón', 'smoked paprika', 'bomba rice', 'padron',
    ],
    weak: ['paprika', 'sherry', 'almond'],
  },
  greek: {
    strong: [
      'feta', 'tzatziki', 'phyllo', 'filo', 'orzo', 'kalamata', 'souvlaki',
      'spanakopita', 'moussaka', 'avgolemono', 'halloumi', 'greek yogurt',
    ],
    weak: ['oregano', 'lemon', 'dill', 'olive'],
  },
  'middle eastern': {
    strong: [
      'tahini', 'za\'atar', 'zaatar', 'sumac', 'pomegranate molasses', 'labneh',
      'freekeh', 'bulgur', 'baharat', 'hummus', 'falafel', 'shawarma', 'kibbeh',
      'muhammara', 'baba ganoush', 'halva', 'aleppo pepper', 'toum', 'fattoush',
      'tabbouleh', 'pita',
    ],
    weak: ['chickpea', 'cumin', 'parsley', 'mint', 'yogurt'],
  },
  'north african': {
    strong: [
      'harissa', 'ras el hanout', 'preserved lemon', 'couscous', 'tagine',
      'merguez', 'chermoula', 'shakshuka', 'msemen', 'argan',
    ],
    weak: ['cumin', 'coriander', 'cinnamon', 'apricot', 'olive'],
  },
  indian: {
    strong: [
      'garam masala', 'turmeric', 'ghee', 'paneer', 'masala', 'tandoori', 'dal',
      'dhal', 'naan', 'basmati', 'curry leaves', 'asafoetida', 'hing', 'chana',
      'tikka', 'korma', 'vindaloo', 'biryani', 'chaat', 'raita', 'amchur',
      'fenugreek', 'kasoori methi', 'mustard seeds',
    ],
    weak: ['coriander', 'cumin', 'ginger', 'chili powder', 'yogurt', 'lentil', 'cardamom'],
  },
  thai: {
    strong: [
      'fish sauce', 'lemongrass', 'galangal', 'kaffir lime', 'makrut', 'thai basil',
      'curry paste', 'pad thai', 'tom yum', 'palm sugar', 'tamarind', 'coconut milk',
      'bird\'s eye chili', 'green curry', 'red curry', 'massaman',
    ],
    weak: ['lime', 'cilantro', 'peanut', 'rice noodle'],
  },
  vietnamese: {
    strong: [
      'pho', 'phở', 'nuoc cham', 'banh mi', 'bánh mì', 'rice paper', 'vermicelli',
      'hoisin', 'star anise', 'vietnamese', 'bun cha', 'lemongrass',
    ],
    weak: ['fish sauce', 'cilantro', 'mint', 'lime', 'daikon'],
  },
  chinese: {
    // NOT 'soy sauce': it is in Chinese, Japanese and Korean cooking alike, so
    // treating it as near-decisive made every soy-ginger-scallion recipe read
    // as Chinese on the strength of a shared staple. It is a weak signal.
    strong: [
      'shaoxing', 'oyster sauce', 'hoisin', 'sichuan', 'szechuan',
      'doubanjiang', 'chinkiang', 'black vinegar', 'wok', 'bok choy', 'five spice',
      'dumpling', 'char siu', 'mapo', 'lo mein', 'chow mein', 'water chestnut',
      'wood ear', 'cornstarch slurry',
    ],
    weak: ['soy sauce', 'ginger', 'scallion', 'sesame oil', 'rice wine', 'white pepper'],
  },
  japanese: {
    strong: [
      'miso', 'dashi', 'mirin', 'nori', 'panko', 'wasabi', 'yuzu',
      'katsu', 'teriyaki', 'ramen', 'udon', 'soba', 'shiso', 'kombu', 'bonito',
      'tonkatsu', 'sushi', 'edamame', 'shichimi', 'furikake', 'tsuyu',
    ],
    // 'sake' is weak because it is also an ordinary English word ('for the
    // sake of'), which no amount of word-boundary matching can tell apart.
    weak: ['soy sauce', 'rice vinegar', 'sesame', 'scallion', 'sake'],
  },
  korean: {
    strong: [
      'gochujang', 'gochugaru', 'kimchi', 'doenjang', 'bulgogi', 'bibimbap',
      'tteok', 'perilla', 'ssamjang', 'japchae', 'korean',
    ],
    weak: ['sesame oil', 'soy sauce', 'scallion', 'garlic'],
  },
  mexican: {
    strong: [
      'tortilla', 'masa', 'chipotle', 'ancho', 'guajillo', 'poblano', 'jalapeno',
      'jalapeño', 'tomatillo', 'queso fresco', 'cotija', 'salsa verde', 'mole',
      'carnitas', 'al pastor', 'taco', 'enchilada', 'epazote', 'crema', 'adobo',
      'pico de gallo', 'elote',
    ],
    weak: ['lime', 'cilantro', 'cumin', 'avocado', 'black beans'],
  },
  'latin american': {
    strong: [
      'chimichurri', 'sofrito', 'plantain', 'yuca', 'arepa', 'empanada',
      'aji amarillo', 'ceviche', 'feijoada', 'chimichurri', 'malbec',
    ],
    weak: ['lime', 'cilantro', 'black beans', 'rice'],
  },
  caribbean: {
    strong: [
      'jerk', 'scotch bonnet', 'allspice', 'callaloo', 'ackee', 'coconut rice',
      'pimento', 'plantain', 'jamaican', 'trinidad',
    ],
    weak: ['thyme', 'lime', 'coconut milk', 'ginger'],
  },
  american: {
    strong: [
      'barbecue', 'bbq', 'buttermilk biscuit', 'grits', 'cornbread', 'mac and cheese',
      'meatloaf', 'clam chowder', 'jambalaya', 'gumbo', 'pumpkin pie', 'pastrami',
      'sloppy joe', 'burger', 'ranch dressing', 'brownie', 'pancakes', 'cheesesteak',
    ],
    weak: ['bacon', 'cheddar', 'maple syrup', 'brown sugar'],
  },
  british: {
    strong: [
      'shepherd\'s pie', 'cottage pie', 'toad in the hole', 'yorkshire pudding',
      'bangers and mash', 'scone', 'crumpet', 'treacle', 'digestive biscuit',
      'golden syrup', 'clotted cream', 'ploughman', 'trifle', 'bubble and squeak',
      'sticky toffee',
    ],
    weak: ['double cream', 'suet', 'malt vinegar', 'worcestershire'],
  },
  german: {
    strong: [
      'sauerkraut', 'bratwurst', 'spaetzle', 'spätzle', 'schnitzel', 'quark',
      'pretzel', 'rye bread', 'kartoffel', 'strudel', 'lebkuchen',
    ],
    weak: ['caraway', 'mustard', 'juniper', 'pork'],
  },
  'eastern european': {
    strong: [
      'pierogi', 'borscht', 'kielbasa', 'smetana', 'kasha', 'goulash', 'paprikash',
      'blini', 'stroganoff', 'cabbage roll', 'golabki', 'horseradish',
    ],
    weak: ['sour cream', 'dill', 'beet', 'caraway'],
  },
};

const STRONG_WEIGHT = 3;
const WEAK_WEIGHT = 1;

/**
 * Minimum score to claim a cuisine at all.
 *
 * One strong hit is enough (gochujang really does mean Korean); a pile of weak
 * ones is not, because weak terms are shared across half this list. Below the
 * bar the answer is "no idea", left as undefined — an unlabelled recipe is
 * honest, a wrongly-labelled one is a filter that hides food.
 *
 * The score alone does NOT express that rule: three weak hits also reach
 * STRONG_WEIGHT, which is how a graham-cracker streusel scored German off
 * caraway + mustard + pork with nothing German about it. So a strong hit is
 * required outright, and the score is the second gate.
 */
const MIN_SCORE = STRONG_WEIGHT;

/**
 * Beating the runner-up by less than this means the evidence didn't actually
 * pick one. "Soy sauce + ginger + scallion" is Chinese, Japanese and Korean at
 * once; guessing between them is worse than leaving it blank.
 */
const MIN_MARGIN = 2;

/** The slice of a recipe the deriver reads. */
export type CuisineInput = {
  title?: string;
  ingredients: { canonicalName: string }[];
  steps: { title?: string; body?: string }[];
  tags?: string[];
};

function haystack(r: CuisineInput): string {
  return [
    r.title ?? '',
    ...(r.tags ?? []),
    ...r.ingredients.map((i) => i.canonicalName),
    ...r.steps.map((s) => `${s.title ?? ''} ${s.body ?? ''}`),
  ]
    .join(' \n ')
    .toLowerCase();
}

/**
 * The cuisine this recipe reads as, or undefined when the evidence is thin or
 * split. Pure and deterministic — same recipe, same answer, every run.
 *
 * A tag you typed that IS a cuisine name wins outright: writing "thai" on a
 * recipe is a clearer statement of intent than any keyword count.
 */
export function deriveCuisine(r: CuisineInput): Cuisine | undefined {
  for (const t of r.tags ?? []) {
    const n = normCuisine(t);
    if (n !== 'other' && CUISINE_SET.has(n)) return n as Cuisine;
  }

  const text = haystack(r);
  if (!text.trim()) return undefined;

  const scores: { cuisine: Cuisine; score: number }[] = [];
  for (const [cuisine, sig] of Object.entries(SIGNALS)) {
    let score = 0;
    let strongHits = 0;
    // WHOLE WORDS, never substrings — see hasWord's note in recipeTags.ts.
    for (const term of sig.strong) {
      if (hasWord(text, term)) {
        score += STRONG_WEIGHT;
        strongHits++;
      }
    }
    for (const term of sig.weak) if (hasWord(text, term)) score += WEAK_WEIGHT;
    // No signature term, no claim — however many shared staples turned up.
    if (strongHits === 0) continue;
    if (score > 0) scores.push({ cuisine: cuisine as Cuisine, score });
  }
  if (scores.length === 0) return undefined;

  // Stable ordering: score desc, then vocabulary order, so ties never flip
  // between runs on the same library.
  scores.sort(
    (a, b) =>
      b.score - a.score || CUISINES.indexOf(a.cuisine) - CUISINES.indexOf(b.cuisine),
  );
  const top = scores[0]!;
  if (top.score < MIN_SCORE) return undefined;
  const runnerUp = scores[1]?.score ?? 0;
  if (top.score - runnerUp < MIN_MARGIN) return undefined;
  return top.cuisine;
}

/* ------------------------------------------------------------------ *
 * Reconciling with your edits
 * ------------------------------------------------------------------ */

/** The cuisine fields on a recipe. */
export type CuisineFields = {
  cuisine?: string;
  /** True only while the value is the deriver's. Cleared by any manual set. */
  cuisineAuto?: true;
};

/**
 * What a recipe's cuisine should be after a fresh derivation.
 *
 * Returns `null` when nothing should change — the common case, so callers can
 * skip the write entirely and a boot-time backfill over a full library costs
 * nothing after the first pass.
 *
 * The one rule: a value you set by hand is never touched. An auto value may be
 * corrected (you edited the ingredients and it reads differently now) or
 * cleared (the evidence went away).
 */
export function reconcileCuisine(current: CuisineFields, derived: Cuisine | undefined): CuisineFields | null {
  const isAuto = current.cuisineAuto === true;
  const hasManual = current.cuisine != null && !isAuto;
  if (hasManual) return null;

  if (!derived) {
    // Nothing derivable. Drop a stale auto value; leave an absent one absent.
    if (current.cuisine == null) return null;
    return {};
  }
  if (isAuto && normCuisine(current.cuisine ?? '') === derived) return null;
  if (current.cuisine == null || isAuto) return { cuisine: derived, cuisineAuto: true };
  return null;
}

/**
 * Record a manual choice. Passing undefined clears the field back to "no
 * cuisine" AND leaves it manual-free, so the deriver may fill it again — which
 * is what "clear" should mean. Choosing `other` is a positive statement and
 * stays put.
 */
export function setCuisineManually(value: string | undefined): CuisineFields {
  if (!value) return {};
  return { cuisine: normCuisine(value) };
}
