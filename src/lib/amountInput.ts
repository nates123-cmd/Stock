/**
 * Parse an amount a cook typed one-handed. "1.5", "1,5", "1/2" and "1 1/2"
 * all parse; blank or anything else is null (no amount).
 */
export function parseAmount(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const d = Number(mixed[3]);
    return d ? Number(mixed[1]) + Number(mixed[2]) / d : null;
  }
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const d = Number(frac[2]);
    return d ? Number(frac[1]) / d : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
