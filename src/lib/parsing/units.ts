/**
 * Bench tools — spec §11 tasks 4, 5 (§9 Bench; build order §13 step 8).
 * Results cache on input string / ingredient+amount (spec §11 "Caching").
 */
import type { Unit } from '@/types';

export type ConvertedIngredient = {
  name: string;
  grams: number;
  /** baker's % vs. flour when flour is detected, else omitted (spec §9) */
  bakersPercent?: number;
};

/** §11.4 — "1 stick butter" → 113g, "1.75 cups flour" → ~220g. */
export async function convertRecipe(
  _text: string,
  _scale?: { targetFlourGrams?: number; factor?: number },
): Promise<ConvertedIngredient[]> {
  // TODO: callClaude(MODELS.fast), cacheKey on normalized input.
  throw new Error('not implemented — spec §11.4');
}

export type Substitute = {
  rank: 1 | 2 | 3;
  name: string;
  amount: { value: number; unit: Unit };
  /** what changes in the result */
  note: string;
};

/** §11.5 — 3 ranked substitutes with amounts and notes. */
export async function findSubstitutes(
  _ingredient: string,
  _amount: { value: number; unit: Unit },
): Promise<Substitute[]> {
  // TODO: callClaude(MODELS.fast), cache on ingredient+amount.
  throw new Error('not implemented — spec §11.5');
}
