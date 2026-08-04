import { describe, expect, it } from 'vitest';
import { describeSize, parseSize, sizesDiverge, unitPrice } from '../src/lib/size';
import { compareQuotes, type StoreQuote } from '../src/lib/quotes';

describe('parseSize', () => {
  it('reads the plain cases off real product names', () => {
    expect(parseSize('Marketside Fresh Asparagus Spears, 10 oz')).toMatchObject({ amount: 10, unit: 'oz', canonical: 10 });
    expect(parseSize('Fresh Whole Carrots, 2 lb Bag')).toMatchObject({ amount: 2, unit: 'lb', canonical: 32 });
    expect(parseSize('Bragg Organic Apple Cider Vinegar, 16 fl oz')).toMatchObject({ dimension: 'volume', canonical: 16 });
    expect(parseSize('Great Value Large White Eggs 18 Count')).toMatchObject({ dimension: 'count', canonical: 18 });
  });

  it('converts metric to the canonical unit', () => {
    expect(parseSize('Tesco Italian Cherry Tomatoes 400G')!.canonical).toBeCloseTo(14.11, 1);
    expect(parseSize('Filippo Berio Extra Virgin Olive Oil, 3 L')!.canonical).toBeCloseTo(101.44, 1);
  });

  it('multiplies by the pack count', () => {
    const p = parseSize('Tuscanini Whole Cherry Tomatoes 14.1 oz (4 Pack)');
    expect(p).toMatchObject({ amount: 14.1, multiplier: 4 });
    expect(p!.canonical).toBeCloseTo(56.4, 1);
    expect(parseSize('Mr Organic Cherry Tomatoes 400g, Pack of 3')!.multiplier).toBe(3);
  });

  it('returns null rather than guessing when no size is stated', () => {
    // Inventing a size here would produce a confident per-ounce number built
    // on nothing, which is worse than admitting we don't know.
    expect(parseSize('Fresh Banana, Each')).toBeNull();
    expect(parseSize('Crisp Fresh Celery Hearts')).toBeNull();
    expect(parseSize('')).toBeNull();
  });

  it('prefers a weight over an incidental count', () => {
    // "3 - 4 per Tray" is packaging detail; the pounds are the size.
    const p = parseSize('Chuck Short Ribs, Bone-in, 3 - 4 per Tray, Fresh, 2.3 lb');
    expect(p!.dimension).toBe('weight');
    expect(p!.canonical).toBeCloseTo(36.8, 1);
  });

  it('takes the trailing size when a name carries several numbers', () => {
    const p = parseSize('Ghirardelli Premium 86% Cacao Dark Chocolate, 3.17 oz');
    expect(p).toMatchObject({ amount: 3.17, unit: 'oz' });
  });
});

describe('unitPrice', () => {
  it('divides price by the canonical amount', () => {
    const u = unitPrice(4.09, parseSize('Green Beans, 24 oz'));
    expect(u!.value).toBeCloseTo(0.17, 2);
    expect(u!.label).toBe('$0.17/oz');
  });

  it('keeps precision when the unit price is sub-cent', () => {
    // 30¢ per kilo works out to well under a cent an ounce; two decimals would
    // render it "$0.01/oz" for anything in a wide range, which compares nothing.
    const u = unitPrice(0.3, parseSize('Something, 1 kg'));
    expect(u!.value).toBeLessThan(0.01);
    expect(u!.label).toMatch(/^\$0\.\d{4}\/oz$/);
  });

  it('is null when size or price is unknown', () => {
    expect(unitPrice(4.09, null)).toBeNull();
    expect(unitPrice(undefined, parseSize('Beans, 12 oz'))).toBeNull();
  });

  it('labels by dimension', () => {
    expect(unitPrice(8, parseSize('Milk, 64 fl oz'))!.label).toBe('$0.13/fl oz'); // 0.125 rounds up
    expect(unitPrice(3.6, parseSize('Eggs 18 Count'))!.label).toBe('$0.20/ea');
  });
});

describe('describeSize / sizesDiverge', () => {
  it('renders a readable pack size', () => {
    expect(describeSize(parseSize('Carrots, 2 lb Bag'))).toBe('2 lb');
    expect(describeSize(parseSize('Tomatoes 14.1 oz (4 Pack)'))).toBe('4 × 14.1 oz');
    expect(describeSize(null)).toBeNull();
  });

  it('flags a material size gap and ignores a trivial one', () => {
    expect(sizesDiverge(parseSize('Beans, 12 oz'), parseSize('Beans, 24 oz'))).toBe(true);
    expect(sizesDiverge(parseSize('Beans, 12 oz'), parseSize('Beans, 13 oz'))).toBe(false);
  });

  it('never compares across dimensions', () => {
    expect(sizesDiverge(parseSize('X, 12 oz'), parseSize('Y, 64 fl oz'))).toBe(false);
  });
});

// ── the case Nate raised ────────────────────────────────────────────────────

function line(query: string, name: string, price: number) {
  const size = parseSize(name);
  return { query, qty: 1, status: 'exact' as const, name, price, size, unit: unitPrice(price, size) };
}

function quote(retailer: StoreQuote['retailer'], lines: StoreQuote['lines']): StoreQuote {
  return { retailer, lines, subtotal: lines.reduce((s, l) => s + (l.price ?? 0) * l.qty, 0) };
}

describe('size-aware comparison', () => {
  it('does not let a smaller pack pass as cheaper', () => {
    // The exact trap: $3.99 for 12 oz looks like it beats $4.09 for 24 oz.
    const c = compareQuotes([
      quote('walmart', [line('green beans', 'Fresh Green Beans, 12 oz', 3.99)]),
      quote('wegmans', [line('green beans', 'Wegmans Trimmed Green Beans, 24 oz', 4.09)]),
    ]);
    const v = c.verdicts.find((x) => x.startsWith('green beans:'));
    expect(v).toBeDefined();
    expect(v).toContain('Walmart is $3.99 for 12 oz');
    expect(v).toContain('Wegmans is $4.09 for 24 oz');
    expect(v).toContain('Wegmans is better value');
    expect(v).toContain('/oz');
  });

  it('says so plainly when the cheaper pack is also the better value', () => {
    const c = compareQuotes([
      quote('walmart', [line('rice', 'Arborio Rice, 32 oz', 5.0)]),
      quote('wegmans', [line('rice', 'Arborio Rice, 16 oz', 9.0)]),
    ]);
    const v = c.verdicts.find((x) => x.startsWith('rice:'));
    expect(v).toContain('cheaper either way');
  });

  it('stays quiet when the packs are effectively the same size', () => {
    const c = compareQuotes([
      quote('walmart', [line('beans', 'Beans, 12 oz', 3.99)]),
      quote('wegmans', [line('beans', 'Beans, 13 oz', 4.09)]),
    ]);
    expect(c.verdicts.some((x) => x.startsWith('beans:'))).toBe(false);
  });

  it('stays quiet when a size is unknown rather than inventing a comparison', () => {
    const c = compareQuotes([
      quote('walmart', [line('celery', 'Crisp Fresh Celery Hearts', 3.67)]),
      quote('wegmans', [line('celery', 'Wegmans Celery Hearts', 3.29)]),
    ]);
    expect(c.verdicts.some((x) => x.startsWith('celery:'))).toBe(false);
  });

  it('ignores a store that does not carry the item at all', () => {
    const c = compareQuotes([
      quote('walmart', [line('beans', 'Beans, 12 oz', 3.99)]),
      quote('wegmans', [{ query: 'beans', qty: 1, status: 'missing' }]),
    ]);
    expect(c.verdicts.some((x) => x.startsWith('beans:'))).toBe(false);
  });
});
