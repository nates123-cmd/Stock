/**
 * Pack size and unit price.
 *
 * Without this a comparison is quietly wrong in the most expensive direction:
 * $3.99 for 12 oz of green beans "beats" $4.09 for 24 oz, so the cheaper-looking
 * store is the one selling you half as much. Same failure as calling a basket
 * with missing items cheaper — the number is right and the answer is useless.
 *
 * Sizes come from the product NAME, because that's the one field every source
 * has: Walmart's catalog, the Wegmans catalog, and Instacart's search results
 * all put it there ("Fresh Whole Carrots, 2 lb Bag", "Marketside Fresh
 * Asparagus Spears, 10 oz").
 *
 * Deliberately conservative: an unparseable name yields `null`, and callers
 * fall back to comparing pack prices while SAYING that's what they're doing.
 * A wrong size is worse than no size — it would produce a confident per-ounce
 * number built on a guess.
 */

export type SizeDimension = 'weight' | 'volume' | 'count';

export type ParsedSize = {
  /** As written, e.g. 2 for "2 lb Bag". */
  amount: number;
  /** As written, lowercased: 'lb', 'oz', 'fl oz', 'ct'… */
  unit: string;
  dimension: SizeDimension;
  /** Normalised: ounces for weight, fluid ounces for volume, items for count. */
  canonical: number;
  /** How many of the pack you get, e.g. "(4 Pack)" → 4. Multiplies canonical. */
  multiplier: number;
};

/** Conversions into the canonical unit of each dimension. */
const UNITS: Record<string, { dimension: SizeDimension; factor: number }> = {
  // weight → ounces
  oz: { dimension: 'weight', factor: 1 },
  ounce: { dimension: 'weight', factor: 1 },
  ounces: { dimension: 'weight', factor: 1 },
  lb: { dimension: 'weight', factor: 16 },
  lbs: { dimension: 'weight', factor: 16 },
  pound: { dimension: 'weight', factor: 16 },
  pounds: { dimension: 'weight', factor: 16 },
  g: { dimension: 'weight', factor: 0.035274 },
  gram: { dimension: 'weight', factor: 0.035274 },
  grams: { dimension: 'weight', factor: 0.035274 },
  kg: { dimension: 'weight', factor: 35.274 },
  // volume → fluid ounces
  'fl oz': { dimension: 'volume', factor: 1 },
  'fluid ounce': { dimension: 'volume', factor: 1 },
  'fluid ounces': { dimension: 'volume', factor: 1 },
  ml: { dimension: 'volume', factor: 0.033814 },
  l: { dimension: 'volume', factor: 33.814 },
  liter: { dimension: 'volume', factor: 33.814 },
  litre: { dimension: 'volume', factor: 33.814 },
  qt: { dimension: 'volume', factor: 32 },
  quart: { dimension: 'volume', factor: 32 },
  pt: { dimension: 'volume', factor: 16 },
  pint: { dimension: 'volume', factor: 16 },
  gal: { dimension: 'volume', factor: 128 },
  gallon: { dimension: 'volume', factor: 128 },
  // count → items
  ct: { dimension: 'count', factor: 1 },
  count: { dimension: 'count', factor: 1 },
  pack: { dimension: 'count', factor: 1 },
  pk: { dimension: 'count', factor: 1 },
  each: { dimension: 'count', factor: 1 },
};

// "12 oz", "2 lb", "1.5 lb", "500 g", "16 fl oz", "3.17 oz", "18 Count", "30-count"
const SIZE_RE =
  /(\d+(?:\.\d+)?)\s*-?\s*(fl\s*oz|fluid\s*ounces?|ounces?|oz|lbs?|pounds?|grams?|g|kg|ml|liters?|litres?|l|quarts?|qt|pints?|pt|gallons?|gal|counts?|ct|packs?|pk)\b/gi;

// "(4 Pack)", "6 Pack", "Pack of 3", "3-count" handled separately from the size
const MULTIPLIER_RE = /(?:\(?\s*(\d+)\s*[- ]?pack\s*\)?|pack of\s*(\d+))/i;

const normUnit = (u: string) => {
  const s = u.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^fl/.test(s)) return 'fl oz';
  if (/^(ounces?|oz)$/.test(s)) return 'oz';
  if (/^(lbs?|pounds?)$/.test(s)) return 'lb';
  if (/^(grams?|g)$/.test(s)) return 'g';
  if (/^(liters?|litres?|l)$/.test(s)) return 'l';
  if (/^(quarts?|qt)$/.test(s)) return 'qt';
  if (/^(pints?|pt)$/.test(s)) return 'pt';
  if (/^(gallons?|gal)$/.test(s)) return 'gal';
  if (/^(counts?|ct)$/.test(s)) return 'ct';
  if (/^(packs?|pk)$/.test(s)) return 'pack';
  return s;
};

/**
 * Pull a pack size out of a product name. Returns null when there isn't one we
 * trust — "Fresh Banana, Each" and "Crisp Fresh Celery Hearts" have no size,
 * and inventing one would be worse than admitting it.
 */
export function parseSize(name: string): ParsedSize | null {
  if (!name) return null;

  const multMatch = name.match(MULTIPLIER_RE);
  const multiplier = multMatch ? Number(multMatch[1] ?? multMatch[2]) || 1 : 1;

  // A name can carry several numbers ("Chuck Short Ribs, 3 - 4 per Tray,
  // 1.1 - 2.3 lb"). Take the LAST weight/volume match: sizes are conventionally
  // written at the end, and leading numbers are usually counts or percentages.
  const matches = [...name.matchAll(SIZE_RE)];
  if (!matches.length) return null;

  let best: ParsedSize | null = null;
  for (const m of matches) {
    const amount = Number(m[1]);
    const unit = normUnit(m[2]!);
    const def = UNITS[unit];
    if (!def || !Number.isFinite(amount) || amount <= 0) continue;
    // Ignore a bare "pack"/"count" that the multiplier already accounts for.
    if ((unit === 'pack' || unit === 'pk') && multMatch) continue;
    const parsed: ParsedSize = {
      amount,
      unit,
      dimension: def.dimension,
      canonical: amount * def.factor * multiplier,
      multiplier,
    };
    // Prefer weight/volume over a bare count — "18 Count" on an egg carton is
    // real, but a count next to an ounce figure is packaging detail.
    if (!best || (best.dimension === 'count' && parsed.dimension !== 'count')) best = parsed;
    else if (best.dimension === parsed.dimension) best = parsed; // last wins
  }
  return best;
}

export type UnitPrice = {
  /** Price per canonical unit (per oz / per fl oz / per item). */
  value: number;
  dimension: SizeDimension;
  /** Ready to render, e.g. "$0.17/oz". */
  label: string;
};

const UNIT_LABEL: Record<SizeDimension, string> = {
  weight: 'oz',
  volume: 'fl oz',
  count: 'ea',
};

/** Price per canonical unit, or null when the size is unknown. */
export function unitPrice(price: number | undefined, size: ParsedSize | null): UnitPrice | null {
  if (price == null || !size || size.canonical <= 0) return null;
  const value = price / size.canonical;
  return {
    value,
    dimension: size.dimension,
    // Sub-cent unit prices are common (grams, large packs); show enough digits
    // to be meaningful rather than a row of "$0.00".
    label: `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}/${UNIT_LABEL[size.dimension]}`,
  };
}

/** Human pack size, e.g. "2 lb", "12 oz", "4 × 3.5 oz". */
export function describeSize(size: ParsedSize | null): string | null {
  if (!size) return null;
  const base = `${size.amount} ${size.unit}`;
  return size.multiplier > 1 ? `${size.multiplier} × ${base}` : base;
}

/**
 * Are two sizes different enough that comparing pack prices would mislead?
 *
 * 25% is the threshold: below it the packs are near enough that the sticker
 * price is a fair comparison, above it the cheaper pack is often just smaller.
 */
export function sizesDiverge(a: ParsedSize | null, b: ParsedSize | null, tolerance = 0.25): boolean {
  if (!a || !b || a.dimension !== b.dimension) return false;
  const big = Math.max(a.canonical, b.canonical);
  const small = Math.min(a.canonical, b.canonical);
  if (small <= 0) return false;
  return (big - small) / big > tolerance;
}
