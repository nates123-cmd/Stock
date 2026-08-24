import { describe, it, expect } from 'vitest';
import {
  CUISINES,
  cuisineLabel,
  deriveCuisine,
  isKnownCuisine,
  normCuisine,
  reconcileCuisine,
  setCuisineManually,
  type CuisineInput,
} from '../src/lib/cuisine';

const r = (p: {
  title?: string;
  ings?: string[];
  steps?: string[];
  tags?: string[];
}): CuisineInput => ({
  title: p.title ?? '',
  ingredients: (p.ings ?? []).map((canonicalName) => ({ canonicalName })),
  steps: (p.steps ?? []).map((body) => ({ body })),
  tags: p.tags ?? [],
});

describe('cuisine vocabulary', () => {
  it('normalizes and labels', () => {
    expect(normCuisine('  Middle   Eastern ')).toBe('middle eastern');
    expect(cuisineLabel('middle eastern')).toBe('Middle Eastern');
    expect(isKnownCuisine('ITALIAN')).toBe(true);
    expect(isKnownCuisine('martian')).toBe(false);
  });

  it('has no duplicates', () => {
    expect(new Set(CUISINES).size).toBe(CUISINES.length);
  });
});

describe('deriveCuisine', () => {
  it('reads a strong signature', () => {
    expect(deriveCuisine(r({ ings: ['gochujang', 'sesame oil', 'scallion'] }))).toBe(
      'korean',
    );
    expect(
      deriveCuisine(r({ title: 'Cacio e pepe', ings: ['pecorino', 'spaghetti'] })),
    ).toBe('italian');
    expect(
      deriveCuisine(r({ ings: ['masa', 'tomatillo', 'cotija', 'chipotle'] })),
    ).toBe('mexican');
  });

  it('lets a cuisine you typed as a tag win outright', () => {
    // Ingredients read Italian; the tag says otherwise, and the tag is a
    // deliberate statement.
    const out = deriveCuisine(r({ ings: ['pasta', 'parmesan'], tags: ['thai'] }));
    expect(out).toBe('thai');
  });

  it('returns undefined when there is nothing to go on', () => {
    expect(deriveCuisine(r({}))).toBeUndefined();
    expect(deriveCuisine(r({ title: 'Toast', ings: ['bread', 'salt'] }))).toBeUndefined();
  });

  it('refuses to guess between neighbours that share their evidence', () => {
    // Soy sauce + ginger + scallion + sesame is Chinese, Japanese AND Korean.
    // Picking one would be a filter that hides food, so it declines.
    const out = deriveCuisine(
      r({ ings: ['soy sauce', 'ginger', 'scallion', 'sesame oil'] }),
    );
    expect(out).toBeUndefined();
  });

  it('is deterministic — the same recipe always gives the same answer', () => {
    const input = r({ title: 'Green curry', ings: ['lemongrass', 'fish sauce', 'coconut milk'] });
    const runs = Array.from({ length: 5 }, () => deriveCuisine(input));
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toBe('thai');
  });

  it('does not let a weak pile-up clear the bar on its own', () => {
    // All-weak Italian terms: below MIN_SCORE, so no claim is made.
    expect(deriveCuisine(r({ ings: ['basil', 'olive oil'] }))).toBeUndefined();
  });

  it('needs a SIGNATURE term, not just three shared staples', () => {
    // Caraway + mustard + pork are each weak German signals and together reach
    // STRONG_WEIGHT — which labelled a graham-cracker streusel as German until
    // a strong hit was made mandatory. Found by running the deriver over the
    // real 168-recipe library.
    expect(
      deriveCuisine(r({ title: 'Streusel', ings: ['caraway', 'mustard', 'pork'] })),
    ).toBeUndefined();
    // One real signature term is still enough.
    expect(deriveCuisine(r({ ings: ['sauerkraut', 'caraway'] }))).toBe('german');
  });

  it('matches whole words, never substrings', () => {
    // 'hing' (asafoetida) inside "something"/"washing"/"nothing" made a key lime
    // pie read as Indian. Same class of bug hasWord exists to prevent in the
    // tagger. Also found against the real library.
    const out = deriveCuisine(
      r({
        title: 'Classic Key Lime Pie',
        ings: ['graham crackers', 'condensed milk', 'lime juice'],
        steps: ['Do something with the crust', 'Bake until nothing jiggles'],
      }),
    );
    expect(out).toBeUndefined();
  });

  it('does not read the English word "sake" as Japanese', () => {
    expect(
      deriveCuisine(r({ steps: ['For the sake of the texture, rest it 10 minutes.'] })),
    ).toBeUndefined();
  });
});

describe('reconcileCuisine — your edit wins, permanently', () => {
  it('fills an empty field with the guess and marks it auto', () => {
    expect(reconcileCuisine({}, 'thai')).toEqual({ cuisine: 'thai', cuisineAuto: true });
  });

  it('never touches a manually-set value', () => {
    const manual = { cuisine: 'french' };
    expect(reconcileCuisine(manual, 'thai')).toBeNull();
    expect(reconcileCuisine(manual, undefined)).toBeNull();
  });

  it('corrects its own earlier guess', () => {
    const auto = { cuisine: 'italian', cuisineAuto: true as const };
    expect(reconcileCuisine(auto, 'thai')).toEqual({ cuisine: 'thai', cuisineAuto: true });
  });

  it('clears a stale guess when the evidence goes away', () => {
    const auto = { cuisine: 'italian', cuisineAuto: true as const };
    expect(reconcileCuisine(auto, undefined)).toEqual({});
  });

  it('writes nothing when the guess already matches — so a backfill is free', () => {
    const auto = { cuisine: 'thai', cuisineAuto: true as const };
    expect(reconcileCuisine(auto, 'thai')).toBeNull();
  });

  it('leaves an already-empty field alone', () => {
    expect(reconcileCuisine({}, undefined)).toBeNull();
  });
});

describe('setCuisineManually', () => {
  it('drops the auto flag, which is what makes a choice stick', () => {
    const out = setCuisineManually('Japanese');
    expect(out).toEqual({ cuisine: 'japanese' });
    expect(out.cuisineAuto).toBeUndefined();
    // And the deriver must now leave it alone.
    expect(reconcileCuisine(out, 'italian')).toBeNull();
  });

  it('clearing hands the field back to the deriver', () => {
    const out = setCuisineManually(undefined);
    expect(out).toEqual({});
    expect(reconcileCuisine(out, 'italian')).toEqual({
      cuisine: 'italian',
      cuisineAuto: true,
    });
  });

  it('"other" is a real answer and stays put', () => {
    const out = setCuisineManually('other');
    expect(out).toEqual({ cuisine: 'other' });
    expect(reconcileCuisine(out, 'italian')).toBeNull();
  });
});
