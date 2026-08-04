/**
 * The Walmart catalog Stock should actually use right now.
 *
 * Three layers, best first:
 *   1. the nightly refresh published to Supabase by the Beelink walmart-agent
 *   2. the last one we cached locally (so it survives offline / signed out)
 *   3. the copy bundled at build time (walmartCatalog.ts)
 *
 * The bundled layer is what makes this safe to add: if Supabase is unreachable,
 * the user is signed out, or the box hasn't run in a week, Compare still works.
 * It just quietly goes stale, and `refreshedAt` says how stale.
 *
 * Everything here is synchronous to read. `hydrateWalmartCatalog()` swaps the
 * active catalog in the background; callers get the best layer available at the
 * moment they ask, and re-render when it lands.
 */
import { supabase } from './supabase';
import { webPersist } from './db/webStore';
import {
  WALMART_ALIASES,
  WALMART_BY_ID,
  WALMART_PRODUCTS,
  WALMART_STORE,
} from './walmartCatalog';
import type { WalmartProduct } from './walmartCatalog';

export type WalmartCatalog = {
  products: WalmartProduct[];
  aliases: Record<string, string>;
  byId: Record<string, WalmartProduct>;
  /** Store the PRICES came from. May not be Nate's own — see `isOwnStore`. */
  storeId: string;
  refreshedAt: string;
  source: 'bundled' | 'cached' | 'live';
  /** Terms the last refresh confirmed Walmart doesn't carry. */
  notStocked: string[];
};

const CACHE_KEY = 'walmartCatalog';

/** Nate's real store. Prices from any other store are an estimate, not his. */
export const OWN_STORE_ID = '5293';

const BUNDLED: WalmartCatalog = {
  products: WALMART_PRODUCTS,
  aliases: WALMART_ALIASES,
  byId: WALMART_BY_ID,
  storeId: WALMART_STORE.id,
  refreshedAt: WALMART_STORE.harvestedAt,
  source: 'bundled',
  notStocked: [],
};

let active: WalmartCatalog = BUNDLED;
const listeners = new Set<() => void>();

/** The catalog to quote against right now. Never null. */
export function activeWalmartCatalog(): WalmartCatalog {
  return active;
}

/** Whether the active prices came from Nate's own store or a nearby one. */
export function isOwnStore(c: WalmartCatalog = active): boolean {
  return c.storeId === OWN_STORE_ID;
}

export function onWalmartCatalogChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type Snapshot = {
  store_id: string | null;
  refreshed_at: string;
  data: {
    aliases?: Record<string, string>;
    products?: WalmartProduct[];
    notStocked?: string[];
  };
};

function build(snap: Snapshot, source: 'cached' | 'live'): WalmartCatalog | null {
  const products = snap?.data?.products;
  // An empty product list would turn every item into "Walmart doesn't have it"
  // and silently send every order to Wegmans. Refuse it and keep the fallback.
  if (!Array.isArray(products) || products.length === 0) return null;
  return {
    products,
    aliases: snap.data.aliases ?? {},
    byId: Object.fromEntries(products.map((p) => [p.itemId, p])),
    storeId: snap.store_id ?? '',
    refreshedAt: snap.refreshed_at,
    source,
    notStocked: snap.data.notStocked ?? [],
  };
}

function adopt(next: WalmartCatalog) {
  active = next;
  for (const fn of listeners) fn();
}

/**
 * Load the freshest catalog available. Safe to call more than once and safe to
 * ignore the promise — a failure just leaves whatever's already active.
 */
export async function hydrateWalmartCatalog(): Promise<WalmartCatalog> {
  // Local cache first so a cold start is instant and works offline.
  try {
    const cached = await webPersist.load<Snapshot>(CACHE_KEY);
    if (cached) {
      const built = build(cached, 'cached');
      if (built) adopt(built);
    }
  } catch {
    /* no cache yet */
  }

  if (!supabase) return active;
  try {
    const { data, error } = await supabase
      .from('walmart_catalog')
      .select('store_id, refreshed_at, data')
      .eq('id', 'current')
      .maybeSingle();
    // Signed out, RLS-filtered, or offline all land here. Not an error worth
    // surfacing — the bundled catalog is a perfectly good answer.
    if (error || !data) return active;

    const built = build(data as Snapshot, 'live');
    if (!built) return active;
    adopt(built);
    void webPersist.save(CACHE_KEY, data);
  } catch {
    /* keep whatever we have */
  }
  return active;
}
