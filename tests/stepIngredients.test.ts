import { describe, expect, it } from 'vitest';
import type { Ingredient, Step } from '@/types';
import { approxVolume, placeIngredients } from '@/lib/stepIngredients';
import { scaleIngredientAmounts } from '@/lib/recipe';

const ing = (canonicalName: string, amount: number | null, unit: string | null): Ingredient =>
  ({
    id: `i_${canonicalName.replace(/\W/g, '')}`,
    amount,
    unit,
    canonicalName,
    modificationHistory: [],
  }) as Ingredient;

const steps = (...bodies: string[]): Step[] =>
  bodies.map((body, i) => ({
    id: `s${i + 1}`,
    ordinal: i + 1,
    title: '',
    body,
    parsedTimers: [],
    parsedAmounts: [],
    modificationHistory: [],
  }));

const names = (list: Ingredient[] | undefined) => (list ?? []).map((i) => i.canonicalName);

// Real recipes from Nate's library, as stored (already converted to grams).
const soupIngs = [
  ing('olive oil', 15, 'ml'),
  ing('frozen mirepoix mix (carrot, onion, celery)', 600, 'g'),
  ing('garlic powder', 3, 'g'),
  ing('black pepper', 2, 'g'),
  ing('dried oregano', 1.5, 'g'),
  ing('chicken better than bouillon', 75, 'g'),
  ing('chicken stock', 1800, 'g'),
  ing('orzo pasta', 150, 'g'),
  ing('swiss chard, chopped', 150, 'g'),
  ing('rotisserie chicken meat, chopped', 450, 'g'),
  ing('turmeric', 2.5, 'g'),
  ing('frozen peas', 150, 'g'),
];
const soupSteps = steps(
  'Add a generous squeeze of olive oil into a large preheated heavy bottomed pot over high heat followed by mirepoix. Stir and cook for 1-2 minutes until thawed and starting to soften.',
  'Add garlic powder, pepper, and oregano (feel free to eyeball it). Stir and fry for about a minute until fragrant.',
  'Stir in chicken bouillon paste then chicken stock. Add orzo (if substituting orzo with frozen rice, wait to add it until a later step). Bring soup to a simmer.',
  'About 4-5 minutes before the orzo/pasta is done cooking, stir in the chard or greens. Reduce heat to medium/med-low and cook until greens are tender and orzo is cooked to al dente.',
  'Stir in turmeric, frozen peas, and chopped chicken just to heat through. If using frozen or pre-cooked rice, add it during this step.',
  'Taste for seasoning and adjust with salt if needed. Usually add a large pinch or two of salt at this step.',
  'Garnish with black pepper, a drizzle of olive oil, a squeeze of lemon juice, and fresh dill if you have it.',
  'If using chicken thighs instead of rotisserie: salt boneless, skinless thighs and lay out on a sheet tray. Bake at 450°F/230°C for 13-15 minutes, then chop and use in place of rotisserie chicken.',
);

const pancakeIngs = [
  ing('unsalted butter', 140, 'g'),
  ing('all-purpose flour', 600, 'g'),
  ing('kosher salt', 12, 'g'),
  ing('granulated sugar', 60, 'g'),
  ing('baking soda', 2, 'g'),
  ing('baking powder', 25, 'g'),
  ing('buttermilk', 900, 'g'),
  ing('large eggs', 4, null),
  ing('grassfed salted butter', null, null),
];
const pancakeSteps = steps(
  'Place butter into a pan over low heat and melt. Set aside.',
  'In a medium bowl, combine flour, salt, sugar, baking soda, and baking powder. Whisk until the salt and leaveners are evenly mixed throughout.',
  "In a second bowl, combine buttermilk and eggs. Whisk until well blended. If you can't find buttermilk, combine 500g (2 cups) of sour cream with 400g (1 2/3 cups) of water as a substitute.",
  'Pour the buttermilk mixture into the dry ingredients and carefully fold to combine. Start with 10 gentle stirs.',
  'Stream in half of the melted butter and fold gently. Then add the remaining butter and fold for another 30 seconds.',
  'Serve the pancakes immediately with a pad of room temperature grassfed salted butter between each pancake and a proper pad of butter on top.',
);

describe('placeIngredients — chicken soup', () => {
  const { byStep, unplaced } = placeIngredients(soupSteps, soupIngs);

  it('puts each ingredient at the first step that names it', () => {
    expect(names(byStep.get('s1'))).toEqual(['olive oil', 'frozen mirepoix mix (carrot, onion, celery)']);
    expect(names(byStep.get('s2'))).toEqual(['garlic powder', 'black pepper', 'dried oregano']);
    expect(names(byStep.get('s3'))).toEqual(['chicken better than bouillon', 'chicken stock', 'orzo pasta']);
    expect(names(byStep.get('s4'))).toEqual(['swiss chard, chopped']);
  });

  it('"chicken stock" and "chicken bouillon" do not drag the rotisserie chicken into step 3', () => {
    expect(names(byStep.get('s3'))).not.toContain('rotisserie chicken meat, chopped');
    expect(names(byStep.get('s5'))).toEqual([
      'turmeric',
      'frozen peas',
      'rotisserie chicken meat, chopped',
    ]);
  });

  it('"frozen rice" in step 3 does not place the frozen peas early', () => {
    expect(names(byStep.get('s3'))).not.toContain('frozen peas');
  });

  it('a later repeat (garnish pepper, drizzle of oil) gets no block', () => {
    expect(byStep.has('s6')).toBe(false);
    expect(byStep.has('s7')).toBe(false);
    expect(byStep.has('s8')).toBe(false);
    expect(unplaced).toEqual([]);
  });
});

describe('placeIngredients — pancakes', () => {
  const { byStep, unplaced } = placeIngredients(pancakeSteps, pancakeIngs);

  it('bare "butter" goes to the first butter in the list, the garnish butter by its full name', () => {
    expect(names(byStep.get('s1'))).toEqual(['unsalted butter']);
    expect(byStep.has('s5')).toBe(false);
    expect(names(byStep.get('s6'))).toEqual(['grassfed salted butter']);
  });

  it('dry and wet groups land on their own steps, in the order the step names them', () => {
    expect(names(byStep.get('s2'))).toEqual([
      'all-purpose flour',
      'kosher salt',
      'granulated sugar',
      'baking soda',
      'baking powder',
    ]);
    expect(names(byStep.get('s3'))).toEqual(['buttermilk', 'large eggs']);
    expect(unplaced).toEqual([]);
  });
});

describe('placeIngredients — sheet-pan chicken', () => {
  it('plural/singular and head nouns match', () => {
    const { byStep } = placeIngredients(
      steps(
        'Heat oven to 425°F. Toss potatoes and lemon with half the oil on a sheet pan. Nestle in oiled, salted thighs skin-side up.',
        'Roast 35–40 minutes until skin is crisp and potatoes are tender.',
      ),
      [
        ing('chicken thighs, bone-in', 12, 'pc'),
        ing('lemons', 3, 'pc'),
        ing('baby potatoes', 1050, 'g'),
        ing('olive oil, EVOO', 45, 'ml'),
      ],
    );
    expect(names(byStep.get('s1'))).toEqual([
      'baby potatoes',
      'lemons',
      'olive oil, EVOO',
      'chicken thighs, bone-in',
    ]);
    expect(byStep.has('s2')).toBe(false);
  });
});

describe('placeIngredients — misc', () => {
  it('"Mix well" does not place a "… mix" ingredient', () => {
    const { byStep, unplaced } = placeIngredients(
      steps('Mix well and rest.'),
      [ing('frozen mirepoix mix', 600, 'g')],
    );
    expect(byStep.size).toBe(0);
    expect(names(unplaced)).toEqual(['frozen mirepoix mix']);
  });

  it('halving the recipe halves every step block — nothing is stored', () => {
    const halved = scaleIngredientAmounts(pancakeIngs, 0.5);
    const { byStep } = placeIngredients(pancakeSteps, halved);
    expect(byStep.get('s1')![0]!.amount).toBe(70);
    expect(byStep.get('s2')!.map((i) => i.amount)).toEqual([300, 6, 30, 1, 12.5]);
  });
});

describe('approxVolume', () => {
  it('rounds to what a measuring set can hit', () => {
    expect(approxVolume(ing('all-purpose flour', 600, 'g'))).toBe('about 4 3/4 cups');
    expect(approxVolume(ing('kosher salt', 12, 'g'))).toBe('2 1/2 tsp');
    expect(approxVolume(ing('granulated sugar', 60, 'g'))).toBe('5 tbsp');
    // 0.62 cup: a quarter-cup round would be 20% off, so tablespoons
    expect(approxVolume(ing('unsalted butter', 140, 'g'))).toBe('10 tbsp');
    expect(approxVolume(ing('buttermilk', 900, 'g'))).toBe('about 3 3/4 cups');
  });

  it('stays quiet for counts, volumes and unknown ingredients', () => {
    expect(approxVolume(ing('large eggs', 4, null))).toBeNull();
    expect(approxVolume(ing('olive oil', 15, 'ml'))).toBeNull();
    expect(approxVolume(ing('frozen mirepoix mix', 600, 'g'))).toBeNull();
  });
});
