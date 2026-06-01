import { describe, it, expect } from 'vitest';
import { localParseRecipe } from '@/lib/parsing/localRecipe';

describe('localParseRecipe (keyless fallback)', () => {
  it('parses ingredients with units, normalizing synonyms', () => {
    const r = localParseRecipe('2 cups flour\n3 teaspoons salt\n200 grams butter');
    const names = r.ingredients.map((i) => i.canonicalName);
    expect(names).toContain('flour');
    expect(names).toContain('salt');
    expect(names).toContain('butter');
    const flour = r.ingredients.find((i) => i.canonicalName === 'flour')!;
    expect(flour.amount).toBe(2);
    expect(flour.unit).toBe('cup'); // "cups" normalized
    const salt = r.ingredients.find((i) => i.canonicalName === 'salt')!;
    expect(salt.unit).toBe('tsp'); // "teaspoons" normalized
    const butter = r.ingredients.find((i) => i.canonicalName === 'butter')!;
    expect(butter.unit).toBe('g'); // "grams" normalized
  });

  it('parses unicode fractions and mixed numbers', () => {
    const r = localParseRecipe('½ cup sugar\n1½ cups milk');
    const sugar = r.ingredients.find((i) => i.canonicalName === 'sugar')!;
    expect(sugar.amount).toBe(0.5);
    const milk = r.ingredients.find((i) => i.canonicalName === 'milk')!;
    expect(milk.amount).toBe(1.5);
  });

  it('parses a/b fractions', () => {
    const r = localParseRecipe('3/4 cup cream');
    const cream = r.ingredients.find((i) => i.canonicalName === 'cream')!;
    expect(cream.amount).toBeCloseTo(0.75);
  });

  it('treats "Serves 6" as yield, not an ingredient', () => {
    const r = localParseRecipe('Serves 6\n2 cups flour');
    expect(r.yield.serves).toBe(6);
    expect(r.ingredients.map((i) => i.canonicalName)).not.toContain('servings');
    expect(r.fieldConfidence?.yield).toBe('parsed');
  });

  it('treats "6 servings" as yield, not an ingredient', () => {
    const r = localParseRecipe('6 servings\n2 cups flour');
    expect(r.yield.serves).toBe(6);
    // the "6 servings" line must not have produced an ingredient named servings
    expect(
      r.ingredients.some((i) => /servings?/.test(i.canonicalName)),
    ).toBe(false);
  });

  it('handles the NYT two-line yield shape (number then "servings")', () => {
    const r = localParseRecipe('6\nservings\n2 cups flour');
    expect(r.yield.serves).toBe(6);
  });

  it('defaults serves to 4 and flags yield guessed when absent', () => {
    const r = localParseRecipe('2 cups flour');
    expect(r.yield.serves).toBe(4);
    expect(r.fieldConfidence?.yield).toBe('guessed');
  });

  it('flags all output as low-confidence', () => {
    const r = localParseRecipe('2 cups flour\nMix well and bake.');
    expect(r.fieldConfidence?.ingredients).toBe('guessed');
    expect(r.fieldConfidence?.steps).toBe('guessed');
  });

  it('routes a long unnumbered line into steps', () => {
    const r = localParseRecipe(
      'Preheat the oven to a reasonable temperature and wait patiently for it',
    );
    expect(r.steps.length).toBeGreaterThanOrEqual(1);
  });

  // *** REAL APP BUG (documented, not patched — src is read-only here) ***
  // A numbered step line like "1. Preheat the oven..." is misclassified as an
  // INGREDIENT in the keyless fallback parser. toIngredient() runs before the
  // numbered-step branch, and INGREDIENT_RE treats the leading ordinal "1." as
  // a quantity (\d+[\d./]* eats "1."), so the whole sentence becomes an
  // ingredient (amount:1, name:"preheat the oven...") and the step list is
  // empty. See src/lib/parsing/localRecipe.ts (INGREDIENT_RE + the
  // toIngredient-before-step ordering in localParseRecipe).
  // This test pins the CURRENT behavior so a future fix is noticed.
  it('BUG: numbered step lines are swallowed as ingredients (keyless parser)', () => {
    const r = localParseRecipe(
      '1. Preheat the oven to a reasonable temperature and wait patiently for it',
    );
    expect(r.steps).toHaveLength(0);
    expect(r.ingredients).toHaveLength(1);
    expect(r.ingredients[0]!.canonicalName).toContain('preheat the oven');
    expect(r.ingredients[0]!.amount).toBe(1);
  });

  it('keeps an unknown unit word as part of the name', () => {
    // "bunch" is not in UNIT_SYNONYMS for localRecipe → should fold into name
    const r = localParseRecipe('1 bunch parsley');
    const found = r.ingredients.find((i) => i.canonicalName.includes('parsley'));
    expect(found).toBeTruthy();
    expect(found!.unit).toBeNull();
    expect(found!.canonicalName).toContain('bunch');
  });
});
