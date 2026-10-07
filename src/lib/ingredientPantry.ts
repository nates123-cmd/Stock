/**
 * Recipe ingredient ↔ pantry row bridge.
 *
 * Tapping an ingredient on a recipe lets you flag it low / out right there,
 * without walking to the Pantry tab and searching for the row. Two questions
 * have to be answered for that to be safe:
 *
 *  1. WHICH pantry row is this ingredient? Recipe names are qualified
 *     ("olive oil, EVOO", "kosher salt"); pantry names are plainer. We reuse
 *     the pantry's own matching (`looksLikeSameItem`, same rule the paste flow
 *     and shopping list use), preferring an exact match-key hit, then a
 *     staple, so "salt" lands on the always-have salt row and not a random
 *     "garlic salt".
 *  2. What if there is NO row? A recipe can name something the pantry has
 *     never tracked. Marking it out still has to land somewhere the shopping
 *     list reads (`pantryRestockLines` scans pantry status), so we create a
 *     minimal row: NOT a staple, no purchase history (we have not bought it,
 *     we are out of it), status set, so it surfaces as a restock line and
 *     the next paste merges into it.
 */
import type { Ingredient, PantryItem, PantryStatus } from '@/types';
import {
  categoryFor,
  defaultFreshnessDays,
  looksLikeSameItem,
  matchKey,
} from './pantry';

/** Find the pantry row an ingredient refers to, or undefined. */
export function pantryRowFor(
  ingredient: Pick<Ingredient, 'canonicalName'>,
  items: PantryItem[],
): PantryItem | undefined {
  const key = matchKey(ingredient.canonicalName);
  if (!key) return undefined;
  const exact = items.filter((p) => matchKey(p.canonicalName) === key);
  if (exact.length > 0) return exact.find((p) => p.isStaple) ?? exact[0];
  const loose = items.filter((p) => looksLikeSameItem(ingredient.canonicalName, p.canonicalName));
  if (loose.length === 0) return undefined;
  // Prefer the staple, then the shortest name (closest to the bare item).
  return (
    loose.find((p) => p.isStaple) ??
    [...loose].sort((a, b) => a.canonicalName.length - b.canonicalName.length)[0]
  );
}

/** Where a brand-new row lands, mirroring the paste flow's rule. */
function locationFor(name: string): PantryItem['location'] {
  const cat = categoryFor(name);
  if (cat === 'frozen') return 'freezer';
  if (cat === 'dairy' || cat === 'meat' || cat === 'produce') return 'fridge';
  return 'pantry';
}

/**
 * A pantry row for an ingredient the pantry has never seen, flagged with the
 * given status. Deliberately NOT a purchase: empty history, no expiry, so the
 * cycle estimator and freshness never read a "we're out" as a "we bought".
 */
export function newPantryRowFor(
  ingredient: Pick<Ingredient, 'canonicalName'>,
  status: PantryStatus,
  id: string,
  at = new Date(),
): PantryItem {
  const name = ingredient.canonicalName.split(',')[0]!.trim() || ingredient.canonicalName;
  return {
    id,
    canonicalName: name,
    location: locationFor(name),
    isStaple: false,
    acquiredAt: at,
    defaultFreshnessDays: defaultFreshnessDays(name),
    purchaseHistory: [],
    originalInstacartText: name,
    status,
    statusUpdatedAt: at,
  };
}

/** Pantry status an ingredient currently carries, 'fine' when untracked. */
export function ingredientPantryStatus(
  ingredient: Pick<Ingredient, 'canonicalName'>,
  items: PantryItem[],
): PantryStatus {
  return pantryRowFor(ingredient, items)?.status ?? 'fine';
}
