/**
 * Name → SKU, against a pinned per-store catalog.
 *
 * Shared by every store's quote provider so they can't drift: if Walmart and
 * Wegmans matched "fresh Italian parsley" by different rules, a comparison
 * between them would be measuring the matcher, not the stores.
 */

export type CatalogItem = { itemId: string; name: string; price: number };

export type MatchResult<T extends CatalogItem> = {
  product: T | null;
  /** 'alias' = hand-pinned SKU. 'name' = every core word present. */
  via: 'alias' | 'name' | 'none';
};

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Words that describe preparation or measurement rather than the product.
 * Left in, they poison a match: "1 cup grated parmesan" would demand a product
 * whose *name* contains "cup" and "grated".
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'into', 'plus', 'about',
  'fresh', 'freshly', 'large', 'small', 'medium', 'ripe', 'good', 'quality',
  'sliced', 'diced', 'chopped', 'minced', 'grated', 'shredded', 'crushed',
  'peeled', 'halved', 'quartered', 'trimmed', 'divided', 'drained', 'rinsed',
  'roughly', 'finely', 'thinly', 'coarsely', 'optional', 'taste', 'needed',
  'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'tablespoons', 'teaspoon',
  'teaspoons', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g',
  'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'litre', 'clove', 'cloves',
  'sprig', 'sprigs', 'bunch', 'head', 'stalk', 'stalks', 'wedge', 'wedges',
  'sheet', 'sheets', 'can', 'cans', 'jar', 'jars', 'package', 'pack', 'bag',
  'box', 'container', 'pinch', 'dash', 'handful', 'piece', 'pieces',
]);

/** The words that actually identify the product. */
export function coreTokens(query: string): string[] {
  return norm(query)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Resolve one query against a catalog.
 *
 * Requiring EVERY core token to appear is what stops the classic garbage match
 * (chickpeas → mandarin oranges). It costs recall, deliberately: a miss surfaces
 * as "this store doesn't carry it", which is exactly the answer we're trying to
 * produce. A confident wrong match is the failure that actually hurts — it puts
 * the wrong thing in a cart and hides a real gap.
 */
export function matchCatalog<T extends CatalogItem>(
  query: string,
  products: T[],
  aliases: Record<string, string>,
  byId: Record<string, T>,
): MatchResult<T> {
  const n = norm(query);
  if (!n) return { product: null, via: 'none' };

  const pinned = aliases[n];
  if (pinned && byId[pinned]) return { product: byId[pinned], via: 'alias' };

  const tokens = coreTokens(query);
  if (!tokens.length) return { product: null, via: 'none' };

  // Try aliases again on the de-stopworded form, so "fresh Italian parsley"
  // still finds the pin filed under "italian parsley".
  const stripped = tokens.join(' ');
  const pinned2 = aliases[stripped];
  if (pinned2 && byId[pinned2]) return { product: byId[pinned2], via: 'alias' };

  // Prefer the shortest name that contains every token — on a real catalog the
  // shortest match is the plain version of the thing ("Asparagus"), and longer
  // ones are variants that happen to include the word ("Asparagus Risotto Kit").
  let best: T | null = null;
  for (const p of products) {
    const hay = norm(p.name);
    if (!tokens.every((t) => hay.includes(t))) continue;
    if (!best || p.name.length < best.name.length) best = p;
  }
  return best ? { product: best, via: 'name' } : { product: null, via: 'none' };
}
