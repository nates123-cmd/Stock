/**
 * Always-have single source of truth (redesign Phase D, note 6).
 *
 * One canonical normalization + one predicate so "Salt" / "salt" /
 * "kosher salt" all resolve to a single pinned staple, and always-have items
 * are filtered out of EVERY shopping path (plan → shopping included) from the
 * same helper. The canonical store is `have.ts alwaysHave` (a name-keyed
 * Record); `pantry.ts isStaple` is NOT read here — this removes the old split
 * brain between the two.
 */
import { matchKey, looksLikeSameItem } from '@/lib/pantry';

/** Canonical always-have key: lowercase, trimmed, comma-tail dropped,
 *  whitespace collapsed. Same normalization the pantry matcher uses. */
export function alwaysHaveKey(name: string): string {
  return matchKey(name);
}

/**
 * Is this ingredient name pinned as always-have in `alwaysMap`?
 *
 * Matches three ways, most-specific first:
 *  1. exact normalized key ("Kosher Salt" → "kosher salt")
 *  2. legacy raw-lowercase key (older pins stored the raw string)
 *  3. the app's ONE "same item" test, `looksLikeSameItem` — so a "salt" pin
 *     covers "kosher salt" / "flaky sea salt" on any list.
 *
 * Rule 3 used to be a bare head-noun compare (`baseIngredient(a) === baseIngredient(b)`)
 * with no guard. Since a "base" is just the LAST WORD, a pin on "olive oil"
 * claimed "sesame oil"; "green onions" claimed "red onions". The claimed item
 * was routed off the buy list and never bought, with nothing on screen to
 * explain it. looksLikeSameItem only allows a head-noun match when one of the
 * two names is a single word, and honours pairs the user has said are different.
 */
export function isAlwaysHave(
  name: string,
  alwaysMap: Record<string, unknown>,
): boolean {
  const k = alwaysHaveKey(name);
  if (alwaysMap[k]) return true;
  const raw = name.toLowerCase().trim();
  if (alwaysMap[raw]) return true;
  for (const pinned of Object.keys(alwaysMap)) {
    if (alwaysMap[pinned] && looksLikeSameItem(name, pinned)) return true;
  }
  return false;
}

/**
 * STRICT variant: is THIS exact name pinned always-have? Only the exact /
 * legacy-raw key — NOT the loose base-noun match. Used for the detail-sheet
 * toggle, whose label + action operate on this one item: a base-noun collision
 * (another "…vinegar" pinned) must not make an un-pinned "white wine vinegar"
 * read as "Remove always have".
 */
export function isExactAlwaysHave(
  name: string,
  alwaysMap: Record<string, unknown>,
): boolean {
  if (alwaysMap[alwaysHaveKey(name)]) return true;
  return !!alwaysMap[name.toLowerCase().trim()];
}
