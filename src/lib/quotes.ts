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

export type QuoteRetailer = 'walmart' | 'wegmans' | 'costco';

export const RETAILER_LABEL: Record<QuoteRetailer, string> = {
  walmart: 'Walmart',
  wegmans: 'Wegmans',
  costco: 'Costco',
};

export type QuoteLine = {
  /** The list item this answers, verbatim, so lines can be joined across stores. */
  query: string;
  qty: number;
  status: 'exact' | 'substitute' | 'missing';
  /** Resolved product name, when the store has something. */
  name?: string;
  /** Per-unit price in dollars. */
  price?: number;
};

export type StoreQuote = {
  retailer: QuoteRetailer;
  lines: QuoteLine[];
  /** Cost of what this store can actually supply. */
  subtotal: number;
  /**
   * Earliest delivery, as an ISO timestamp. Absent means unknown — which is
   * NOT the same as slow, and must never be rendered as if it were.
   */
  earliestDelivery?: string;
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
  total: number;
  subtotal: number;
  /** subtotal + fees, the number that actually leaves the account. */
  allIn: number;
  earliestDelivery?: string;
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
    label: RETAILER_LABEL[q.retailer],
    have,
    substitutes,
    missing: q.lines.filter((l) => l.status === 'missing').map((l) => l.query),
    total: q.lines.length,
    subtotal: q.subtotal,
    allIn: Math.round((q.subtotal + (q.fees ?? 0)) * 100) / 100,
    earliestDelivery: q.earliestDelivery,
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

  const nobodyHas = matrix
    .filter((row) =>
      Object.values(row.byStore).every((l) => !l || l.status === 'missing'),
    )
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

  for (const s of stores) {
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
