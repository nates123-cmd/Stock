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

type RawLine = {
  query: string;
  status: 'exact' | 'missing' | 'unknown';
  name?: string;
  price?: number;
};

type RawQuote = {
  slug: string;
  name?: string;
  eta?: string | null;
  distanceMi?: number | null;
  lines: RawLine[];
  subtotal: number;
};

export type ScanResult = {
  scannedAt?: string;
  quotes?: RawQuote[];
  /** Anchor mode: stores Instacart surfaced for a term. */
  stores?: { slug: string; name: string; eta?: string | null; distanceMi?: number | null }[];
  unresolved?: number;
  note?: string;
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

/** Queue a basket scan. Returns the job id. */
export async function queueScan(
  items: { name: string; qty?: number }[],
  stores: readonly string[] = SCAN_STORES,
): Promise<string> {
  if (!supabase) throw new Error('Sign in to scan live prices.');
  if (!items.length) throw new Error('Nothing selected to price.');
  const { data, error } = await supabase
    .from('store_scan_jobs')
    .insert({ stores, items }) // user_id defaults to auth.uid()
    .select('id')
    .single();
  if (error) throw new Error(friendlyInsertError(error.message));
  return data.id as string;
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
