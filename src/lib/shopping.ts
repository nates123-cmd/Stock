/**
 * Shopping-list consolidation — spec §5. Sums a week's pinned recipes into a
 * categorized buy list. Pantry subtraction is null until the Pantry pillar
 * (spec §10) — `pantryHas` stays null, `toBuy` == `totalNeeded`.
 */
import type { Recipe, ShoppingCategory } from '@/types';

export type AggItem = {
  canonicalName: string;
  category: ShoppingCategory;
  /** per-unit totals (units aren't cross-converted in v1; Bench owns that §9) */
  totals: { amount: number; unit: string }[];
  from: { recipe: string; amount: number | null; unit: string | null }[];
};

const KEYWORDS: [ShoppingCategory, RegExp][] = [
  ['produce', /lemon|onion|garlic|potato|tomato|herb|cilantro|parsley|ginger|cucumber|daikon|carrot|pepper|lettuce|spinach|scallion|lime|apple|berry|avocado|mushroom/i],
  ['meat', /chicken|beef|pork|lamb|fish|salmon|shrimp|bacon|sausage|turkey|thigh|breast/i],
  ['dairy', /milk|butter|cheese|cream|yogurt|egg|feta|parmesan|mozzarella/i],
  ['bakery', /bread|flour|yeast|loaf|tortilla|bun|baguette/i],
  ['frozen', /frozen|ice cream|pea\b/i],
  ['pantry', /oil|vinegar|salt|sugar|rice|pasta|sauce|stock|broth|spice|soy|honey|can\b|bean|lentil|sesame/i],
];

export function categorizeIngredient(name: string): ShoppingCategory {
  for (const [cat, re] of KEYWORDS) if (re.test(name)) return cat;
  return 'other';
}

export const CATEGORY_ORDER: ShoppingCategory[] = [
  'produce', 'meat', 'dairy', 'bakery', 'pantry', 'frozen', 'other',
];

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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
export function instacartText(items: AggItem[]): string {
  return items
    .map((it) => {
      const name = cap(it.canonicalName);
      if (it.totals.length === 0) return name;
      const q = it.totals
        .map((t) => (t.unit === 'pc' ? `× ${t.amount}` : `${t.amount}${t.unit}`))
        .join(' + ');
      return q.startsWith('×') ? `${name} ${q}` : `${name}, ${q}`;
    })
    .join('\n');
}
