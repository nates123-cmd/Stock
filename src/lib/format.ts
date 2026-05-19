/** Display formatting helpers. Numerics render in mono per spec §2. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short month for modification annotations: "· upped from 150g (Apr)". */
export function monthShort(date: Date): string {
  return MONTHS[date.getMonth()] ?? '';
}

/** Total time: 45 → "45m", 90 → "1h 30m", 1110 → "18h 30m". */
export function formatMinutes(min?: number): string | null {
  if (!min || min <= 0) return null;
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "today" / "3d ago" / "2w ago" / "4mo ago" — Pipeline idea age (spec §8). */
export function relativeAge(date: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** Common culinary fractions, matched by nearest (absorbs 0.333… → 1/3). */
const FRACTION_PARTS: [number, number][] = [
  [1, 8], [1, 4], [1, 3], [3, 8], [1, 2], [5, 8], [2, 3], [3, 4], [7, 8],
];

/** 0.75 → "3/4", 0.3333… → "1/3", 1.5 → "1 1/2", 2 → "2". */
export function toFraction(amount: number): string {
  if (Number.isInteger(amount)) return String(amount);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const whole = Math.floor(abs);
  const frac = abs - whole;
  if (frac <= 0.03) return `${sign}${whole}`;
  if (frac >= 0.97) return `${sign}${whole + 1}`;
  let best: [number, number] | null = null;
  let bestErr = Infinity;
  for (const [a, b] of FRACTION_PARTS) {
    const err = Math.abs(frac - a / b);
    if (err < bestErr) {
      bestErr = err;
      best = [a, b];
    }
  }
  // Unusual amount with no clean fraction nearby — trim, don't fake one.
  if (!best || bestErr > 0.04) return `${sign}${Number(abs.toFixed(2))}`;
  const [a, b] = best;
  return whole > 0 ? `${sign}${whole} ${a}/${b}` : `${sign}${a}/${b}`;
}

/** "200g", "2 pc", "3/4 cup", "1 1/2 cup", "" for null amount. */
export function formatAmount(amount: number | null, unit: string | null): string {
  if (amount == null) return '';
  const n = toFraction(amount);
  if (!unit || unit === 'pc') return n;
  // Short units hug the number ("200g"); fractions/mixed always get a space.
  const tight = unit.length <= 2 && !n.includes('/') && !n.includes(' ');
  return `${n}${tight ? '' : ' '}${unit}`;
}
