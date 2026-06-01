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

  // REGRESSION (bug fix): a numbered step line like "1. Preheat oven to 350"
  // must route to steps, not be swallowed as an ingredient. The leading
  // ordinal "1." used to be eaten by INGREDIENT_RE as a quantity. The fix runs
  // the numbered-step branch BEFORE toIngredient() in localParseRecipe.
  it('routes a numbered step line into steps, not ingredients', () => {
    const r = localParseRecipe('1. Preheat oven to 350');
    expect(r.steps).toHaveLength(1);
    expect(r.ingredients).toHaveLength(0);
    expect(r.steps[0]!.body).toBe('Preheat oven to 350');
  });

  it('routes several numbered steps in order and keeps quantity ingredients', () => {
    const r = localParseRecipe(
      '2 cups flour\n1. Preheat oven to 350\n2) Mix the dry ingredients',
    );
    // the genuine quantity-led ingredient still parses as an ingredient
    expect(r.ingredients.map((i) => i.canonicalName)).toEqual(['flour']);
    const flour = r.ingredients[0]!;
    expect(flour.amount).toBe(2);
    expect(flour.unit).toBe('cup');
    // both numbered lines became steps, in order
    expect(r.steps.map((s) => s.ordinal)).toEqual([1, 2]);
    expect(r.steps[0]!.body).toBe('Preheat oven to 350');
    expect(r.steps[1]!.body).toBe('Mix the dry ingredients');
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
