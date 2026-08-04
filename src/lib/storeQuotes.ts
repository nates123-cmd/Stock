/**
 * Quote the same shopping list at every store, so they can be compared.
 *
 * Both providers here run entirely on bundled catalogs — no network, no
 * Beelink, no sign-in. That's the point: the comparison has to be instant and
 * always available, because its whole job is to be consulted *before* you
 * commit to a store. A comparison you have to wait ninety seconds for is one
 * you'll skip.
 *
 * The trade is precision. Catalog prices are snapshots (Walmart 2026-08-03,
 * Wegmans 2026-07-01) and coverage is limited to what Nate has bought before.
 * So this answers "which store, roughly" — and then the store's own cart shows
 * the real total before he checks out. Never present these numbers as final.
 */
import { matchCatalog } from './catalogMatch';
import { parseSize, unitPrice } from './size';
import type { QuoteLine, QuoteRetailer, StoreQuote } from './quotes';
import { activeWalmartCatalog, isOwnStore } from './walmartLive';
import { WEGMANS_ALIASES, WEGMANS_BY_ID, WEGMANS_PRODUCTS } from './wegmansCatalog';

export type QuoteInput = { name: string; qty?: number };

function lineFor(
  input: QuoteInput,
  hit: { product: { name: string; price: number } | null },
): QuoteLine {
  const qty = Math.max(1, input.qty ?? 1);
  if (!hit.product) return { query: input.name, qty, status: 'missing' };
  // Size comes from the product name — the one field every source carries.
  // Null when it isn't stated, and the comparison then says it's comparing
  // pack prices rather than inventing a per-ounce figure.
  const size = parseSize(hit.product.name);
  return {
    query: input.name,
    qty,
    status: 'exact',
    name: hit.product.name,
    price: hit.product.price,
    size,
    unit: unitPrice(hit.product.price, size),
  };
}

const subtotalOf = (lines: QuoteLine[]) =>
  Math.round(lines.reduce((s, l) => s + (l.price ?? 0) * l.qty, 0) * 100) / 100;

export function quoteWalmartStore(items: QuoteInput[]): StoreQuote {
  const cat = activeWalmartCatalog();
  const hits = items.map((i) => matchCatalog(i.name, cat.products, cat.aliases, cat.byId));
  const lines = items.map((i, n) => lineFor(i, hits[n]!));

  // Walmart splits a cart: store-picked items ride a same-day delivery slot,
  // warehouse/marketplace items ship and arrive in days. Saying "delivery"
  // over a basket that's half shipped would be the wrong answer to the
  // question Nate is actually asking.
  const shipping = hits.filter((h) => h.product?.fulfillment === 'ship').length;

  const split = shipping
    ? `Delivery from your store, but ${
        shipping === 1 ? '1 item ships separately and arrives' : `${shipping} items ship separately and arrive`
      } in a few days.`
    : 'Delivery from your store. Cart shows the real total.';

  // When the prices came from a nearby store rather than his own, say so. The
  // cart is still exact — it resolves against HIS store when he opens it — but
  // the estimate here can miss his rollbacks, and quietly presenting it as his
  // pricing is the kind of small lie that makes the whole comparison untrusted.
  const caveat = isOwnStore(cat) ? '' : ' Priced from a nearby store, so the total is a ballpark.';

  return {
    retailer: 'walmart',
    lines,
    subtotal: subtotalOf(lines),
    // Walmart+ covers delivery on qualifying orders; the cart shows the real
    // fee (and any small-basket charge) once the slot is picked.
    fees: 0,
    complete: true,
    note: split + caveat,
  };
}

export function quoteWegmansStore(items: QuoteInput[]): StoreQuote {
  const lines = items.map((i) =>
    lineFor(i, matchCatalog(i.name, WEGMANS_PRODUCTS, WEGMANS_ALIASES, WEGMANS_BY_ID)),
  );
  return {
    retailer: 'wegmans',
    lines,
    subtotal: subtotalOf(lines),
    // Left undefined rather than guessed: Instacart's delivery + service fees
    // depend on basket size and slot, and inventing a number here would make
    // the price comparison quietly wrong in Wegmans' favour.
    fees: undefined,
    complete: true,
    note: 'Via Instacart. Delivery + service fees not included.',
  };
}

/**
 * Quote every store we can price locally.
 *
 * Costco is deliberately absent: it runs through the Instacart agent with live
 * search and no pinned catalog, so there is nothing here to price it from.
 * Showing it with a blank or zero total would read as "Costco is cheapest",
 * which is the exact failure mode this whole feature exists to prevent.
 */
export function quoteAllStores(items: QuoteInput[]): StoreQuote[] {
  if (!items.length) return [];
  return [quoteWalmartStore(items), quoteWegmansStore(items)];
}

/** Stores this build can quote without a backend. */
export const QUOTABLE: QuoteRetailer[] = ['walmart', 'wegmans'];
