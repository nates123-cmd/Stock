import { describe, it, expect } from 'vitest';
import { localBestGuess } from '@/lib/parsing/localBestGuess';

describe('localBestGuess (pre-cook hunch parser)', () => {
  it('splits on newlines and commas', () => {
    const out = localBestGuess('chicken thighs, soy sauce\ngarlic');
    const names = out.map((o) => o.value.canonicalName);
    expect(names).toContain('chicken thighs');
    expect(names).toContain('soy sauce');
    expect(names).toContain('garlic');
  });

  it('always flags guessed', () => {
    const out = localBestGuess('rice');
    expect(out[0]!.confidence).toBe('guessed');
  });

  it('parses amount + unit, normalized to a canonical Stock unit', () => {
    // localBestGuess now runs the shared parse-ingredient first pass, which
    // normalizes UOMs onto Stock's canonical set (spec §4) — so "cups" → "cup",
    // matching localRecipe. (Previously it kept the raw token un-normalized.)
    const out = localBestGuess('2 cups rice');
    expect(out[0]!.value.amount).toBe(2);
    expect(out[0]!.value.unit).toBe('cup');
    expect(out[0]!.value.canonicalName).toBe('rice');
  });

  it('folds an unrecognized unit word into the name', () => {
    const out = localBestGuess('1 blarg flour');
    expect(out[0]!.value.unit).toBeNull();
    expect(out[0]!.value.canonicalName).toContain('blarg');
  });

  it('handles unicode fractions', () => {
    const out = localBestGuess('½ cup cream');
    expect(out[0]!.value.amount).toBe(0.5);
  });

  it('keeps a bare ingredient with null amount', () => {
    const out = localBestGuess('salt');
    expect(out[0]!.value.amount).toBeNull();
    expect(out[0]!.value.canonicalName).toBe('salt');
  });

  it('lowercases canonical names', () => {
    const out = localBestGuess('Chicken Stock');
    expect(out[0]!.value.canonicalName).toBe('chicken stock');
  });
});
