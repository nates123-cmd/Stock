/**
 * Cart comparison — "who should I actually order this from?"
 *
 * Every store answers the same three questions about the same list: what does
 * it carry, what does it cost, and when can it get here. A `StoreQuote` is that
 * answer in one shape, so Wegmans-via-Instacart, Costco and Walmart can be laid
 * side by side even though the machinery behind each is completely different.
 *
 * Deliberately pure: no network, no store, no React. Providers go get the data;
 * this file only judges it. That's what makes the verdicts testable.
 *
 * The output Nate asked for, in his words: "Wegmans doesn't have green beans",
 * "Walmart is gonna be twenty dollars cheaper", "Wegmans won't deliver till
 * tomorrow." So the comparison is three axes — coverage, price, speed — and
 * coverage outranks the other two. A basket that's $8 cheaper because it's
 * quietly missing the thing you're cooking tonight is not cheaper.
 */

import { describeSize, sizesDiverge, type ParsedSize, type UnitPrice } from './size';

/**
 * A store id. The bundled catalogs use 'walmart'/'wegmans'; a live Instacart
 * scan can return any storefront slug ('food-bazaar', 'shoprite', …), so this
 * is deliberately open rather than a closed union.
 */
export type QuoteRetailer = string;

const KNOWN_LABELS: Record<string, string> = {
  walmart: 'Walmart',
  wegmans: 'Wegmans',
  costco: 'Costco',
  'food-bazaar': 'Food Bazaar',
  shoprite: 'ShopRite',
  'key-food': 'Key Food',
  'stop-shop': 'Stop & Shop',
};

/** Title-case a slug we don't have a name for, so nothing renders as "key-food". */
const titleize = (slug: string) =>
  slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Display name for a store id, falling back to a tidied-up slug. */
export function retailerLabel(slug: QuoteRetailer): string {
  return KNOWN_LABELS[slug] ?? titleize(String(slug));
}

export type QuoteLine = {
  /** The list item this answers, verbatim, so lines can be joined across stores. */
  query: string;
  qty: number;
  /**
   * `unknown` is NOT `missing`. A live scan uses it for a store/item pair it
   * never managed to check; treating that as "doesn't carry it" would invent a
   * gap, which is the same lie as inventing coverage.
   */
  status: 'exact' | 'substitute' | 'missing' | 'unknown';
  /** Resolved product name, when the store has something. */
  name?: string;
  /** Price of ONE PACK in dollars — not per ounce. See `unit`. */
  price?: number;
  /** Pack size parsed from the name, when there is one. */
  size?: ParsedSize | null;
  /** Price per ounce / fl oz / item. The only fair way to compare two packs. */
  unit?: UnitPrice | null;
};

export type StoreQuote = {
  retailer: QuoteRetailer;
  /** Display name, when the source knows it better than the slug does. */
  label?: string;
  lines: QuoteLine[];
  /** Cost of what this store can actually supply. */
  subtotal: number;
  /**
   * Earliest delivery, as an ISO timestamp. Absent means unknown — which is
   * NOT the same as slow, and must never be rendered as if it were.
   */
  earliestDelivery?: string;
  /**
   * Instacart's own wording, e.g. "Delivery by 10:05pm". Kept verbatim rather
   * than parsed into a timestamp — it's already the clearest form, and a bad
   * parse would silently reorder stores by speed.
   */
  etaText?: string;
  distanceMi?: number;
  /** Delivery + service fees, when known. */
  fees?: number;
  /** False when the quote couldn't be trusted end to end (stale session, etc). */
  complete?: boolean;
  note?: string;
};

export type StoreSummary = {
  retailer: QuoteRetailer;
  label: string;
  /** Items this store can supply outright. */
  have: number;
  /** Items it offers a stand-in for. */
  substitutes: number;
  missing: string[];
  /** Never checked — distinct from missing, and never counted as either. */
  unknown: string[];
  total: number;
  subtotal: number;
  /** subtotal + fees, the number that actually leaves the account. */
  allIn: number;
  earliestDelivery?: string;
  etaText?: string;
  distanceMi?: number;
  complete: boolean;
};

export type Comparison = {
  stores: StoreSummary[];
  /** One line each, ranked most decision-changing first. */
  verdicts: string[];
  /** Best all-round store, or null when nothing is comparable. */
  recommended: QuoteRetailer | null;
  /** Items no store in the comparison carries. */
  nobodyHas: string[];
  /**
   * Per-item availability across stores — the grid view. Key is the query.
   */
  matrix: { query: string; byStore: Record<string, QuoteLine | undefined> }[];
};

const money = (n: number) => `$${n.toFixed(2)}`;

/** "Today, 6pm" / "Tomorrow, 9am" — a slot you can reason about at a glance. */
export function describeSlot(iso?: string, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  const time = d
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(':00', '');
  if (days <= 0) return `today, ${time}`;
  if (days === 1) return `tomorrow, ${time}`;
  return `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${time}`;
}

function summarize(q: StoreQuote): StoreSummary {
  const have = q.lines.filter((l) => l.status === 'exact').length;
  const substitutes = q.lines.filter((l) => l.status === 'substitute').length;
  return {
    retailer: q.retailer,
    label: q.label ?? retailerLabel(q.retailer),
    have,
    substitutes,
    missing: q.lines.filter((l) => l.status === 'missing').map((l) => l.query),
    // Never rolled into `missing`: these were never checked.
    unknown: q.lines.filter((l) => l.status === 'unknown').map((l) => l.query),
    total: q.lines.length,
    subtotal: q.subtotal,
    allIn: Math.round((q.subtotal + (q.fees ?? 0)) * 100) / 100,
    earliestDelivery: q.earliestDelivery,
    etaText: q.etaText,
    distanceMi: q.distanceMi,
    complete: q.complete !== false,
  };
}

/**
 * Compare quotes and say something useful about them.
 *
 * Price is only compared between stores that carry the SAME number of items —
 * otherwise "cheaper" just means "gave you less", which is the single easiest
 * way for a comparison like this to lie.
 */
export function compareQuotes(quotes: StoreQuote[], now = new Date()): Comparison {
  const stores = quotes.map(summarize);
  const verdicts: string[] = [];

  const allQueries: string[] = [];
  for (const q of quotes) {
    for (const l of q.lines) if (!allQueries.includes(l.query)) allQueries.push(l.query);
  }

  const matrix = allQueries.map((query) => ({
    query,
    byStore: Object.fromEntries(
      quotes.map((q) => [q.retailer, q.lines.find((l) => l.query === query)]),
    ) as Record<string, QuoteLine | undefined>,
  }));

  // Only claim nobody has it when every store actually SAID so. One `unknown`
  // and we don't know, so we don't say.
  const nobodyHas = matrix
    .filter((row) => {
      const seen = Object.values(row.byStore).filter(Boolean) as QuoteLine[];
      return seen.length > 0 && seen.every((l) => l.status === 'missing');
    })
    .map((r) => r.query);

  // ── coverage ────────────────────────────────────────────────────────────
  // Gaps first: this is the thing you can't discover after you've checked out.
  for (const s of stores) {
    if (!s.missing.length) continue;
    const list = s.missing.slice(0, 3).join(', ');
    const more = s.missing.length > 3 ? ` and ${s.missing.length - 3} more` : '';
    verdicts.push(`${s.label} doesn't have ${list}${more}.`);
  }
  if (nobodyHas.length) {
    verdicts.push(`No store here carries ${nobodyHas.join(', ')} — that one's a local pickup.`);
  }

  // ── pack sizes ──────────────────────────────────────────────────────────
  // A store can look cheaper purely by selling less. Where the same item comes
  // in materially different packs, say which is actually better value per
  // ounce — otherwise the price line below is comparing two different things.
  for (const row of matrix) {
    const priced = Object.entries(row.byStore).filter(
      ([, l]) => l && l.status !== 'missing' && l.price != null && l.unit,
    ) as [string, QuoteLine][];
    if (priced.length < 2) continue;

    const [aKey, a] = priced[0]!;
    const worst = priced.slice(1).find(([, b]) => sizesDiverge(a.size ?? null, b.size ?? null));
    if (!worst) continue;
    const [bKey, b] = worst;

    const cheaperPack = a.price! <= b.price! ? { k: aKey, l: a } : { k: bKey, l: b };
    const betterValue = a.unit!.value <= b.unit!.value ? { k: aKey, l: a } : { k: bKey, l: b };

    const label = (k: string) => retailerLabel(k);
    const desc = (l: QuoteLine) =>
      `${money(l.price!)} for ${describeSize(l.size ?? null) ?? 'an unlisted size'}`;

    verdicts.push(
      cheaperPack.k === betterValue.k
        ? `${row.query}: ${label(cheaperPack.k)} ${desc(cheaperPack.l)} vs ${label(cheaperPack.k === aKey ? bKey : aKey)} ${desc(cheaperPack.k === aKey ? b : a)} — cheaper either way.`
        : // The trap: the smaller pack has the smaller sticker price.
          `${row.query}: ${label(cheaperPack.k)} is ${desc(cheaperPack.l)} but ${label(betterValue.k)} is ${desc(betterValue.l)} — ${label(betterValue.k)} is better value at ${betterValue.l.unit!.label}.`,
    );
  }

  // ── price ───────────────────────────────────────────────────────────────
  const best = [...stores].sort((a, b) => a.allIn - b.allIn)[0];
  const rest = stores.filter((s) => s.retailer !== best?.retailer);
  if (best && rest.length) {
    for (const other of rest) {
      const gap = Math.round((other.allIn - best.allIn) * 100) / 100;
      if (gap <= 0) continue;
      const sameCoverage = other.have + other.substitutes === best.have + best.substitutes;
      verdicts.push(
        sameCoverage
          ? `${best.label} is ${money(gap)} cheaper than ${other.label} for the same items.`
          : `${best.label} is ${money(gap)} less than ${other.label}, but it's ${best.have + best.substitutes} items to ${other.have + other.substitutes} — not the same basket.`,
      );
    }
  }

  // ── speed ───────────────────────────────────────────────────────────────
  const dated = stores.filter((s) => s.earliestDelivery);
  if (dated.length > 1) {
    const sorted = [...dated].sort(
      (a, b) => Date.parse(a.earliestDelivery!) - Date.parse(b.earliestDelivery!),
    );
    const fastest = sorted[0]!;
    for (const s of sorted.slice(1)) {
      const a = describeSlot(fastest.earliestDelivery, now);
      const b = describeSlot(s.earliestDelivery, now);
      if (a && b && a !== b) verdicts.push(`${s.label} can't deliver until ${b}; ${fastest.label} can do ${a}.`);
    }
  }

  // ── speed, as the store itself worded it ────────────────────────────────
  // A live scan hands back Instacart's own text ("Delivery by 10:05pm"), which
  // is clearer than anything we'd derive and can't be mis-parsed into a wrong
  // ordering. Only mention it when the stores actually differ.
  const withEta = stores.filter((s) => s.etaText);
  if (withEta.length > 1) {
    const distinct = new Set(withEta.map((s) => s.etaText));
    if (distinct.size > 1) {
      const soonest = withEta.find((s) => /today|hour|min|\dpm|\dam/i.test(s.etaText!) && !/tomorrow/i.test(s.etaText!));
      const later = withEta.filter((s) => /tomorrow/i.test(s.etaText ?? ''));
      for (const s of later) {
        verdicts.push(
          soonest
            ? `${s.label} is ${s.etaText!.toLowerCase()}; ${soonest.label} can do ${soonest.etaText!.toLowerCase()}.`
            : `${s.label} is ${s.etaText!.toLowerCase()}.`,
        );
      }
    }
  }

  for (const s of stores) {
    if (s.unknown.length) {
      verdicts.push(
        `Couldn't check ${s.unknown.slice(0, 3).join(', ')}${s.unknown.length > 3 ? ` and ${s.unknown.length - 3} more` : ''} at ${s.label} — not counted either way.`,
      );
    }
    if (!s.complete) verdicts.push(`${s.label}'s quote didn't finish — treat its total as a guess.`);
  }

  // ── pick one ────────────────────────────────────────────────────────────
  // Coverage, then all-in price. Speed is a tiebreak, never a reason to accept
  // a store that's missing things.
  const ranked = [...stores].sort((a, b) => {
    const cov = (b.have + b.substitutes) - (a.have + a.substitutes);
    if (cov) return cov;
    if (a.allIn !== b.allIn) return a.allIn - b.allIn;
    const at = a.earliestDelivery ? Date.parse(a.earliestDelivery) : Infinity;
    const bt = b.earliestDelivery ? Date.parse(b.earliestDelivery) : Infinity;
    return at - bt;
  });

  return {
    stores,
    verdicts,
    recommended: ranked[0]?.retailer ?? null,
    nobodyHas,
    matrix,
  };
}
