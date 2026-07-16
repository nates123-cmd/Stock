/**
 * Pantry domain logic — spec §10. "The pantry is math, not inventory": Stock
 * never asks you to count things. It infers freshness from acquisition date +
 * a category heuristic, learns restock cycles from purchase history, and
 * resolves canonical names so a plan can subtract "what you have".
 *
 * All pure functions — no store, no I/O — so they're trivially testable and
 * reused by both the list screen and the paste flow.
 */
import type { Ingredient, PantryItem, ShoppingCategory } from '@/types';
import { monthShort } from '@/lib/format';

const DAY = 86_400_000;

/* ---------- category + freshness heuristic ---------- */

/**
 * Keyword → category. Same vocabulary the shopping list uses (spec §4
 * ShoppingCategory) so paste-flow chips and freshness stay consistent.
 */
const CATEGORY_KEYWORDS: [ShoppingCategory, RegExp][] = [
  ['produce', /\b(lemon|lime|onion|garlic|potato|tomato|herb|basil|cilantro|parsley|spinach|kale|lettuce|carrot|celery|pepper|apple|berry|berries|raspberr|banana|avocado|ginger|scallion|shallot|mushroom|cucumber|zucchini|broccoli|greens?)\b/i],
  ['dairy', /\b(milk|cream|butter|yogurt|cheese|parmesan|mozzarella|egg|eggs|kefir|crème|creme)\b/i],
  ['meat', /\b(chicken|beef|pork|lamb|turkey|bacon|sausage|fish|salmon|shrimp|thigh|breast|mince|ground)\b/i],
  ['bakery', /\b(bread|loaf|baguette|bun|roll|tortilla|pita|bagel|brioche)\b/i],
  ['frozen', /\b(frozen|ice cream|peas|edamame)\b/i],
  ['pantry', /\b(flour|sugar|rice|pasta|oil|vinegar|salt|yeast|baking|stock|broth|sauce|bean|lentil|spice|honey|syrup|can|tinned|oats?|nut|seed|tea|coffee)\b/i],
];

export function categoryFor(canonicalName: string): ShoppingCategory {
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(canonicalName)) return cat;
  return 'other';
}

/** Heuristic shelf life by category (spec §10 "defaultFreshnessDays"). */
const FRESHNESS_DAYS: Record<ShoppingCategory, number> = {
  produce: 7,
  dairy: 14,
  meat: 4,
  bakery: 5,
  frozen: 120,
  pantry: 365,
  other: 30,
};

export function defaultFreshnessDays(canonicalName: string): number {
  return FRESHNESS_DAYS[categoryFor(canonicalName)];
}

export function computeExpiry(acquiredAt: Date, freshnessDays: number): Date {
  return new Date(acquiredAt.getTime() + freshnessDays * DAY);
}

/* ---------- recently-added window + freshness status ---------- */

/** 12–14 day window after a paste (spec §10 "Recently added"). */
export const RECENTLY_ADDED_WINDOW_DAYS = 13;

export type FreshnessStatus = 'fresh' | 'aging' | 'wilting';

/**
 * Age vs. the item's own freshness budget. Staples and long-life pantry goods
 * never "wilt" — the warning is for perishables only (spec §10).
 */
export function freshnessStatus(item: PantryItem, now = new Date()): FreshnessStatus {
  if (item.isStaple) return 'fresh';
  if (item.location === 'freezer') return 'fresh'; // freezing pauses the clock
  const ageDays = (now.getTime() - item.acquiredAt.getTime()) / DAY;
  const budget = item.defaultFreshnessDays;
  if (budget >= 90) return 'fresh'; // long-life pantry goods — don't nag
  if (ageDays >= budget) return 'wilting';
  if (ageDays >= budget * 0.7) return 'aging';
  return 'fresh';
}

export function isRecentlyAdded(item: PantryItem, now = new Date()): boolean {
  const ageDays = (now.getTime() - item.acquiredAt.getTime()) / DAY;
  return ageDays <= RECENTLY_ADDED_WINDOW_DAYS;
}

/* ---------- cycle learning (spec §10 "Cycle learning") ---------- */

function intervalsDays(history: Date[]): number[] {
  const sorted = [...history].map((d) => d.getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i]! - sorted[i - 1]!) / DAY);
  }
  return gaps;
}

/**
 * Average days between purchases — only meaningful after 3+ purchases (≥2
 * intervals). Returns undefined below that threshold (spec §10).
 */
export function cycleEstimateDays(history: Date[]): number | undefined {
  const gaps = intervalsDays(history);
  if (gaps.length < 2) return undefined;
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  return Math.round(avg);
}

/** Stable if the last 3 cycles are all within ±20% of their mean (spec §10). */
export function isCycleStable(history: Date[]): boolean {
  const gaps = intervalsDays(history);
  if (gaps.length < 3) return false;
  const last3 = gaps.slice(-3);
  const mean = last3.reduce((s, g) => s + g, 0) / last3.length;
  if (mean <= 0) return false;
  return last3.every((g) => Math.abs(g - mean) / mean <= 0.2);
}

/* ---------- canonical-name coverage (the "have it" indicator) ---------- */

/**
 * Reduce a canonicalName to its match key: drop the qualifier after the first
 * comma ("olive oil, EVOO" → "olive oil"), lowercase, collapse whitespace.
 * Pantry items match recipe ingredients on this key (spec §10).
 */
export function matchKey(canonicalName: string): string {
  return canonicalName.split(',')[0]!.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Base ingredient for "always have" matching: the head noun (last word) of the
 * match key. English ingredient names put the modifier first, so the head noun
 * is the staple — "fine sea salt", "kosher salt" and "salt, to taste" all
 * reduce to "salt". This lets one always-have pin suppress every variant of a
 * staple, instead of matching the exact qualified name only.
 */
export function baseIngredient(canonicalName: string): string {
  const mk = matchKey(canonicalName);
  const words = mk.split(' ');
  return words[words.length - 1] || mk;
}

export function coverageSet(items: PantryItem[]): Set<string> {
  return new Set(items.map((i) => matchKey(i.canonicalName)));
}

function keyedHit(key: string, have: Set<string>): boolean {
  if (have.has(key)) return true;
  // tolerate "lemon" vs "lemons" and head-noun containment both directions
  for (const h of have) {
    if (h === key) return true;
    if (h.startsWith(key) || key.startsWith(h)) return true;
  }
  return false;
}

export function hasInPantry(canonicalName: string, have: Set<string>): boolean {
  return keyedHit(matchKey(canonicalName), have);
}

export type RecipeCoverage = { have: number; total: number; missing: string[] };

/** How much of a recipe the pantry already covers (spec §10 "have it"). */
export function recipeCoverage(
  ingredients: Pick<Ingredient, 'canonicalName'>[],
  pantry: PantryItem[],
): RecipeCoverage {
  const have = coverageSet(pantry);
  const missing: string[] = [];
  let n = 0;
  for (const ing of ingredients) {
    if (hasInPantry(ing.canonicalName, have)) n++;
    else missing.push(ing.canonicalName);
  }
  return { have: n, total: ingredients.length, missing };
}

/** A recipe is "have it" when the pantry covers all but at most one item. */
export function canMakeNow(cov: RecipeCoverage): boolean {
  return cov.total > 0 && cov.total - cov.have <= 1;
}

/**
 * Refine a freshly-parsed item's tag against the current pantry (spec §10
 * review screen): the parser only knows "sub" vs "new"; whether a "new" line
 * is actually a restock — or a staple top-up — depends on what's on hand.
 */
export type PasteTag = 'restock' | 'staple' | 'sub' | 'new';

export function tagAgainstPantry(
  canonicalName: string,
  parsedTag: PasteTag,
  pantry: PantryItem[],
): PasteTag {
  if (parsedTag === 'sub') return 'sub';
  const key = matchKey(canonicalName);
  const hit = pantry.find((p) => {
    const pk = matchKey(p.canonicalName);
    return pk === key || pk.startsWith(key) || key.startsWith(pk);
  });
  if (!hit) return 'new';
  return hit.isStaple ? 'staple' : 'restock';
}

/* ---------- display helpers (mono numerics, spec §2) ---------- */

/** 42 → "~6w", 9 → "~9d", 410 → "~14m" (months). */
export function formatCycle(days?: number): string | null {
  if (!days || days <= 0) return null;
  if (days < 14) return `~${days}d`;
  if (days < 60) return `~${Math.round(days / 7)}w`;
  return `~${Math.round(days / 30)}mo`;
}

/** "May 11" — acquisition / last-order dates. */
export function shortDate(date: Date): string {
  return `${monthShort(date)} ${date.getDate()}`;
}

/**
 * Do two shopping/ingredient names refer to the same thing? Loose but guarded —
 * shared by the shopping-list combine and the build wizard's combine step:
 *  - prefix either way → "shallot"/"shallots", "basil"/"basil leaves",
 *    "halloumi"/"halloumi cheese"
 *  - same head-noun when one side is a single word → "chickpeas"/"cooked
 *    chickpeas". The single-word guard stops "olive oil" merging "sesame oil".
 */
export function looksLikeSameItem(a: string, b: string): boolean {
  const ka = matchKey(a);
  const kb = matchKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.startsWith(kb) || kb.startsWith(ka)) return true;
  const oneIsPlain = ka.split(' ').length === 1 || kb.split(' ').length === 1;
  return oneIsPlain && baseIngredient(a) === baseIngredient(b);
}
