/**
 * On-demand live price scan across Instacart storefronts.
 *
 * The bundled catalogs answer instantly but only cover Walmart and Wegmans and
 * only what Nate has bought before. This asks the Beelink to go look at real
 * storefronts right now — slower (a minute or two), but current, and it covers
 * any store on his Instacart.
 *
 * Read-only end to end: queues a row on `store_scan_jobs`, the box drives a
 * logged-in Instacart session, nothing is ever added to a cart.
 */
import { supabase } from './supabase';
import { parseSize, unitPrice } from './size';
import type { QuoteLine, StoreQuote } from './quotes';

/** Instacart storefront slugs Nate picked for comparison. */
export const SCAN_STORES = ['wegmans', 'food-bazaar', 'shoprite', 'key-food', 'stop-shop'] as const;
export type ScanStore = (typeof SCAN_STORES)[number];

export const STORE_LABEL: Record<string, string> = {
  wegmans: 'Wegmans',
  'food-bazaar': 'Food Bazaar',
  shoprite: 'ShopRite',
  'key-food': 'Key Food',
  'stop-shop': 'Stop & Shop',
  costco: 'Costco',
  walmart: 'Walmart (Instacart)',
};

/**
 * Stores Stock can actually SEND a list to.
 *
 * Everything else is compare-only: the live scan can price Food Bazaar or
 * ShopRite, but there is no fill path for them — Walmart has its deep link,
 * and the Instacart agent only knows how to drive the wegmans and costco
 * storefronts. Offering a push we can't honour would fill the WRONG store's
 * cart, which is exactly the failure this whole feature exists to prevent.
 */
export const PUSHABLE_STORES = new Set(['walmart', 'wegmans', 'costco']);

export const canPush = (retailer: string) => PUSHABLE_STORES.has(retailer);

export type ScanStatus = 'queued' | 'running' | 'done' | 'error';

/** What a job does: look at prices, or actually build carts. */
export type ScanMode = 'scan' | 'fill' | 'walmart';

type RawLine = {
  query: string;
  status: 'exact' | 'missing' | 'unknown';
  name?: string;
  price?: number;
  itemId?: string;
  fulfillment?: 'store' | 'ship';
};

type RawQuote = {
  slug: string;
  name?: string;
  eta?: string | null;
  distanceMi?: number | null;
  lines: RawLine[];
  subtotal: number;
};

/** A store whose real cart was filled. `added` is what landed in it. */
/** One item resolved against Walmart's live search. */
export type WalmartLiveLine = {
  query: string;
  status: 'exact' | 'missing' | 'unknown';
  itemId?: string;
  name?: string;
  price?: number;
  fulfillment?: 'store' | 'ship';
};

export type FilledCart = {
  slug: string;
  lines: { query: string; status: 'added' | 'missing' | 'failed'; name?: string; price?: number; alreadyInCart?: boolean }[];
  subtotal: number;
  added: number;
  missing: string[];
  failed: string[];
  cartItemCount?: number | null;
};

export type ScanResult = {
  scannedAt?: string;
  quotes?: RawQuote[];
  /** Anchor mode: stores Instacart surfaced for a term. */
  stores?: { slug: string; name: string; eta?: string | null; distanceMi?: number | null }[];
  unresolved?: number;
  note?: string;
  /** Present on a `fill` job: the carts that were actually built. */
  carts?: FilledCart[];
  /** Present on a `walmart` job: items resolved to Walmart item ids. */
  lines?: WalmartLiveLine[];
  retailer?: string;
  matched?: number;
  ships?: number;
  subtotal?: number;
  storeId?: string | null;
};

export const SCAN_AVAILABLE = () => !!supabase;

/**
 * Signed-out inserts fail RLS, and Postgres phrases that as "new row violates
 * row-level security policy for table …" — true, and useless to read. The job
 * table is per-user, so that error only ever means one thing.
 */
function friendlyInsertError(message: string): string {
  return /row-level security|violates row/i.test(message)
    ? 'Sign in to check live prices.'
    : message;
}

/**
 * Queue a job. `scan` only reads prices; `fill` puts the items in each store's
 * REAL cart so the winner is ready to check out.
 */
export async function queueScan(
  items: { name: string; qty?: number }[],
  stores: readonly string[] = SCAN_STORES,
  mode: ScanMode = 'scan',
): Promise<string> {
  if (!supabase) throw new Error('Sign in to scan live prices.');
  if (!items.length) throw new Error('Nothing selected to price.');
  const { data, error } = await supabase
    .from('store_scan_jobs')
    .insert({ stores, items, mode }) // user_id defaults to auth.uid()
    .select('id')
    .single();
  if (error) throw new Error(friendlyInsertError(error.message));
  return data.id as string;
}

/**
 * Resolve a list against Walmart's LIVE search.
 *
 * The bundled catalogue is 50 staple terms, so a real list mostly missed —
 * 2 of 11 items. This asks the box to look each one up for real; it takes about
 * six seconds an item, and nothing is added to a cart until Nate opens the link.
 */
export const queueWalmartResolve = (items: { name: string; qty?: number }[]) =>
  queueScan(items, [], 'walmart');

/** Build a real cart at each store and report what landed. */
export const queueCartFill = (
  items: { name: string; qty?: number }[],
  stores: readonly string[] = SCAN_STORES,
) => queueScan(items, stores, 'fill');

/**
 * Turn filled carts into the shared quote shape.
 *
 * `added` maps to `exact` — the item is in the cart. It does NOT mean bought,
 * and it doesn't even mean available: Instacart accepts the add and only then
 * flags "not available in your area", so the cart itself is the source of truth
 * and this is a report of what we put there.
 */
export function cartsToQuotes(result: ScanResult | null | undefined): StoreQuote[] {
  if (!result?.carts?.length) return [];
  return result.carts.map((c) => {
    const lines: QuoteLine[] = c.lines.map((l) => {
      if (l.status !== 'added' || l.price == null) {
        return { query: l.query, qty: 1, status: l.status === 'failed' ? 'unknown' : 'missing' };
      }
      const size = parseSize(l.name ?? '');
      return { query: l.query, qty: 1, status: 'exact', name: l.name, price: l.price, size, unit: unitPrice(l.price, size) };
    });
    return {
      retailer: c.slug,
      label: STORE_LABEL[c.slug] ?? c.slug,
      lines,
      subtotal: c.subtotal,
      fees: undefined,
      complete: true,
      note: `Cart filled — ${c.added} item${c.added === 1 ? '' : 's'} in. Fees and markup not included.`,
    };
  });
}

/** Queue an anchor scan: which stores near me carry this? */
export async function queueAnchorScan(anchor: string): Promise<string> {
  if (!supabase) throw new Error('Sign in to scan live prices.');
  const term = anchor.trim();
  if (!term) throw new Error('Give me something to look for.');
  const { data, error } = await supabase
    .from('store_scan_jobs')
    .insert({ anchor: term })
    .select('id')
    .single();
  if (error) throw new Error(friendlyInsertError(error.message));
  return data.id as string;
}

export async function scanStatus(
  id: string,
): Promise<{ status: ScanStatus; result: ScanResult | null; error: string | null } | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from('store_scan_jobs')
    .select('status, result, error')
    .eq('id', id)
    .single();
  return (data as { status: ScanStatus; result: ScanResult | null; error: string | null }) ?? null;
}

/**
 * Turn a finished scan into the same StoreQuote shape the bundled catalogs
 * produce, so the comparison engine doesn't care where a quote came from.
 *
 * `unknown` is carried through rather than folded into `missing`. The scanner
 * uses it for a store/item pair it never managed to check, and calling that
 * "doesn't carry it" would invent a gap — the same lie in the other direction.
 */
export function scanToQuotes(result: ScanResult | null | undefined): StoreQuote[] {
  if (!result?.quotes?.length) return [];
  return result.quotes.map((q) => {
    const lines: QuoteLine[] = q.lines.map((l) => {
      if (l.status !== 'exact' || l.price == null) {
        return { query: l.query, qty: 1, status: l.status === 'unknown' ? 'unknown' : 'missing' };
      }
      const size = parseSize(l.name ?? '');
      return {
        query: l.query,
        qty: 1,
        status: 'exact',
        name: l.name,
        price: l.price,
        size,
        unit: unitPrice(l.price, size),
      };
    });
    return {
      retailer: q.slug,
      label: STORE_LABEL[q.slug] ?? q.name ?? q.slug,
      lines,
      subtotal: q.subtotal,
      // Instacart's delivery + service fees depend on basket and slot, so they
      // stay unknown rather than being guessed at zero.
      fees: undefined,
      etaText: q.eta ?? undefined,
      distanceMi: q.distanceMi ?? undefined,
      complete: true,
      note: 'Live from Instacart. Delivery + service fees not included.',
    };
  });
}
