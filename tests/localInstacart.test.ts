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

  // NOTE (real limitation, not a test bug): the plural "lbs" is NOT recognized
  // as a size because SINGLE_SIZE matches `lb\b`, and "lbs" has no word
  // boundary after "lb". normalizeUnit() handles "lbs"→"lb" but is never
  // reached for this token, so "Ground Beef 2 lbs" yields no amount/unit.
  // Documented, not patched (app source is read-only here).
  it('does NOT parse the plural "lbs" as a size (known gap)', () => {
    const out = localParseInstacart('Ground Beef 2 lbs');
    expect(out[0]!.value.amount).toBeUndefined();
    expect(out[0]!.value.unit).toBeUndefined();
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

  // NOTE (real limitation, not a test bug): with exactly 2 tokens the brand
  // run is NOT stripped (the strip guard is `tokens.length > 2`), so
  // "Driscoll's Raspberries" canonicalizes to "driscoll raspberries", not
  // "raspberries". Documented, not patched.
  it('does NOT strip the brand for a 2-token name (known gap)', () => {
    const out = localParseInstacart("Driscoll's Raspberries");
    expect(out[0]!.value.canonicalName).toBe('driscoll raspberries');
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
