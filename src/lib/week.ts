/**
 * Week math — spec §5. Week starts Sunday, hardcoded for v1 (user
 * preference). All operations are local-time, day-granular.
 */
const DAY_MS = 86_400_000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Midnight Sunday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  s.setDate(s.getDate() - s.getDay());
  return s;
}

export function addWeeks(start: Date, n: number): Date {
  const s = new Date(start);
  s.setDate(s.getDate() + n * 7);
  return s;
}

/** The 7 dates Sun→Sat for a week start. */
export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

/** Stable local day key 'YYYY-MM-DD' — PlanEntry identity by (key, meal). */
export function dateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

export function dayLabel(d: Date): { dow: string; date: string } {
  return { dow: DOW[d.getDay()] ?? '', date: `${d.getDate()}`.padStart(2, '0') };
}

/** "May 11 — May 17" for the week-nav header. */
export function weekRangeLabel(start: Date): string {
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const a = `${MON[start.getMonth()]} ${start.getDate()}`;
  const b =
    start.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${MON[end.getMonth()]} ${end.getDate()}`;
  return `${a} — ${b}`;
}

/** Long day tag for the picker header: "Tue · May 13". */
export function dayTag(d: Date): string {
  return `${DOW[d.getDay()]} · ${MON[d.getMonth()]} ${d.getDate()}`;
}

/** Past weeks are read-only (spec §5). */
export function isPastWeek(start: Date, today = new Date()): boolean {
  return addWeeks(start, 1).getTime() <= startOfWeek(today).getTime();
}

/** Offset in whole weeks from this week (0 = current, -1 = last, +1 = next). */
export function weekOffsetLabel(start: Date, today = new Date()): string {
  const diff = Math.round(
    (start.getTime() - startOfWeek(today).getTime()) / (7 * DAY_MS),
  );
  if (diff === 0) return 'This week';
  if (diff === -1) return 'Last week';
  if (diff === 1) return 'Next week';
  return diff < 0 ? `${-diff} weeks ago` : `In ${diff} weeks`;
}
