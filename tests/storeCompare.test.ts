import { describe, expect, it } from 'vitest';
import { compareQuotes, describeSlot, retailerLabel, type StoreQuote } from '../src/lib/quotes';
import { canPush, scanToQuotes } from '../src/lib/storeScan';
import { cartLinks, quoteWalmart } from '../src/lib/walmart';
import { WALMART_PRODUCTS } from '../src/lib/walmartCatalog';
import { activeWalmartCatalog, isOwnStore, OWN_STORE_ID } from '../src/lib/walmartLive';
import { quoteAllStores, quoteWalmartStore, quoteWegmansStore } from '../src/lib/storeQuotes';

const NOW = new Date('2026-08-03T12:00:00-04:00');

describe('walmart catalog resolution', () => {
  it('pins an aliased staple to the exact SKU Nate buys', () => {
    const q = quoteWalmart([{ name: 'avocado oil' }]);
    expect(q.matched).toHaveLength(1);
    expect(q.matched[0]!.via).toBe('alias');
    expect(q.matched[0]!.product!.itemId).toBe('55504313');
  });

  it('strips prep and measurement words before matching', () => {
    const q = quoteWalmart([{ name: '2 cups chopped fresh Italian parsley' }]);
    expect(q.matched[0]?.product?.itemId).toBe('44391168');
  });

  it('reports an unstocked item as missing rather than guessing', () => {
    const q = quoteWalmart([{ name: 'persian cucumbers' }]);
    expect(q.missing).toEqual(['persian cucumbers']);
    expect(q.matched).toHaveLength(0);
  });

  it('does not force a match when only some words line up', () => {
    // "rice vinegar" shares a word with arborio rice and with apple cider
    // vinegar, and is neither. Requiring every token keeps it a miss.
    const q = quoteWalmart([{ name: 'rice vinegar' }]);
    expect(q.missing).toEqual(['rice vinegar']);
  });

  it('multiplies the estimate by quantity', () => {
    const one = quoteWalmart([{ name: 'carrots', qty: 1 }]).estimatedSubtotal;
    const three = quoteWalmart([{ name: 'carrots', qty: 3 }]).estimatedSubtotal;
    expect(three).toBeCloseTo(one * 3, 2);
  });

  it('flags a SKU that was out of stock at harvest', () => {
    const q = quoteWalmart([{ name: 'halloumi' }]);
    expect(q.maybeOutOfStock.map((l) => l.query)).toEqual(['halloumi']);
  });

  it('separates store-picked items from ones that ship', () => {
    // Verified against the live cart: the arborio rice lands in Walmart's
    // "arrives Wed" group, not the same-day delivery group, even though it sits
    // under Pantry in the reorder list alongside items that ARE store-picked.
    const q = quoteWalmart([{ name: 'carrots' }, { name: 'arborio rice' }]);
    expect(q.shipsSeparately.map((l) => l.query)).toEqual(['arborio rice']);
  });

  it('says nothing ships when the whole basket is store-picked', () => {
    const q = quoteWalmart([{ name: 'carrots' }, { name: 'parsley' }]);
    expect(q.shipsSeparately).toHaveLength(0);
  });

  it('every catalog entry declares how it is fulfilled', () => {
    // Guards the next harvest: a SKU added without this flag would silently
    // be treated as same-day.
    for (const p of WALMART_PRODUCTS) {
      expect(['store', 'ship']).toContain(p.fulfillment);
    }
  });
});

describe('walmart cart link', () => {
  it('builds the documented itemId_qty format', () => {
    const q = quoteWalmart([{ name: 'carrots', qty: 2 }, { name: 'parsley' }]);
    const [url] = cartLinks(q.lines);
    expect(url).toBe('https://affil.walmart.com/cart/addToCart?items=10535757_2,44391168_1');
  });

  it('omits unmatched items instead of emitting a broken id', () => {
    const q = quoteWalmart([{ name: 'carrots' }, { name: 'persian cucumbers' }]);
    const [url] = cartLinks(q.lines);
    expect(url).toBe('https://affil.walmart.com/cart/addToCart?items=10535757_1');
  });

  it('batches past the per-link cap rather than dropping the tail', () => {
    const items = Array.from({ length: 45 }, () => ({ name: 'carrots' }));
    const links = cartLinks(quoteWalmart(items).lines);
    expect(links).toHaveLength(2);
    expect(links[1]!.split(',')).toHaveLength(5);
  });

  it('returns nothing when there is nothing to add', () => {
    expect(cartLinks(quoteWalmart([{ name: 'persian cucumbers' }]).lines)).toEqual([]);
  });
});

describe('quote providers', () => {
  it('prices the same list at both stores', () => {
    const quotes = quoteAllStores([{ name: 'asparagus' }, { name: 'carrots' }]);
    expect(quotes.map((q) => q.retailer)).toEqual(['walmart', 'wegmans']);
    for (const q of quotes) expect(q.lines).toHaveLength(2);
  });

  it('returns nothing for an empty list', () => {
    expect(quoteAllStores([])).toEqual([]);
  });

  it('leaves Wegmans fees undefined rather than pretending they are zero', () => {
    // Instacart's fees depend on basket and slot. Guessing 0 would make every
    // price comparison silently favour Wegmans.
    expect(quoteWegmansStore([{ name: 'carrots' }]).fees).toBeUndefined();
  });

  it('says how many Walmart items ship instead of riding the delivery slot', () => {
    const one = quoteWalmartStore([{ name: 'carrots' }, { name: 'arborio rice' }]);
    expect(one.note).toBe(
      'Delivery from your store, but 1 item ships separately and arrives in a few days.',
    );
    const two = quoteWalmartStore([{ name: 'arborio rice' }, { name: 'avocado oil' }]);
    expect(two.note).toBe(
      'Delivery from your store, but 2 items ship separately and arrive in a few days.',
    );
  });

  it('promises plain delivery when the whole Walmart basket is store-picked', () => {
    expect(quoteWalmartStore([{ name: 'carrots' }]).note).toBe(
      'Delivery from your store. Cart shows the real total.',
    );
  });

  it('flags that Walmart prices came from a nearby store, not his own', () => {
    // The bundled catalog IS store 5293, so no caveat. The nightly refresh
    // reads whatever store Walmart geolocates the Beelink to, and presenting
    // that as his pricing is the small lie that makes the whole comparison
    // untrusted. Guard the honest-by-default direction.
    const note = quoteWalmartStore([{ name: 'carrots' }]).note ?? '';
    expect(note).not.toContain('nearby store');
    expect(activeWalmartCatalog().storeId).toBe(OWN_STORE_ID);
    expect(isOwnStore()).toBe(true);
  });

  it('reports which catalog answered and how old it is', () => {
    const q = quoteWalmart([{ name: 'carrots' }]);
    expect(q.store.source).toBe('bundled');
    expect(q.store.id).toBe(OWN_STORE_ID);
    expect(q.store.refreshedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('excludes a store it cannot actually price', () => {
    // Costco has no pinned catalog; a $0 Costco column would read as "cheapest".
    expect(quoteAllStores([{ name: 'carrots' }]).some((q) => q.retailer === 'costco')).toBe(false);
  });
});

// ── the comparison itself ───────────────────────────────────────────────────

function quote(over: Partial<StoreQuote> & Pick<StoreQuote, 'retailer' | 'lines'>): StoreQuote {
  return {
    subtotal: over.lines.reduce((s, l) => s + (l.price ?? 0) * l.qty, 0),
    ...over,
  } as StoreQuote;
}

describe('compareQuotes', () => {
  it('names what a store is missing, in Nate\'s words', () => {
    const c = compareQuotes([
      quote({
        retailer: 'wegmans',
        lines: [{ query: 'green beans', qty: 1, status: 'missing' }],
      }),
      quote({
        retailer: 'walmart',
        lines: [{ query: 'green beans', qty: 1, status: 'exact', name: 'Green Beans', price: 2.36 }],
      }),
    ], NOW);
    expect(c.verdicts).toContain("Wegmans doesn't have green beans.");
  });

  it('calls out a price gap when both stores carry the same basket', () => {
    const c = compareQuotes([
      quote({
        retailer: 'walmart',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }],
      }),
      quote({
        retailer: 'wegmans',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 27 }],
      }),
    ], NOW);
    expect(c.verdicts).toContain('Walmart is $20.00 cheaper than Wegmans for the same items.');
  });

  it('refuses to call a smaller basket cheaper', () => {
    const c = compareQuotes([
      quote({
        retailer: 'walmart',
        lines: [
          { query: 'rice', qty: 1, status: 'exact', price: 7 },
          { query: 'beans', qty: 1, status: 'missing' },
        ],
      }),
      quote({
        retailer: 'wegmans',
        lines: [
          { query: 'rice', qty: 1, status: 'exact', price: 9 },
          { query: 'beans', qty: 1, status: 'exact', price: 3 },
        ],
      }),
    ], NOW);
    expect(c.verdicts.some((v) => v.includes('not the same basket'))).toBe(true);
    // Coverage beats price: Wegmans has everything, so it wins despite costing more.
    expect(c.recommended).toBe('wegmans');
  });

  it('reports a slower delivery window', () => {
    const c = compareQuotes([
      quote({
        retailer: 'walmart',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }],
        earliestDelivery: '2026-08-03T18:00:00-04:00',
      }),
      quote({
        retailer: 'wegmans',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }],
        earliestDelivery: '2026-08-04T09:00:00-04:00',
      }),
    ], NOW);
    expect(c.verdicts.some((v) => v.includes("Wegmans can't deliver until tomorrow, 9 AM"))).toBe(true);
  });

  it('never treats an unknown delivery time as slow', () => {
    const c = compareQuotes([
      quote({ retailer: 'walmart', lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }] }),
      quote({
        retailer: 'wegmans',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }],
        earliestDelivery: '2026-08-04T09:00:00-04:00',
      }),
    ], NOW);
    expect(c.verdicts.some((v) => v.includes("can't deliver until"))).toBe(false);
  });

  it('surfaces items no store carries', () => {
    const c = compareQuotes([
      quote({ retailer: 'walmart', lines: [{ query: 'yuzu', qty: 1, status: 'missing' }] }),
      quote({ retailer: 'wegmans', lines: [{ query: 'yuzu', qty: 1, status: 'missing' }] }),
    ], NOW);
    expect(c.nobodyHas).toEqual(['yuzu']);
    expect(c.verdicts.some((v) => v.includes('No store here carries yuzu'))).toBe(true);
  });

  it('warns when a quote did not finish instead of trusting its total', () => {
    const c = compareQuotes([
      quote({
        retailer: 'wegmans',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }],
        complete: false,
      }),
    ], NOW);
    expect(c.verdicts.some((v) => v.includes("didn't finish"))).toBe(true);
  });

  it('adds fees into the number it compares on', () => {
    const c = compareQuotes([
      quote({
        retailer: 'walmart',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 10 }],
        fees: 0,
      }),
      quote({
        retailer: 'wegmans',
        lines: [{ query: 'rice', qty: 1, status: 'exact', price: 8 }],
        fees: 9,
      }),
    ], NOW);
    // Wegmans is cheaper on goods but not once delivery is counted.
    expect(c.stores.find((s) => s.retailer === 'wegmans')!.allIn).toBe(17);
    expect(c.recommended).toBe('walmart');
  });

  it('builds a per-item matrix across stores', () => {
    const c = compareQuotes([
      quote({ retailer: 'walmart', lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }] }),
      quote({ retailer: 'wegmans', lines: [{ query: 'rice', qty: 1, status: 'missing' }] }),
    ], NOW);
    expect(c.matrix).toHaveLength(1);
    expect(c.matrix[0]!.byStore.walmart?.status).toBe('exact');
    expect(c.matrix[0]!.byStore.wegmans?.status).toBe('missing');
  });

  it('handles a single store without inventing comparisons', () => {
    const c = compareQuotes([
      quote({ retailer: 'walmart', lines: [{ query: 'rice', qty: 1, status: 'exact', price: 7 }] }),
    ], NOW);
    expect(c.recommended).toBe('walmart');
    expect(c.verdicts).toEqual([]);
  });

  it('handles no stores at all', () => {
    const c = compareQuotes([], NOW);
    expect(c.recommended).toBeNull();
    expect(c.stores).toEqual([]);
  });
});

describe('describeSlot', () => {
  it('reads today, tomorrow and a weekday', () => {
    expect(describeSlot('2026-08-03T18:00:00-04:00', NOW)).toBe('today, 6 PM');
    expect(describeSlot('2026-08-04T09:30:00-04:00', NOW)).toBe('tomorrow, 9:30 AM');
    expect(describeSlot('2026-08-06T09:00:00-04:00', NOW)).toBe('Thursday, 9 AM');
  });

  it('returns null for missing or unparseable input', () => {
    expect(describeSlot(undefined, NOW)).toBeNull();
    expect(describeSlot('not a date', NOW)).toBeNull();
  });
});

// ── live scans: unknown is not missing ──────────────────────────────────────

describe('live scan quotes', () => {
  it('carries unknown through instead of folding it into missing', () => {
    const quotes = scanToQuotes({
      quotes: [
        {
          slug: 'shoprite',
          eta: 'Delivery by 10:45pm',
          distanceMi: 4.9,
          subtotal: 3.39,
          lines: [
            { query: 'green beans', status: 'exact', name: 'Bowl & Basket Green Beans, 12 oz', price: 3.39 },
            { query: 'halloumi', status: 'unknown' },
          ],
        },
      ],
    });
    expect(quotes[0]!.retailer).toBe('shoprite');
    expect(quotes[0]!.label).toBe('ShopRite');
    expect(quotes[0]!.etaText).toBe('Delivery by 10:45pm');
    expect(quotes[0]!.lines[1]!.status).toBe('unknown');
    // Sizes are parsed from the live name too, so unit pricing works either way.
    expect(quotes[0]!.lines[0]!.unit?.label).toBe('$0.28/oz');
  });

  it('leaves Instacart fees unknown rather than zero', () => {
    const q = scanToQuotes({ quotes: [{ slug: 'wegmans', subtotal: 1, lines: [] }] });
    expect(q[0]!.fees).toBeUndefined();
  });

  it('returns nothing for an empty or absent scan', () => {
    expect(scanToQuotes(null)).toEqual([]);
    expect(scanToQuotes({ quotes: [] })).toEqual([]);
  });

  it('does not count an unchecked item as missing OR as covered', () => {
    const c = compareQuotes([
      quote({
        retailer: 'shoprite',
        lines: [
          { query: 'beans', qty: 1, status: 'exact', price: 3.39 },
          { query: 'halloumi', qty: 1, status: 'unknown' },
        ],
      }),
    ], NOW);
    const s = c.stores[0]!;
    expect(s.have).toBe(1);
    expect(s.missing).toEqual([]);
    expect(s.unknown).toEqual(['halloumi']);
    expect(c.verdicts.some((v) => v.includes("Couldn't check halloumi at ShopRite"))).toBe(true);
  });

  it('will not claim nobody carries an item when a store was never checked', () => {
    const c = compareQuotes([
      quote({ retailer: 'wegmans', lines: [{ query: 'yuzu', qty: 1, status: 'missing' }] }),
      quote({ retailer: 'shoprite', lines: [{ query: 'yuzu', qty: 1, status: 'unknown' }] }),
    ], NOW);
    expect(c.nobodyHas).toEqual([]);
  });

  it('names the store that only delivers tomorrow, in Instacart wording', () => {
    const c = compareQuotes([
      quote({ retailer: 'food-bazaar', lines: [{ query: 'x', qty: 1, status: 'exact', price: 1 }], etaText: 'Delivery by 10:30pm' }),
      quote({ retailer: 'costco', lines: [{ query: 'x', qty: 1, status: 'exact', price: 1 }], etaText: 'Delivery by 12:45pm tomorrow' }),
    ], NOW);
    expect(c.verdicts.some((v) => v.includes('Costco is delivery by 12:45pm tomorrow'))).toBe(true);
  });

  it('titles an unknown slug rather than showing it raw', () => {
    expect(retailerLabel('lincoln-market')).toBe('Lincoln Market');
    expect(retailerLabel('food-bazaar')).toBe('Food Bazaar');
  });
});

describe('push routing', () => {
  it('only offers a push where Stock has a real fill path', () => {
    // Walmart = deep link, Wegmans/Costco = the Instacart agent. Everything
    // else the scan can PRICE but nothing can SEND to, and the old router fell
    // through to Wegmans — i.e. filled the wrong store's cart.
    expect(canPush('walmart')).toBe(true);
    expect(canPush('wegmans')).toBe(true);
    expect(canPush('costco')).toBe(true);
    expect(canPush('shoprite')).toBe(false);
    expect(canPush('food-bazaar')).toBe(false);
    expect(canPush('key-food')).toBe(false);
    expect(canPush('stop-shop')).toBe(false);
  });
});
