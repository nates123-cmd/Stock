import { describe, it, expect } from 'vitest';
import { localParseInstacart } from '@/lib/parsing/localInstacart';

describe('localParseInstacart (keyless fallback)', () => {
  it('filters junk/chrome lines', () => {
    const out = localParseInstacart(
      'Your order\nSubtotal\n$12.34\nBananas\nTotal',
    );
    const names = out.map((o) => o.value.canonicalName);
    expect(names).toContain('bananas');
    expect(names).not.toContain('your order');
    expect(names).not.toContain('subtotal');
    expect(names).not.toContain('total');
  });

  it('does multi-pack math "6 oz × 2" → 12 oz', () => {
    const out = localParseInstacart('Greek Yogurt 6 oz × 2');
    expect(out[0]!.value.amount).toBe(12);
    expect(out[0]!.value.unit).toBe('oz');
  });

  it('does multi-pack math "2 × 6 oz" → 12 oz', () => {
    const out = localParseInstacart('Sparkling Water 2 × 6 oz');
    expect(out[0]!.value.amount).toBe(12);
    expect(out[0]!.value.unit).toBe('oz');
  });

  it('reads a single size', () => {
    const out = localParseInstacart('Olive Oil 16 oz');
    expect(out[0]!.value.amount).toBe(16);
    expect(out[0]!.value.unit).toBe('oz');
  });

  it('falls back to a leading count as pieces', () => {
    const out = localParseInstacart('3 Avocados');
    expect(out[0]!.value.amount).toBe(3);
    expect(out[0]!.value.unit).toBe('pc');
  });

  it('normalizes lb sizes', () => {
    const out = localParseInstacart('Ground Beef 2 lb');
    expect(out[0]!.value.amount).toBe(2);
    expect(out[0]!.value.unit).toBe('lb');
  });

  // REGRESSION (bug fix): the plural "lbs" must be recognized as a size. The
  // size regexes now list "lbs" before "lb" so the longer plural wins, and
  // normalizeUnit() collapses it to "lb".
  it('normalizes the plural "lbs" size to lb', () => {
    const out = localParseInstacart('Ground Beef 2 lbs');
    expect(out[0]!.value.amount).toBe(2);
    expect(out[0]!.value.unit).toBe('lb');
  });

  it('detects substitution and keeps the arrived item', () => {
    const out = localParseInstacart('Cilantro substituted with Parsley');
    expect(out[0]!.value.tag).toBe('sub');
    expect(out[0]!.value.canonicalName).toContain('parsley');
  });

  it('tags non-substitutions as new', () => {
    const out = localParseInstacart('Carrots');
    expect(out[0]!.value.tag).toBe('new');
  });

  it('strips a leading capitalized brand run (3+ tokens)', () => {
    // Brand-strip only fires when tokens.length > 2, so use a 3-token name.
    const out = localParseInstacart('Trader Joes mango salsa');
    expect(out[0]!.value.canonicalName).toBe('mango salsa');
  });

  // REGRESSION (bug fix): a leading 2-token possessive brand is now stripped.
  // "Driscoll's Raspberries" → "raspberries" (the possessive token is a strong
  // brand signal, fired even though the food noun is also Capitalized).
  it('strips a leading possessive brand for a 2-token name', () => {
    const out = localParseInstacart("Driscoll's Raspberries");
    expect(out[0]!.value.canonicalName).toBe('raspberries');
  });

  it('strips price and parentheticals', () => {
    const out = localParseInstacart('Whole Milk (1 gal) $4.99');
    // brand/size/price stripped, lowercased
    expect(out[0]!.value.canonicalName).toContain('milk');
    expect(out[0]!.value.canonicalName).not.toContain('$');
  });

  it('dedupes identical canonical names', () => {
    const out = localParseInstacart('Bananas\nBananas');
    expect(out.filter((o) => o.value.canonicalName === 'bananas')).toHaveLength(1);
  });

  it('flags everything as parsed confidence', () => {
    const out = localParseInstacart('Bananas');
    expect(out[0]!.confidence).toBe('parsed');
  });
});
