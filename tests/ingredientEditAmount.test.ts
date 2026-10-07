import { describe, it, expect } from 'vitest';
import { parseAmount } from '../src/lib/amountInput';

/**
 * The inline Edit on the ingredient action sheet takes whatever a cook types
 * one-handed: decimals with either separator, plain fractions, mixed numbers.
 * The older EditRecipe form was decimal-only ("1/2" silently became null).
 */
describe('ingredient edit amount parsing', () => {
  it('parses decimals with . or ,', () => {
    expect(parseAmount('1.5')).toBe(1.5);
    expect(parseAmount('1,5')).toBe(1.5);
    expect(parseAmount(' 2 ')).toBe(2);
  });

  it('parses fractions and mixed numbers', () => {
    expect(parseAmount('1/2')).toBe(0.5);
    expect(parseAmount('1 1/2')).toBe(1.5);
    expect(parseAmount('3/4')).toBe(0.75);
  });

  it('returns null for blank or junk', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('a pinch')).toBeNull();
    expect(parseAmount('1/0')).toBeNull();
  });
});
