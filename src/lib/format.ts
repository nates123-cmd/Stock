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

/** "200g", "2 pc", "1.5 cup", "" for null amount. */
export function formatAmount(amount: number | null, unit: string | null): string {
  if (amount == null) return '';
  const n = Number.isInteger(amount) ? String(amount) : String(amount);
  if (!unit) return n;
  return unit === 'pc' ? `${n}` : `${n}${unit.length <= 2 ? '' : ' '}${unit}`;
}
