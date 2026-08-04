/**
 * Push a shopping list to the Walmart cart — for delivery from Nate's store.
 *
 * Unlike the Wegmans/Costco push, there is **no bot and no backend here**.
 * Walmart publishes a keyless add-to-cart link, and one navigation fills the
 * whole cart:
 *
 *     https://affil.walmart.com/cart/addToCart?items=<itemId>_<qty>,<itemId>_<qty>
 *
 * Opened in a browser Nate is already signed into, it lands on /shoppingcart
 * with Delivery pre-selected, the store's slot and fee shown, and every line
 * priced. That isn't automation, so there is nothing to detect and no session
 * to keep warm. (Verified live 2026-08-03: two items, correct quantities,
 * "Delivery — all items available".)
 *
 * STOP AT THE CART. Walmart's terms ban automated *purchasing*; adding is the
 * thing they publish this link for. Nate taps "Continue to checkout" himself.
 *
 * The one thing we can't do client-side is search — walmart.com is same-origin
 * only, and its search sits behind PerimeterX. So names resolve against the
 * pinned catalog in walmartCatalog.ts, and anything not in it is reported as a
 * gap rather than guessed at.
 */
import { matchCatalog } from './catalogMatch';
import { activeWalmartCatalog } from './walmartLive';
import type { WalmartProduct } from './walmartCatalog';

const ADD_TO_CART = 'https://affil.walmart.com/cart/addToCart';

/**
 * Walmart truncates very long item lists. Batch well under any cliff — two
 * tabs is a fine price for never silently dropping the last few items.
 */
export const MAX_ITEMS_PER_LINK = 40;

export type WalmartLine = {
  /** What Stock called it. */
  query: string;
  qty: number;
  product: WalmartProduct | null;
  /** How we got here — pins are trustworthy, name matches less so. */
  via: 'alias' | 'name' | 'none';
};

export type WalmartQuote = {
  lines: WalmartLine[];
  matched: WalmartLine[];
  /** Queries the catalog has no SKU for. The useful half of the answer. */
  missing: string[];
  /** Matched but flagged out of stock at last harvest. */
  maybeOutOfStock: WalmartLine[];
  /**
   * Matched, but shipped from a warehouse rather than picked at the store —
   * so they land in a separate cart group and arrive in days, not on the
   * same-day delivery slot. Called out because Nate's ask is delivery.
   */
  shipsSeparately: WalmartLine[];
  /** Estimated basket from snapshot prices. Not a promise — see walmartCatalog. */
  estimatedSubtotal: number;
  /** Which catalog answered, how old it is, and which store priced it. */
  store: { id: string; refreshedAt: string; source: 'bundled' | 'cached' | 'live' };
};

/** Resolve a whole list into a quote: what's in, what's out, what it'll run. */
export function quoteWalmart(items: { name: string; qty?: number }[]): WalmartQuote {
  // Read the catalog ONCE per quote. It can be swapped out from under us by a
  // background refresh, and half a basket priced against each version would be
  // a subtotal that matches neither.
  const cat = activeWalmartCatalog();
  const lines: WalmartLine[] = items.map(({ name, qty }) => {
    const { product, via } = matchCatalog(name, cat.products, cat.aliases, cat.byId);
    return { query: name, qty: Math.max(1, qty ?? 1), product, via };
  });
  const matched = lines.filter((l) => l.product);
  return {
    lines,
    matched,
    missing: lines.filter((l) => !l.product).map((l) => l.query),
    maybeOutOfStock: matched.filter((l) => l.product?.outOfStock),
    shipsSeparately: matched.filter((l) => l.product?.fulfillment === 'ship'),
    estimatedSubtotal:
      Math.round(matched.reduce((s, l) => s + (l.product!.price * l.qty), 0) * 100) / 100,
    store: { id: cat.storeId, refreshedAt: cat.refreshedAt, source: cat.source },
  };
}

/** Build the add-to-cart URL(s). One per batch of MAX_ITEMS_PER_LINK. */
export function cartLinks(lines: WalmartLine[]): string[] {
  const parts = lines
    .filter((l) => l.product)
    .map((l) => `${l.product!.itemId}_${Math.max(1, l.qty)}`);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += MAX_ITEMS_PER_LINK) {
    out.push(`${ADD_TO_CART}?items=${parts.slice(i, i + MAX_ITEMS_PER_LINK).join(',')}`);
  }
  return out;
}

/** Walmart is available to everyone — no sign-in, no backend, just a link. */
export const WALMART_AVAILABLE = () => true;
