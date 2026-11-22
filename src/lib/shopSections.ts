/**
 * Store sections — the order you WALK a grocery store.
 *
 * Shopping mode groups the list by these so you finish Produce before you move
 * on, instead of zig-zagging back for the lemon you missed.
 *
 * The guess is built on the pantry's shelf categorizer, not on
 * `categorizeIngredient` in lib/shopping.ts. That one matches plain substrings,
 * so "peanut butter" and "coconut milk" land in Dairy and "eggplant" matches
 * `egg` — the same bug class as chamomile tea filing under Meat. The pantry
 * categorizer is word-boundary anchored and already has tests; a section is
 * just a walk-ordered regrouping of its shelf categories, plus Household for
 * the non-food things a grocery run picks up.
 *
 * One generic walk order for now. A per-store order can replace SECTION_ORDER
 * later without touching anything else.
 */
import { categorizePantryItem, hasPhrase, type PantryCategory } from './pantryCategories';
import type { PantryLocation } from '@/types';

export type ShopSection =
  | 'produce'
  | 'meat'
  | 'dairy'
  | 'bakery'
  | 'grains'
  | 'canned'
  | 'condiments'
  | 'spices'
  | 'snacks'
  | 'drinks'
  | 'frozen'
  | 'household'
  | 'other';

/** Walk order. Frozen sits late on purpose: it is the last cold thing in the
 *  cart, so it spends the least time melting. */
export const SECTION_ORDER: ShopSection[] = [
  'produce',
  'meat',
  'dairy',
  'bakery',
  'grains',
  'canned',
  'condiments',
  'spices',
  'snacks',
  'drinks',
  'frozen',
  'household',
  'other',
];

export const SECTION_LABEL: Record<ShopSection, string> = {
  produce: 'Produce',
  meat: 'Meat & fish',
  dairy: 'Dairy & eggs',
  bakery: 'Bakery',
  grains: 'Pasta, rice & grains',
  canned: 'Canned & jarred',
  condiments: 'Oils, sauces & condiments',
  spices: 'Spices & baking',
  snacks: 'Snacks',
  drinks: 'Drinks',
  frozen: 'Frozen',
  household: 'Household',
  other: 'Other',
};

const FROM_PANTRY: Record<PantryCategory, ShopSection> = {
  produce: 'produce',
  meat: 'meat',
  dairy: 'dairy',
  bakery: 'bakery',
  grains: 'grains',
  canned: 'canned',
  oils: 'condiments',
  condiments: 'condiments',
  spices: 'spices',
  baking: 'spices',
  snacks: 'snacks',
  drinks: 'drinks',
  frozen: 'frozen',
  other: 'other',
};

/** Non-food. Checked BEFORE the food rules: "dish soap" must not reach a food
 *  keyword, and "parchment paper" has none to reach. */
const HOUSEHOLD = [
  'paper towel', 'toilet paper', 'tissue', 'napkin', 'trash bag', 'garbage bag',
  'aluminum foil', 'tin foil', 'foil', 'plastic wrap', 'cling film', 'parchment',
  'wax paper', 'ziploc', 'zip bag', 'freezer bag', 'sandwich bag', 'sponge',
  'dish soap', 'dishwasher', 'detergent', 'hand soap', 'soap', 'shampoo',
  'conditioner', 'toothpaste', 'toothbrush', 'floss', 'deodorant', 'cleaner',
  'bleach', 'disinfectant', 'wipe', 'battery', 'batteries', 'light bulb',
  'laundry', 'dryer sheet', 'candle', 'matches', 'charcoal', 'propane',
];

export function isShopSection(v: unknown): v is ShopSection {
  return typeof v === 'string' && (SECTION_ORDER as string[]).includes(v);
}

/**
 * Which section an item is in. A section you picked by hand always wins over
 * the guess — no keyword list is ever right 100% of the time, and the fix
 * should only have to be made once.
 */
export function sectionFor(name: string, override?: ShopSection | null): ShopSection {
  if (override && isShopSection(override)) return override;
  const n = name.toLowerCase().trim();
  for (const w of HOUSEHOLD) if (hasPhrase(n, w)) return 'household';
  return FROM_PANTRY[categorizePantryItem(n)];
}

/** Where a bought item most likely goes when it gets home. */
export function locationForSection(section: ShopSection): PantryLocation {
  if (section === 'frozen') return 'freezer';
  if (section === 'produce' || section === 'meat' || section === 'dairy') return 'fridge';
  return 'pantry';
}

export type SectionGroup<T> = { section: ShopSection; label: string; rows: T[] };

/**
 * Bucket rows into sections, in walk order, dropping empty ones. Order WITHIN a
 * section is the order the rows arrived in.
 */
export function groupBySection<T>(
  rows: T[],
  sectionOf: (row: T) => ShopSection,
): SectionGroup<T>[] {
  const buckets = new Map<ShopSection, T[]>();
  for (const r of rows) {
    const s = sectionOf(r);
    const b = buckets.get(s);
    if (b) b.push(r);
    else buckets.set(s, [r]);
  }
  return SECTION_ORDER.filter((s) => buckets.has(s)).map((s) => ({
    section: s,
    label: SECTION_LABEL[s],
    rows: buckets.get(s)!,
  }));
}

/** Still-to-get first, got ones sunk to the bottom. Stable either side. */
export function sinkGot<T>(rows: T[], isGot: (row: T) => boolean): T[] {
  return [...rows.filter((r) => !isGot(r)), ...rows.filter(isGot)];
}
