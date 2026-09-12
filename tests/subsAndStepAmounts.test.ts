import { describe, expect, it } from 'vitest';
import type { Ingredient, PlanComponent, Recipe } from '@/types';
import {
  applySubToIngredient,
  localEntryFor,
  localSubstitutes,
} from '@/lib/substitutions';
import {
  amountsForStep,
  formatStepAmount,
  liveIngredients,
  matchTerms,
  stepAmountLine,
  stepMentions,
} from '@/lib/stepAmounts';

const ing = (name: string, amount: number | null = 1, unit: string | null = 'cup'): Ingredient =>
  ({
    id: `i_${name.replace(/\W/g, '')}`,
    amount,
    unit,
    canonicalName: name,
    modificationHistory: [],
  }) as Ingredient;

const rec = (id: string, ingredients: Ingredient[]): Recipe =>
  ({
    id,
    title: id,
    source: { type: 'mine' },
    status: 'active',
    yield: { serves: 4 },
    tags: [],
    cookCount: 0,
    ingredients,
    steps: [],
    createdAt: new Date('2026-01-01'),
    modifiedAt: new Date('2026-01-01'),
  }) as Recipe;

describe('local substitution table', () => {
  it('matches on the ingredient name, longest match winning', () => {
    expect(localEntryFor('buttermilk')?.subs[0]?.name).toBe('milk + lemon juice');
    // "heavy cream" must not fall through to the plain "milk"/"cream" entries
    expect(localEntryFor('heavy cream')?.subs[0]?.name).toBe('whole milk + melted butter');
  });

  it('ignores prep tails and parentheticals', () => {
    expect(localEntryFor('buttermilk, well shaken')).toBeDefined();
    expect(localEntryFor('unsalted butter (cold)')).toBeDefined();
  });

  it('returns nothing for something it does not know', () => {
    expect(localEntryFor('gochujang')).toBeUndefined();
    expect(localSubstitutes('gochujang', { value: 2, unit: 'tbsp' })).toEqual([]);
  });

  it('scales the swap to the amount asked for', () => {
    const subs = localSubstitutes('butter', { value: 2, unit: 'cup' });
    expect(subs[0]?.name).toBe('neutral oil');
    expect(subs[0]?.amount).toEqual({ value: 1.6, unit: 'cup' });
    expect(subs.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it('overrides the unit when the swap is measured differently', () => {
    const subs = localSubstitutes('eggs', { value: 2, unit: 'pc' });
    const applesauce = subs.find((s) => s.name.includes('applesauce'));
    expect(applesauce?.amount).toEqual({ value: 0.5, unit: 'cup' });
  });
});

describe('applying a substitution', () => {
  it('rewrites the ingredient and records the swap', () => {
    const before = ing('buttermilk', 1, 'cup');
    const after = applySubToIngredient(before, {
      name: 'milk + lemon juice',
      amount: 1,
      unit: 'cup',
      note: 'Rest 10 min.',
    });
    expect(after.canonicalName).toBe('milk + lemon juice');
    // amount is unchanged, so only the NAME change is recorded
    expect(after.modificationHistory).toHaveLength(1);
    expect(after.modificationHistory[0]?.type).toBe('name');
    expect(after.modificationHistory[0]?.before).toBe('buttermilk');
    expect(after.modificationHistory[0]?.reason).toContain('Rest 10 min.');
  });

  it('records both when the amount changes too', () => {
    const after = applySubToIngredient(ing('butter', 1, 'cup'), {
      name: 'neutral oil',
      amount: 0.8,
      unit: 'cup',
    });
    expect(after.modificationHistory.map((m) => m.type).sort()).toEqual(['amount', 'name']);
    expect(after.amount).toBe(0.8);
  });

  it('is a no-op when nothing actually changes', () => {
    const before = ing('milk', 1, 'cup');
    expect(applySubToIngredient(before, { name: 'milk', amount: 1, unit: 'cup' })).toBe(before);
  });
});

describe('matching amounts to a step', () => {
  it('derives the terms that identify an ingredient in prose', () => {
    expect(matchTerms('olive oil, EVOO')).toContain('olive oil');
    expect(matchTerms('olive oil, EVOO')).toContain('oil');
    // the stop-words are dropped so "kosher salt" is findable as "salt"
    expect(matchTerms('kosher salt')).toEqual(['salt']);
  });

  it('matches singular and plural both ways', () => {
    expect(stepMentions('Halve the lemons and squeeze', 'lemon')).toBe(true);
    expect(stepMentions('Add the potato', 'baby potatoes')).toBe(true);
  });

  it('does not match a step that names nothing', () => {
    expect(stepMentions('Heat the oven to 425F', 'chicken thighs, bone-in')).toBe(false);
  });

  it('returns only the ingredients the step names, in the order named', () => {
    const ings = [
      ing('kosher salt', 2, 'tbsp'),
      ing('baby potatoes', 700, 'g'),
      ing('olive oil, EVOO', 30, 'ml'),
    ];
    const hits = amountsForStep('Toss the potatoes with the oil and roast', ings);
    expect(hits.map((i) => i.canonicalName)).toEqual(['baby potatoes', 'olive oil, EVOO']);
  });

  it('gives no line for a pure-procedure step', () => {
    expect(stepAmountLine('Rest 15 minutes before carving', [ing('lemon', 1, 'pc')])).toBeNull();
  });

  it('formats the way the recipe screens do', () => {
    expect(formatStepAmount(ing('bread flour', 500, 'g'))).toBe('500g bread flour');
    expect(formatStepAmount(ing('pepper', null, null))).toBe('pepper');
  });

  it('de-dupes an ingredient two dishes share', () => {
    const line = stepAmountLine('Season with salt', [
      ing('kosher salt', 2, 'tbsp'),
      ing('kosher salt', 1, 'tsp'),
    ]);
    expect(line).toBe('2 tbsp kosher salt');
  });
});

describe('live ingredients on a plan component', () => {
  const comp: PlanComponent = {
    id: 'c1',
    name: 'Bread',
    recipeId: 'r1',
    ingredients: [ing('bread flour', 500, 'g')],
  };

  it('prefers the live recipe over the stored snapshot', () => {
    // the recipe has since been scaled 2x — the snapshot still says 500g
    const live = rec('r1', [ing('bread flour', 1000, 'g')]);
    const got = liveIngredients(comp, (id) => (id === 'r1' ? live : undefined));
    expect(got[0]?.amount).toBe(1000);
  });

  it('re-applies the component scale on top of the live recipe', () => {
    const live = rec('r1', [ing('bread flour', 500, 'g')]);
    const got = liveIngredients({ ...comp, scale: 2 }, () => live);
    expect(got[0]?.amount).toBe(1000);
  });

  it('falls back to the snapshot when the recipe is gone', () => {
    const got = liveIngredients(comp, () => undefined);
    expect(got[0]?.amount).toBe(500);
  });

  it('leaves "to taste" alone when scaling', () => {
    const live = rec('r1', [ing('pepper', null, null)]);
    expect(liveIngredients({ ...comp, scale: 3 }, () => live)[0]?.amount).toBeNull();
  });
});
