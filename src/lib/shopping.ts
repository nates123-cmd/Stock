/**
 * Shopping-list consolidation — spec §5.
 *
 * Two tiers:
 *  - consolidateSmart(): Claude merges lines that refer to the same
 *    purchasable item (synonyms + prep words), estimates a buy quantity, and
 *    shows the math. Falls back to a deterministic local merge when Claude is
 *    unavailable/errors — same graceful-degrade contract as recipe parsing.
 *  - consolidate() (legacy): exact-canonical-name sum. Kept as a primitive.
 *
 * Pantry subtraction is still null until the Pantry pillar (spec §10).
 */
import type { Recipe, ShoppingCategory } from '@/types';
import { CLAUDE_AVAILABLE, claudeText } from '@/lib/api/claudeBridge';

export type AggItem = {
  canonicalName: string;
  category: ShoppingCategory;
  /** per-unit totals (units aren't cross-converted in v1; Bench owns that §9) */
  totals: { amount: number; unit: string }[];
  from: { recipe: string; amount: number | null; unit: string | null }[];
};

const KEYWORDS: [ShoppingCategory, RegExp][] = [
  ['produce', /lemon|lime|onion|garlic|potato|tomato|herb|cilantro|parsley|basil|mint|ginger|cucumber|daikon|radish|carrot|pepper|lettuce|arugula|spinach|scallion|apple|berry|avocado|mushroom/i],
  ['meat', /chicken|beef|pork|lamb|fish|salmon|shrimp|bacon|sausage|turkey|thigh|breast/i],
  ['dairy', /milk|butter|cheese|cream|yogurt|egg|feta|parmesan|mozzarella/i],
  ['bakery', /bread|flour|yeast|loaf|tortilla|bun|baguette/i],
  ['frozen', /frozen|ice cream|pea\b/i],
  ['pantry', /oil|vinegar|salt|sugar|rice|farro|pasta|sauce|stock|broth|spice|soy|honey|cider|can\b|bean|lentil|sesame|pistachio|nut|almond|walnut/i],
];

export function categorizeIngredient(name: string): ShoppingCategory {
  for (const [cat, re] of KEYWORDS) if (re.test(name)) return cat;
  return 'other';
}

export const CATEGORY_ORDER: ShoppingCategory[] = [
  'produce', 'meat', 'dairy', 'bakery', 'pantry', 'frozen', 'other',
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtQty = (a: number | null, u: string | null) =>
  a == null ? 'some' : u && u !== 'pc' ? `${a} ${u}` : `×${a}`;

/* ------------------------------------------------------------------ */
/* Smart consolidation                                                 */
/* ------------------------------------------------------------------ */

export type ShoppingSource = {
  recipe: string;
  /** original ingredient phrasing (falls back to canonical name) */
  text: string;
  amount: number | null;
  unit: string | null;
};

export type ShoppingLine = {
  /** what you actually buy: "lemons", "mint", "pistachios" */
  name: string;
  category: ShoppingCategory;
  /** human purchase quantity: "3–5 lemons", "a bunch", "about 250 g" */
  buy: string;
  /** one line showing how `buy` was derived from the sources */
  math: string;
  /** every recipe line that rolled into this — the receipts */
  sources: ShoppingSource[];
  confidence: 'estimated' | 'summed';
};

type RawLine = ShoppingSource & { idx: number; name: string };

/** Flatten a week's recipes into stable, indexed ingredient lines. */
function gatherLines(recipes: Recipe[]): RawLine[] {
  const out: (ShoppingSource & { name: string })[] = [];
  for (const r of recipes)
    for (const ing of r.ingredients)
      out.push({
        recipe: r.title,
        name: ing.canonicalName,
        text: ing.originalText?.trim() || ing.canonicalName,
        amount: ing.amount,
        unit: ing.unit,
      });
  // Stable order → deterministic Claude input → cache hits (spec §11).
  out.sort((a, b) => a.name.localeCompare(b.name) || a.recipe.localeCompare(b.recipe));
  return out.map((l, idx) => ({ ...l, idx }));
}

const CATS = new Set<string>(CATEGORY_ORDER);
const byCategoryThenName = (a: ShoppingLine, b: ShoppingLine) =>
  CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
  a.name.localeCompare(b.name);

const SYSTEM = `You consolidate a week's recipe ingredients into a grocery
buy-list. MERGE every line that refers to the same purchasable item:
- ignore prep/state words (chopped, minced, fresh, loosely packed, torn,
  thinly sliced, shaved, grated, ripe, medium, to taste, divided, for serving)
- the juice OR zest of a fruit, or "X, juiced", means you buy the fruit X
- merge synonyms ("salted pistachios" = "chopped pistachio nuts" =
  "pistachios"; "loosely packed mint leaves" = "mint leaves")
- do NOT merge genuinely different items (parsley vs basil vs mint)
For each merged item output:
  name     what you'd buy, simple and plural ("lemons", "mint", "pistachios")
  category one of: produce, meat, dairy, bakery, pantry, frozen, other
  buy      a short human purchase quantity ("3-5 lemons", "a bunch",
           "about 250 g", "1 bag"); a range is good when estimating
  math     ONE short line showing how "buy" follows from the source amounts
           (e.g. "2 tbsp juice ~= 1 lemon, + 1 whole, + zest of 1 -> ~3")
  sources  the [n] indexes of EVERY input line that rolled into this item
STRICT JSON, no prose, no markdown.
Schema: {"items":[{"name":string,"category":string,"buy":string,"math":string,"sources":number[]}]}
Output ONLY the JSON object.`;

function buildInput(lines: RawLine[]): string {
  return lines
    .map(
      (l) =>
        `[${l.idx}] ${fmtQty(l.amount, l.unit)} ${l.name}` +
        (l.text && l.text !== l.name ? ` — "${l.text}"` : '') +
        ` (from ${l.recipe})`,
    )
    .join('\n');
}

type RawItem = {
  name?: string;
  category?: string;
  buy?: string;
  math?: string;
  sources?: number[];
};

function parseItems(out: string, lines: RawLine[]): ShoppingLine[] {
  const cleaned = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('no JSON in model output');
  const obj = JSON.parse(cleaned.slice(s, e + 1)) as { items?: RawItem[] };
  if (!Array.isArray(obj.items)) throw new Error('no items array');

  return obj.items
    .map((it): ShoppingLine | null => {
      const name = (it.name ?? '').trim();
      if (!name) return null;
      const sources = (it.sources ?? [])
        .map((i) => lines[i])
        .filter((l): l is RawLine => !!l)
        .map((l) => ({ recipe: l.recipe, text: l.text, amount: l.amount, unit: l.unit }));
      const category =
        it.category && CATS.has(it.category)
          ? (it.category as ShoppingCategory)
          : categorizeIngredient(name);
      return {
        name,
        category,
        buy: (it.buy ?? '').trim() || 'as needed',
        math: (it.math ?? '').trim(),
        sources,
        confidence: 'estimated',
      };
    })
    .filter((x): x is ShoppingLine => !!x)
    .sort(byCategoryThenName);
}

/** Synchronous local merge — instant render before Claude resolves. */
export function consolidateLocalSmart(recipes: Recipe[]): ShoppingLine[] {
  return localConsolidateSmart(gatherLines(recipes));
}

/**
 * Consolidate a week's recipes into a fuzzy, estimated buy-list. Claude when
 * available, deterministic local merge otherwise.
 */
export async function consolidateSmart(recipes: Recipe[]): Promise<ShoppingLine[]> {
  const lines = gatherLines(recipes);
  if (lines.length === 0) return [];
  if (CLAUDE_AVAILABLE) {
    try {
      const out = await claudeText('shopping-consolidate', SYSTEM, buildInput(lines));
      const items = parseItems(out, lines);
      if (items.length) return items;
    } catch (err) {
      console.warn('[stock] Claude consolidation failed, local fallback', err);
    }
  }
  return localConsolidateSmart(lines);
}

/* ------------------------------------------------------------------ */
/* Local fuzzy fallback                                                 */
/* ------------------------------------------------------------------ */

const PREP =
  /\b(chopped|minced|diced|sliced|thinly|thickly|finely|roughly|freshly|fresh|loosely|packed|torn|shaved|grated|ground|whole|ripe|large|medium|small|halved|quartered|peeled|seeded|pitted|drained|rinsed|cooked|raw|toasted|salted|unsalted|roasted|crushed|softened|melted|cold|warm|plus|more|as|needed|to|taste|for|serving|garnish|divided|optional)\b/g;

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (w.endsWith('ss')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** Reduce an ingredient name to a coarse buy key ("fresh lemon juice"→"lemon"). */
function baseKey(name: string): string {
  let s = (name.toLowerCase().split(',')[0] ?? '').replace(/\([^)]*\)/g, ' ');
  s = s
    .replace(/\bjuice of\b|\bzest of\b/g, ' ')
    .replace(/\b([a-z]+)\s+(juice|zest)\b/g, '$1') // "lemon juice" -> "lemon"
    .replace(/\bor\b[\s\S]*$/g, ' ') // "parsley or basil" -> "parsley"
    .replace(PREP, ' ')
    .replace(/\bnuts?\b|\bleaves\b|\bleaf\b|\bsprigs?\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.split(' ').filter(Boolean).map(singular).join(' ');
  return s || name.toLowerCase();
}

function localConsolidateSmart(lines: RawLine[]): ShoppingLine[] {
  const groups = new Map<string, RawLine[]>();
  for (const l of lines) {
    const k = baseKey(l.name);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(l);
  }

  const out: ShoppingLine[] = [];
  for (const [key, ls] of groups) {
    const name = ls.length > 1 ? key : (ls[0]?.name ?? key);
    let count = 0;
    const units = new Map<string, number>();
    for (const l of ls) {
      if (l.amount == null) continue;
      if (!l.unit || l.unit === 'pc') count += l.amount;
      else units.set(l.unit, (units.get(l.unit) ?? 0) + l.amount);
    }
    const parts: string[] = [];
    if (count > 0) parts.push(`${Math.ceil(count)} ${name}`);
    for (const [u, a] of units) parts.push(`${+a.toFixed(2)} ${u}`);
    const buy = parts.join(' + ') || 'as needed';
    const math = ls
      .map((l) => `${fmtQty(l.amount, l.unit)} ${l.name} (${l.recipe})`)
      .join(' + ');
    out.push({
      name,
      category: categorizeIngredient(name),
      buy,
      math,
      sources: ls.map((l) => ({
        recipe: l.recipe,
        text: l.text,
        amount: l.amount,
        unit: l.unit,
      })),
      confidence: 'summed',
    });
  }
  return out.sort(byCategoryThenName);
}

/* ------------------------------------------------------------------ */
/* Legacy exact-name primitives (still used as building blocks)         */
/* ------------------------------------------------------------------ */

/** Aggregate planned recipes → items grouped/summed by canonical name. */
export function consolidate(recipes: Recipe[]): AggItem[] {
  const byName = new Map<string, AggItem>();
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      const key = ing.canonicalName.toLowerCase();
      let item = byName.get(key);
      if (!item) {
        item = {
          canonicalName: ing.canonicalName,
          category: categorizeIngredient(ing.canonicalName),
          totals: [],
          from: [],
        };
        byName.set(key, item);
      }
      item.from.push({ recipe: r.title, amount: ing.amount, unit: ing.unit });
      if (ing.amount != null) {
        const u = ing.unit ?? 'pc';
        const t = item.totals.find((x) => x.unit === u);
        if (t) t.amount += ing.amount;
        else item.totals.push({ amount: ing.amount, unit: u });
      }
    }
  }
  return [...byName.values()].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.canonicalName.localeCompare(b.canonicalName),
  );
}

/** "200g" / "× 6" quantity string for an item. */
export function quantityLabel(item: AggItem): string {
  if (item.totals.length === 0) return 'to taste';
  return item.totals
    .map((t) => (t.unit === 'pc' ? `× ${t.amount}` : `${t.amount}${t.unit}`))
    .join(' + ');
}

/** "chicken & lemon (8) + sushi rice (2)" provenance line (spec §5). */
export function breakdownLabel(item: AggItem): string {
  return item.from
    .map((f) => `${f.recipe} (${f.amount ?? '—'}${f.unit ?? ''})`)
    .join(' + ');
}

/** Instacart paste text (spec §5 "Copy for Instacart"). */
export function instacartText(lines: ShoppingLine[]): string {
  return lines
    .map((l) => `${cap(l.name)}${l.buy && l.buy !== 'as needed' ? `, ${l.buy}` : ''}`)
    .join('\n');
}
