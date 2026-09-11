import { describe, expect, it } from 'vitest';
import type { Ingredient, Recipe, Step } from '@/types';
import {
  addComponent,
  componentRefs,
  dinnersContaining,
  expandRecipe,
  indexRecipes,
  ingredientGroups,
  isDinner,
  linksTo,
  moveComponent,
  newDinner,
  removeComponent,
  resolveRefs,
  rollupIngredients,
  rollupMinutes,
  updateComponent,
  wouldCycle,
} from '@/lib/dinners';
import {
  parseOffsetHours,
  phasesFromCombined,
  componentsFromRecipes,
  timerFromText,
} from '@/lib/cookPlanShape';

const ing = (name: string, amount: number | null = 1): Ingredient =>
  ({
    id: `i_${name}`,
    amount,
    unit: amount == null ? null : 'cup',
    canonicalName: name,
    modificationHistory: [],
  }) as Ingredient;

const step = (ordinal: number, body: string): Step =>
  ({
    id: `s_${ordinal}_${body.slice(0, 4)}`,
    ordinal,
    title: body,
    body,
    parsedTimers: [],
    parsedAmounts: [],
    modificationHistory: [],
  }) as Step;

const rec = (id: string, extra: Partial<Recipe> = {}): Recipe =>
  ({
    id,
    title: id,
    source: { type: 'mine' },
    status: 'active',
    yield: { serves: 4 },
    tags: [],
    cookCount: 0,
    ingredients: [],
    steps: [],
    createdAt: new Date('2026-01-01'),
    modifiedAt: new Date('2026-01-01'),
    ...extra,
  }) as Recipe;

/** chicken + slaw, with the dinner linking both. */
function spread() {
  const chicken = rec('chicken', {
    title: 'Roast Chicken',
    ingredients: [ing('chicken', 1), ing('salt', 2)],
    steps: [step(1, 'Roast for 60 minutes'), step(2, 'Rest')],
    yield: { serves: 4, totalMinutes: 90 },
  });
  const slaw = rec('slaw', {
    title: 'Fennel Slaw',
    ingredients: [ing('fennel', 2)],
    steps: [step(1, 'Shave fennel')],
    yield: { serves: 4, totalMinutes: 15 },
  });
  let dinner = newDinner('Friday Dinner');
  const index = indexRecipes([chicken, slaw, dinner]);
  dinner = addComponent(dinner, chicken, index);
  dinner = addComponent(dinner, slaw, index);
  return { chicken, slaw, dinner, index: indexRecipes([chicken, slaw, dinner]) };
}

describe('dinner references', () => {
  it('links recipes and resolves them live', () => {
    const { dinner, index } = spread();
    expect(componentRefs(dinner)).toHaveLength(2);
    const resolved = resolveRefs(dinner, index);
    expect(resolved.map((r) => r.title)).toEqual(['Roast Chicken', 'Fennel Slaw']);
    expect(resolved.every((r) => !r.missing)).toBe(true);
  });

  it('falls back to the link-time title when the target is gone', () => {
    const { dinner, chicken } = spread();
    const without = indexRecipes([dinner]);
    const resolved = resolveRefs(dinner, without);
    expect(resolved[0]!.missing).toBe(true);
    expect(resolved[0]!.title).toBe(chicken.title);
  });

  it('refuses a duplicate link', () => {
    const { dinner, chicken, index } = spread();
    expect(addComponent(dinner, chicken, index)).toBe(dinner);
  });

  it('refuses a self link and a cycle', () => {
    const { dinner, chicken, index } = spread();
    expect(addComponent(dinner, dinner, index)).toBe(dinner);
    // chicken already sits under dinner, so dinner-inside-chicken is a cycle
    expect(wouldCycle(chicken.id, dinner.id, index)).toBe(true);
    expect(addComponent(chicken, dinner, index)).toBe(chicken);
  });

  it('survives a cycle that already exists in the data', () => {
    // Hand-built A → B → A. Traversal must terminate and visit each once.
    const a = rec('a', { componentRecipes: [{ id: 'r1', recipeId: 'b' }] });
    const b = rec('b', { componentRecipes: [{ id: 'r2', recipeId: 'a' }] });
    const index = indexRecipes([a, b]);
    const walked = expandRecipe(a, index);
    expect(walked.map((e) => e.recipe.id)).toEqual(['a', 'b']);
  });

  it('stops at the depth cap', () => {
    const chain = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id, i, all) =>
      rec(id, {
        componentRecipes: all[i + 1] ? [{ id: `ref${i}`, recipeId: all[i + 1]! }] : undefined,
      }),
    );
    const index = indexRecipes(chain);
    const walked = expandRecipe(chain[0]!, index, { maxDepth: 2 });
    expect(walked.map((e) => e.recipe.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('removes, reorders and patches references', () => {
    const { dinner } = spread();
    const refs = componentRefs(dinner);
    const moved = moveComponent(dinner, refs[1]!.id, -1);
    expect(componentRefs(moved).map((r) => r.recipeId)).toEqual(['slaw', 'chicken']);
    const noted = updateComponent(dinner, refs[0]!.id, { note: 'day before' });
    expect(componentRefs(noted)[0]!.note).toBe('day before');
    const dropped = removeComponent(dinner, refs[0]!.id);
    expect(componentRefs(dropped)).toHaveLength(1);
    expect(removeComponent(dinner, 'nope')).toBe(dinner);
  });

  it('knows which dinners serve a recipe', () => {
    const { dinner, chicken, slaw } = spread();
    expect(dinnersContaining(chicken.id, [dinner, chicken, slaw])).toEqual([dinner]);
    expect(dinnersContaining(dinner.id, [dinner])).toEqual([]);
    expect(linksTo(dinner, 'slaw')).toBe(true);
  });

  it('flags dinners explicitly, and all-links-no-method implicitly', () => {
    const { dinner, chicken } = spread();
    expect(isDinner(dinner)).toBe(true);
    expect(isDinner(chicken)).toBe(false);
    // a plain recipe that links its sauce is NOT a dinner
    const sauced = rec('roast', {
      steps: [step(1, 'Roast it')],
      componentRecipes: [{ id: 'r', recipeId: 'sauce' }],
    });
    expect(isDinner(sauced)).toBe(false);
    // legacy row with no flag but nothing of its own reads as a dinner
    const legacy = rec('legacy', { componentRecipes: [{ id: 'r', recipeId: 'x' }] });
    expect(isDinner(legacy)).toBe(true);
  });
});

describe('ingredient rollup', () => {
  it('groups own ingredients first, then each referenced recipe', () => {
    const { dinner, index } = spread();
    const withOwn = { ...dinner, ingredients: [ing('wine', 1)] };
    const groups = ingredientGroups(withOwn, indexRecipes([...index.values(), withOwn]));
    expect(groups.map((g) => g.title)).toEqual([
      'Friday Dinner',
      'Roast Chicken',
      'Fennel Slaw',
    ]);
    expect(groups[0]!.isRoot).toBe(true);
    expect(rollupIngredients(withOwn, indexRecipes([...index.values(), withOwn]))).toHaveLength(4);
  });

  it('drops empty groups so a pure dinner starts at its first dish', () => {
    const { dinner, index } = spread();
    expect(ingredientGroups(dinner, index).map((g) => g.title)).toEqual([
      'Roast Chicken',
      'Fennel Slaw',
    ]);
  });

  it('applies the reference scale and leaves "to taste" alone', () => {
    const sauce = rec('sauce', { ingredients: [ing('soy', 2), ing('pepper', null)] });
    let dinner = newDinner('Doubled');
    const index0 = indexRecipes([sauce, dinner]);
    dinner = addComponent(dinner, sauce, index0, { scale: 2 });
    const index = indexRecipes([sauce, dinner]);
    const rolled = rollupIngredients(dinner, index);
    expect(rolled[0]!.amount).toBe(4);
    expect(rolled[1]!.amount).toBeNull();
  });

  it('sums the time across the spread', () => {
    const { dinner, index } = spread();
    expect(rollupMinutes(dinner, index)).toBe(105);
  });
});

describe('offset parsing', () => {
  it('reads the labels the combiner emits', () => {
    expect(parseOffsetHours('T-24h')).toBe(24);
    expect(parseOffsetHours('T-45m')).toBeCloseTo(0.75);
    expect(parseOffsetHours('T-1h30m')).toBeCloseTo(1.5);
    expect(parseOffsetHours('T-2d')).toBe(48);
    expect(parseOffsetHours('T-0')).toBe(0);
    expect(parseOffsetHours('')).toBeUndefined();
    expect(parseOffsetHours(undefined)).toBeUndefined();
  });

  it('treats a bare number as minutes', () => {
    expect(parseOffsetHours('T-90')).toBeCloseTo(1.5);
  });
});

describe('timer extraction', () => {
  it('pulls a duration', () => {
    expect(timerFromText('Simmer for 20 minutes')).toEqual({
      kind: 'duration',
      label: 'Timer',
      seconds: 1200,
    });
  });

  it('pulls a window from a range', () => {
    expect(timerFromText('Brine 8-12 hours')).toMatchObject({
      kind: 'clock',
      minSeconds: 28800,
      maxSeconds: 43200,
    });
  });

  it('pulls an oven temp', () => {
    expect(timerFromText('Heat the oven to 425°F')).toMatchObject({
      kind: 'temp',
      tempF: 425,
    });
  });

  it('leaves a plain step alone', () => {
    expect(timerFromText('Shave the fennel thin')).toBeUndefined();
  });
});

describe('phases from a combined timeline', () => {
  const components = componentsFromRecipes([
    { recipe: rec('chicken', { title: 'Roast Chicken' }), scale: 1 },
    { recipe: rec('slaw', { title: 'Fennel Slaw' }), scale: 1 },
  ]);

  it('buckets scheduled steps earliest-first with real windows', () => {
    const phases = phasesFromCombined(
      [
        { offsetLabel: 'T-0', text: 'Plate', dish: 'Fennel Slaw' },
        { offsetLabel: 'T-24h', text: 'Dry brine overnight', dish: 'Roast Chicken' },
        { offsetLabel: 'T-90m', text: 'Roast for 60 minutes', dish: 'Roast Chicken' },
        { offsetLabel: 'T-30m', text: 'Shave fennel', dish: 'Fennel Slaw' },
      ],
      components,
    );
    expect(phases.map((p) => p.label)).toEqual([
      'Days ahead',
      'Final stretch',
      'Plate and serve',
    ]);
    expect(phases[0]!.offsetFromServe).toEqual({ minHours: 24, maxHours: 24 });
    expect(phases[1]!.offsetFromServe).toEqual({ minHours: 0.5, maxHours: 1.5 });
    // steps are renumbered within their phase
    expect(phases[1]!.steps.map((s) => s.ordinal)).toEqual([1, 2]);
    // and attributed back to the component they belong to
    expect(phases[1]!.steps[0]!.componentId).toBe(components[0]!.id);
    expect(phases[1]!.steps[0]!.timer).toMatchObject({ kind: 'duration', seconds: 3600 });
  });

  it('phases by dish and schedules nothing when the fallback gave no offsets', () => {
    const phases = phasesFromCombined(
      [
        { offsetLabel: '', text: 'Roast it', dish: 'Roast Chicken' },
        { offsetLabel: '', text: 'Rest it', dish: 'Roast Chicken' },
        { offsetLabel: '', text: 'Shave fennel', dish: 'Fennel Slaw' },
      ],
      components,
    );
    expect(phases.map((p) => p.label)).toEqual(['Roast Chicken', 'Fennel Slaw']);
    expect(phases.every((p) => p.offsetFromServe === undefined)).toBe(true);
    expect(phases[0]!.steps).toHaveLength(2);
  });

  it('keeps unattributed serve steps', () => {
    const phases = phasesFromCombined(
      [{ offsetLabel: 'T-0', text: 'Open the wine' }],
      components,
    );
    expect(phases[0]!.steps[0]!.componentId).toBeUndefined();
  });
});

describe('components from recipes', () => {
  it('carries ingredients, the recipe back-link and the scale', () => {
    const sauce = rec('sauce', { title: 'Sauce', ingredients: [ing('soy', 3)] });
    const [c] = componentsFromRecipes([{ recipe: sauce, scale: 2 }]);
    expect(c!.name).toBe('Sauce');
    expect(c!.recipeId).toBe('sauce');
    expect(c!.ingredients[0]!.amount).toBe(6);
  });
});
