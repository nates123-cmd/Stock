/**
 * Step-body tokenizer (spec §7 cook-mode rendering; §11.8 timer/temp
 * detection done client-side here). Splits a step body into typed segments so
 * cook mode can style amounts as mono tomato pills, timers as tappable links,
 * and temperatures as neutral pills.
 *
 * Heuristic + regex; when a step already carries parsedTimers/parsedTemperature
 * those are authoritative for behaviour, this just drives inline display.
 */
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'amount'; text: string }
  | { type: 'temp'; text: string }
  | { type: 'timer'; text: string; seconds: number };

const TEMP = String.raw`\d{2,3}\s?°\s?F|\d{2,3}\s?°F|\d{2,3}\s?°|\d{2,3}\s?degrees(?:\s?F)?`;
const DURATION = String.raw`\d+(?:\s?[–-]\s?\d+)?\s?(?:seconds?|secs?|minutes?|mins?|min|hours?|hrs?|hr)\b`;
const AMOUNT = String.raw`\d+(?:[.,/]\d+)?\s?[½¼¾⅓⅔⅛]?\s?(?:g|kg|mg|ml|l|cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|lb)\b|[½¼¾⅓⅔⅛]\s?(?:g|kg|ml|l|cups?|tbsp|tsp|oz|lb)\b`;

const MASTER = new RegExp(`(${TEMP})|(${DURATION})|(${AMOUNT})`, 'gi');

export function durationToSeconds(phrase: string): number {
  const m = phrase.match(/(\d+)(?:\s?[–-]\s?\d+)?\s?([a-z]+)/i);
  if (!m) return 0;
  const n = parseInt(m[1] as string, 10);
  const unit = (m[2] ?? '').toLowerCase();
  if (unit.startsWith('h')) return n * 3600;
  if (unit.startsWith('m')) return n * 60;
  return n;
}

export function tokenizeStep(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MASTER.lastIndex = 0;
  while ((m = MASTER.exec(body)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: body.slice(last, m.index) });
    const raw = m[0];
    if (m[1]) out.push({ type: 'temp', text: raw.trim() });
    else if (m[2]) out.push({ type: 'timer', text: raw.trim(), seconds: durationToSeconds(raw) });
    else out.push({ type: 'amount', text: raw.trim() });
    last = m.index + raw.length;
  }
  if (last < body.length) out.push({ type: 'text', text: body.slice(last) });
  return out;
}
