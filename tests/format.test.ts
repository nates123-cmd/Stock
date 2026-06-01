import { describe, it, expect } from 'vitest';
import {
  toFraction,
  formatAmount,
  formatMinutes,
  relativeAge,
  monthShort,
} from '@/lib/format';

describe('toFraction', () => {
  it('passes integers through', () => {
    expect(toFraction(2)).toBe('2');
    expect(toFraction(0)).toBe('0');
  });
  it('snaps common culinary fractions', () => {
    expect(toFraction(0.75)).toBe('3/4');
    expect(toFraction(0.5)).toBe('1/2');
    expect(toFraction(1 / 3)).toBe('1/3');
    expect(toFraction(2 / 3)).toBe('2/3');
  });
  it('renders mixed numbers', () => {
    expect(toFraction(1.5)).toBe('1 1/2');
    expect(toFraction(2.25)).toBe('2 1/4');
  });
  it('absorbs near-integers', () => {
    expect(toFraction(2.01)).toBe('2');
    expect(toFraction(1.99)).toBe('2');
  });
  it('snaps to the nearest culinary fraction within tolerance', () => {
    // 0.1 is 0.025 from 1/8 (0.125), which is < 0.04 → snaps to 1/8.
    expect(toFraction(0.1)).toBe('1/8');
  });
  it('trims (does not fake a fraction) for amounts far from any fraction', () => {
    // 0.45 is >0.04 from every culinary fraction → trims to a decimal.
    expect(toFraction(0.45)).toBe('0.45');
  });
});

describe('formatAmount', () => {
  it('returns empty string for null amount', () => {
    expect(formatAmount(null, 'g')).toBe('');
  });
  it('hugs short units to whole numbers', () => {
    expect(formatAmount(200, 'g')).toBe('200g');
  });
  it('puts a space before long/fractional units', () => {
    expect(formatAmount(0.75, 'cup')).toBe('3/4 cup');
    expect(formatAmount(1.5, 'cup')).toBe('1 1/2 cup');
  });
  it('drops the unit for pc and null unit', () => {
    expect(formatAmount(2, 'pc')).toBe('2');
    expect(formatAmount(3, null)).toBe('3');
  });
  it('spaces a fraction even with a short unit', () => {
    // tight requires no "/" and no " " in the number — 1/2 oz must get a space
    expect(formatAmount(0.5, 'oz')).toBe('1/2 oz');
  });
});

describe('formatMinutes', () => {
  it('returns null for falsy / non-positive', () => {
    expect(formatMinutes(undefined)).toBeNull();
    expect(formatMinutes(0)).toBeNull();
  });
  it('formats sub-hour and hour+minute', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(1110)).toBe('18h 30m');
  });
});

describe('relativeAge', () => {
  const now = new Date('2026-06-01T12:00:00');
  it('handles today / yesterday', () => {
    expect(relativeAge(new Date('2026-06-01T08:00:00'), now)).toBe('today');
    expect(relativeAge(new Date('2026-05-31T08:00:00'), now)).toBe('yesterday');
  });
  it('buckets days / weeks / months', () => {
    expect(relativeAge(new Date('2026-05-28T12:00:00'), now)).toBe('4d ago');
    expect(relativeAge(new Date('2026-05-01T12:00:00'), now)).toBe('4w ago');
    expect(relativeAge(new Date('2026-03-01T12:00:00'), now)).toBe('3mo ago');
  });
});

describe('monthShort', () => {
  it('returns the abbreviated month', () => {
    expect(monthShort(new Date('2026-04-15T00:00:00'))).toBe('Apr');
  });
});
