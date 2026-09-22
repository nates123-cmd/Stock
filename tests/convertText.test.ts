/**
 * "To grams" must rewrite the amounts written into step prose, the way
 * Scale already does — otherwise the list says "63 g sugar" and the step
 * still says "5 tablespoons sugar".
 */
import { describe, expect, it } from 'vitest';
import { convertAmountsInText, convertSteps } from '@/lib/convertText';
import type { Ingredient, Step } from '@/types';

const ing = (id: string, canonicalName: string, amount: number | null, unit: string | null): Ingredient => ({
  id,
  canonicalName,
  amount,
  unit,
  modificationHistory: [],
});

// Mandy's dressing, pre-conversion rows + the grams they became.
const sugar = { ingredient: ing('s', 'sugar', 5, 'tablespoon'), grams: 63 };
const vinegar = { ingredient: ing('v', 'rice vinegar', 6, 'tablespoons'), grams: 90 };
const sesame = { ingredient: ing('o', 'sesame oil', 1.5, 'tablespoon'), grams: 22 };
const milk = { ingredient: ing('m', 'milk', 1.5, 'cup'), grams: 368 };
const ALL = [sugar, vinegar, sesame, milk];

describe('convertAmountsInText', () => {
  it('rewrites the exact row amount to its grams', () => {
    expect(convertAmountsInText('Whisk 5 tablespoons sugar with 6 tablespoons rice vinegar.', ALL)).toBe(
      'Whisk 63 g sugar with 90 g rice vinegar.',
    );
  });

  it('keeps "of" and rewrites unicode mixed numbers', () => {
    expect(convertAmountsInText('Warm 1½ cups of milk.', ALL)).toBe('Warm 368 g of milk.');
  });

  it('gives a partial amount its proportional share', () => {
    // 63 g / 5 tbsp = 12.6 g per tbsp
    expect(convertAmountsInText('Sprinkle 1 tablespoon of the sugar over the top.', ALL)).toBe(
      'Sprinkle 13 g of the sugar over the top.',
    );
  });

  it('converts a different unit of the same ingredient by density', () => {
    // 1 cup = 16 tbsp → 16 × 12.6 ≈ 202 g
    const out = convertAmountsInText('Add 1 cup sugar.', ALL);
    const n = parseInt(out, 10) || parseInt(out.replace(/^\D+/, ''), 10);
    expect(out).toMatch(/^Add \d+ g sugar\.$/);
    expect(n).toBeGreaterThanOrEqual(198);
    expect(n).toBeLessThanOrEqual(206);
  });

  it('rewrites both ends of a range', () => {
    // 22 g / 1.5 tbsp = 14.67 g per tbsp
    expect(convertAmountsInText('Finish with 1-2 tablespoons sesame oil, to taste.', ALL)).toBe(
      'Finish with 15-29 g sesame oil, to taste.',
    );
  });

  it('skips the size word between number and measure', () => {
    expect(convertAmountsInText('Add 1 heaping tablespoon sugar.', ALL)).toBe('Add 13 g sugar.');
  });

  it('leaves ingredients that were not converted alone', () => {
    const text = 'Toss with 2 tablespoons soy sauce and 1 cup water.';
    expect(convertAmountsInText(text, ALL)).toBe(text);
  });

  it('leaves counts, temperatures, durations and existing grams alone', () => {
    const text = 'Beat 2 eggs. Bake at 350°F for 10 minutes in a 9x13 pan. Add 500g flour and 63 g sugar.';
    expect(convertAmountsInText(text, ALL)).toBe(text);
  });

  it('with no noun nearby, converts only an unambiguous exact match', () => {
    expect(convertAmountsInText('Pour in the 6 tablespoons and whisk.', ALL)).toBe(
      'Pour in the 90 g and whisk.',
    );
    // two rows are "1.5 tablespoon"-ish? no — but "2 tablespoons" matches none
    const text = 'Pour in the 2 tablespoons and whisk.';
    expect(convertAmountsInText(text, ALL)).toBe(text);
  });

  it('returns the identical string when nothing applies', () => {
    const text = 'Season and serve.';
    expect(convertAmountsInText(text, ALL)).toBe(text);
    expect(convertAmountsInText(text, [])).toBe(text);
  });
});

describe('convertSteps', () => {
  const step = (id: string, title: string, body: string): Step => ({
    id,
    ordinal: 1,
    title,
    body,
    parsedTimers: [],
    parsedAmounts: [],
  });

  it('rewrites title and body, and keeps untouched steps by identity', () => {
    const s1 = step('1', 'Dressing', 'Whisk 5 tablespoons sugar into 6 tablespoons rice vinegar.');
    const s2 = step('2', 'Toss', 'Toss the salad and serve.');
    const out = convertSteps([s1, s2], ALL);
    expect(out[0]!.body).toBe('Whisk 63 g sugar into 90 g rice vinegar.');
    expect(out[1]).toBe(s2);
  });

  it('is a no-op with no conversions', () => {
    const steps = [step('1', 'A', 'Add 5 tablespoons sugar.')];
    expect(convertSteps(steps, [])).toBe(steps);
  });
});
