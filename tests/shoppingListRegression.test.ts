import { describe, it, expect } from 'vitest';
import { matchKey, baseIngredient } from '../src/lib/pantry';

/**
 * A verbatim copy of the PRE-FIX row logic, kept on purpose.
 *
 * Nate's report — "I added groceries for 3 meals, pushed to Wegmans, deleted
 * them; a day later I rebuilt for meal 3 and stuff from meals 1 and 2 popped
 * up" — was not reproducible by inspection, so this pins the mechanism. It runs
 * the old algorithm against his exact sequence and asserts the WRONG outcome,
 * which is what makes the tests in shoppingList.test.ts meaningful: they assert
 * the right outcome on the same input.
 *
 * If you ever find yourself reverting to name-keyed exclusion, this file is the
 * receipt for why it does not work.
 */
type Extra = { id: string; canonicalName: string };
const oldWasPushed = (name: string, pushedSet: Set<string>) => {
  const k = matchKey(name);
  if (pushedSet.has(k)) return true;
  const b = baseIngredient(name);
  for (const key of pushedSet) {
    if (key.startsWith(k) || k.startsWith(key)) return true;
    if (baseIngredient(key) === b) return true;
  }
  return false;
};

describe('PRE-FIX behaviour (documents the bug)', () => {
  it("hid meal-3 items because meal-1 shared a last word", () => {
    const pushed = new Set([matchKey('green onions'), matchKey('sesame oil')]);
    expect(oldWasPushed('red onions', pushed)).toBe(true);
    expect(oldWasPushed('olive oil', pushed)).toBe(true);
  });

  it("Clear all left the collateral rows behind, then dumped them back", () => {
    let extras: Extra[] = [
      { id: '1', canonicalName: 'green onions' },
      { id: '2', canonicalName: 'red onions' },
      { id: '3', canonicalName: 'sesame oil' },
      { id: '4', canonicalName: 'olive oil' },
    ];
    // Push meal 1 only (the two that were visible).
    const pushedItems = [
      { key: matchKey('green onions'), name: 'green onions' },
      { key: matchKey('sesame oil'), name: 'sesame oil' },
    ];
    const pushedSet = new Set(pushedItems.map((p) => p.key));
    // Active after the push: OLD code hid all four.
    const activeAfterPush = extras.filter((e) => !oldWasPushed(e.canonicalName, pushedSet));
    expect(activeAfterPush).toEqual([]); // looks like an empty, finished list

    // "Clear all" — OLD code, exact matchKey lookup.
    for (const p of pushedItems) {
      const ex = extras.find((x) => matchKey(x.canonicalName) === p.key);
      if (ex) extras = extras.filter((x) => x.id !== ex.id);
    }
    const clearedSet = new Set<string>(); // markers gone

    const activeAfterClear = extras.filter((e) => !oldWasPushed(e.canonicalName, clearedSet));
    // The bug: two items Nate never saw and never deleted are back.
    expect(activeAfterClear.map((e) => e.canonicalName)).toEqual(['red onions', 'olive oil']);
  });
});
