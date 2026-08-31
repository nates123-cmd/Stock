import { describe, it, expect } from 'vitest';
import { scaleIngredientAmounts, scaledServes } from '@/lib/recipe';
import type { Ingredient } from '@/types';

const ing = (id: string, amount: number | null, unit: string | null): Ingredient =>
  ({
    id,
    rawText: id,
    canonicalName: id,
    amount,
    unit,
    modificationHistory: [],
  }) as unknown as Ingredient;

describe('scaleIngredientAmounts', () => {
  it('halves every measured amount', () => {
    const out = scaleIngredientAmounts([ing('flour', 500, 'g'), ing('egg', 2, 'pc')], 0.5);
    expect(out.map((i) => i.amount)).toEqual([250, 1]);
  });

  it('leaves amount-less ingredients ("to taste") alone', () => {
    const out = scaleIngredientAmounts([ing('salt', null, null)], 0.5);
    expect(out[0].amount).toBeNull();
  });

  it('rounds to 2dp instead of leaking float noise', () => {
    // 1/3 cup at 2/3x is 0.2222…; we want a number a human can read.
    const out = scaleIngredientAmounts([ing('cream', 0.333, 'cup')], 2 / 3);
    expect(out[0].amount).toBe(0.22);
  });

  it('does not mutate the input array', () => {
    const src = [ing('flour', 500, 'g')];
    scaleIngredientAmounts(src, 2);
    expect(src[0].amount).toBe(500);
  });
});

describe('scaledServes', () => {
  it('halves an even yield', () => {
    expect(scaledServes(4, 0.5)).toBe(2);
  });

  it('rounds an odd yield to a whole number', () => {
    expect(scaledServes(3, 0.5)).toBe(2);
  });

  it('never drops below one serving', () => {
    expect(scaledServes(1, 0.25)).toBe(1);
  });

  it('scales up', () => {
    expect(scaledServes(4, 2)).toBe(8);
  });
});
