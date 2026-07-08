import { describe, it, expect } from 'vitest';
import { isAlwaysHave, alwaysHaveKey } from '../src/lib/alwaysHave';
import { combinedQty, reviewGroups } from '../src/lib/cartCombine';
import { remindersDeepLink, storeLabel } from '../src/lib/shopStores';
import type { ShoppingLine, ShoppingSource } from '../src/lib/shopping';

const src = (
  recipe: string,
  text: string,
  amount: number | null,
  unit: string | null,
): ShoppingSource => ({ recipe, text, amount, unit });

describe('always-have single source', () => {
  it('matches case-insensitively and across staple variants', () => {
    const map = { salt: true } as Record<string, true>;
    expect(isAlwaysHave('salt', map)).toBe(true);
    expect(isAlwaysHave('Salt', map)).toBe(true);
    expect(isAlwaysHave('kosher salt', map)).toBe(true);
    expect(isAlwaysHave('flour', map)).toBe(false);
  });
  it('matches a pinned qualified name back to its base', () => {
    const map = { 'kosher salt': true } as Record<string, true>;
    expect(isAlwaysHave('salt', map)).toBe(true);
  });
  it('normalizes keys (drops comma tail, collapses ws)', () => {
    expect(alwaysHaveKey('Olive Oil, EVOO')).toBe('olive oil');
  });
});

describe('cart-combine', () => {
  it('sums same-unit / count sources', () => {
    const r = combinedQty('lemons', [src('A', 'lemon', 1, 'pc'), src('B', 'lemon', 1, 'pc')]);
    expect(r.convertible).toBe(true);
    expect(r.text).toContain('2');
  });
  it('converts a unit mismatch via convert-units (into the first unit)', () => {
    const r = combinedQty('milk', [src('A', 'milk', 1, 'cup'), src('B', 'milk', 200, 'ml')]);
    expect(r.convertible).toBe(true);
    // 200 ml -> ~0.85 cup, + 1 cup -> ~1.85 cup
    expect(r.text).toMatch(/cup/);
    expect(r.text).toMatch(/1\.8/);
  });
  it('flags non-convertible units as keep-separate', () => {
    const r = combinedQty('x', [src('A', 'x', 1, 'cup'), src('B', 'x', 100, 'g')]);
    expect(r.convertible).toBe(false);
  });
  it('only reviews lines spanning 2+ recipes', () => {
    const lines: ShoppingLine[] = [
      {
        name: 'lemons',
        category: 'produce',
        buy: '2 lemons',
        math: '',
        sources: [src('Shakshuka', 'lemon', 1, 'pc'), src('Chana', 'lemon', 1, 'pc')],
        confidence: 'summed',
      },
      {
        name: 'mint',
        category: 'produce',
        buy: 'a bunch',
        math: '',
        sources: [src('Shakshuka', 'mint', 1, 'pc')],
        confidence: 'summed',
      },
    ];
    const groups = reviewGroups(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('lemons');
  });
});

describe('reminders routing', () => {
  it('builds a shortcuts deep link, null when empty', () => {
    expect(remindersDeepLink([])).toBeNull();
    const url = remindersDeepLink(['Lemons, 3', 'Olive oil']);
    expect(url).toContain('shortcuts://run-shortcut?name=Add%20Shared%20Groceries');
    expect(url).toContain('Lemons');
    expect(url).toContain('%0A'); // newline-joined
  });
  it('labels stores', () => {
    expect(storeLabel('wegmans')).toBe('Wegmans');
    expect(storeLabel(null)).toBe('Unassigned');
  });
});
