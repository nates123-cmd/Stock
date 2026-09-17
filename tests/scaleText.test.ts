import { describe, it, expect } from 'vitest';
import { parseWrittenAmount, scaleAmountsInText, scaleSteps } from '@/lib/scaleText';
import type { Ingredient, Step } from '@/types';

const ing = (name: string): Ingredient =>
  ({
    id: name,
    rawText: name,
    canonicalName: name,
    amount: 1,
    unit: null,
    modificationHistory: [],
  }) as unknown as Ingredient;

const INGS = [ing('eggs'), ing('flour, all-purpose'), ing('chicken thighs, bone-in'), ing('lemon'), ing('garlic')];

const half = (t: string) => scaleAmountsInText(t, 0.5, INGS);
const dbl = (t: string) => scaleAmountsInText(t, 2, INGS);

describe('parseWrittenAmount', () => {
  it('reads every way a recipe writes a number', () => {
    expect(parseWrittenAmount('2')).toBe(2);
    expect(parseWrittenAmount('1.5')).toBe(1.5);
    expect(parseWrittenAmount('1,5')).toBe(1.5);
    expect(parseWrittenAmount('1/2')).toBe(0.5);
    expect(parseWrittenAmount('1 1/2')).toBe(1.5);
    expect(parseWrittenAmount('½')).toBe(0.5);
    expect(parseWrittenAmount('1½')).toBe(1.5);
    expect(parseWrittenAmount('1 ½')).toBe(1.5);
  });
});

describe('scaleAmountsInText — measures', () => {
  it('halves a cup amount and singularises the unit', () => {
    expect(half('Add 2 cups flour and stir.')).toBe('Add 1 cup flour and stir.');
  });

  it('scales tight metric units', () => {
    expect(half('Weigh out 500g flour with 250ml water.')).toBe('Weigh out 250g flour with 125ml water.');
  });

  it('writes fractions the way the ingredient rows do', () => {
    expect(half('Add 1 1/2 cups milk.')).toBe('Add 3/4 cup milk.');
    expect(half('Add 1/2 cup sugar.')).toBe('Add 1/4 cup sugar.');
  });

  it('keeps unicode fractions when the source used them', () => {
    expect(half('Add 1½ cups milk.')).toBe('Add ¾ cup milk.');
    expect(dbl('Add ¾ cup milk.')).toBe('Add 1½ cups milk.');
  });

  it('pluralises when scaling up across one', () => {
    expect(dbl('Melt 1 tablespoon butter.')).toBe('Melt 2 tablespoons butter.');
    expect(dbl('Add 1/2 cup stock.')).toBe('Add 1 cup stock.');
    expect(scaleAmountsInText('Add 1/2 cup stock.', 4, INGS)).toBe('Add 2 cups stock.');
  });

  it('never inflects abbreviations', () => {
    expect(half('Add 2 tbsp oil and 2 tsp salt.')).toBe('Add 1 tbsp oil and 1 tsp salt.');
  });

  it('scales both ends of a range', () => {
    expect(half('Add 2–3 cups broth.')).toBe('Add 1–1 1/2 cups broth.');
    expect(half('Add 2 to 4 tablespoons oil.')).toBe('Add 1 to 2 tablespoons oil.');
  });

  it('agrees the measure, not the ingredient, in "2 garlic cloves"', () => {
    expect(half('Smash 2 garlic cloves.')).toBe('Smash 1 garlic clove.');
  });
});

describe('scaleAmountsInText — counted ingredients', () => {
  it('scales a count of a listed ingredient', () => {
    expect(half('Whisk 2 eggs.')).toBe('Whisk 1 egg.');
    expect(dbl('Juice 1 lemon.')).toBe('Juice 2 lemons.');
  });

  it('looks past a size word', () => {
    expect(half('Whisk 2 large eggs.')).toBe('Whisk 1 large egg.');
  });

  it('agrees the last word of a multi-word ingredient', () => {
    expect(half('Sear 4 chicken thighs skin-side down.')).toBe('Sear 2 chicken thighs skin-side down.');
    expect(half('Sear 2 chicken thighs.')).toBe('Sear 1 chicken thigh.');
  });

  it('ignores a count of something the recipe does not list', () => {
    expect(half('Serves 4 people.')).toBe('Serves 4 people.');
    expect(half('Divide among 4 bowls.')).toBe('Divide among 4 bowls.');
  });
});

describe('scaleAmountsInText — leaves non-food numbers alone', () => {
  it('temperatures', () => {
    expect(half('Heat the oven to 350°F.')).toBe('Heat the oven to 350°F.');
    expect(half('Heat to 180 degrees.')).toBe('Heat to 180 degrees.');
  });

  it('durations', () => {
    expect(half('Bake 20 minutes, rest 2 hours, then 30 secs more.')).toBe(
      'Bake 20 minutes, rest 2 hours, then 30 secs more.',
    );
    expect(half('Cook 3-4 minutes per side.')).toBe('Cook 3-4 minutes per side.');
  });

  it('step numbers, pan sizes, inches, percentages', () => {
    expect(half('Step 2: grease a 9x13-inch pan; cut 1-inch cubes; use 2% milk.')).toBe(
      'Step 2: grease a 9x13-inch pan; cut 1-inch cubes; use 2% milk.',
    );
  });

  it('returns the same string when nothing moves', () => {
    const t = 'Preheat the oven.';
    expect(half(t)).toBe(t);
  });

  it('is a no-op at 1×', () => {
    const t = 'Add 2 cups flour.';
    expect(scaleAmountsInText(t, 1, INGS)).toBe(t);
  });
});

describe('scaleSteps', () => {
  const step = (title: string, body: string): Step =>
    ({ id: title, ordinal: 1, title, body, parsedTimers: [], parsedAmounts: [], modificationHistory: [] }) as Step;

  it('scales title and body, keeping everything else', () => {
    const [s] = scaleSteps([step('Whisk 2 eggs', 'Whisk 2 eggs with 1 cup flour for 5 minutes.')], 0.5, INGS);
    expect(s?.title).toBe('Whisk 1 egg');
    expect(s?.body).toBe('Whisk 1 egg with 1/2 cup flour for 5 minutes.');
    expect(s?.ordinal).toBe(1);
  });

  it('returns the same step object when nothing in it moves', () => {
    const src = step('Preheat', 'Preheat the oven to 400°F.');
    const [s] = scaleSteps([src], 0.5, INGS);
    expect(s).toBe(src);
  });
});
