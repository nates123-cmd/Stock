import { describe, expect, it } from 'vitest';
import {
  groupBySection,
  locationForSection,
  SECTION_ORDER,
  sectionFor,
  sinkGot,
} from '../src/lib/shopSections';

describe('store sections', () => {
  it('does not fall for substrings (the old shopping categorizer did)', () => {
    // butter / milk / egg are inside these names; none of them is dairy.
    expect(sectionFor('peanut butter')).toBe('canned');
    expect(sectionFor('coconut milk')).toBe('canned');
    expect(sectionFor('eggplant')).toBe('produce');
    // "ham" inside chamomile, "nut" inside coconut oil.
    expect(sectionFor('chamomile tea')).toBe('drinks');
    expect(sectionFor('coconut oil')).toBe('condiments');
  });

  it('files everyday items where you would walk to get them', () => {
    const cases: [string, string][] = [
      ['lemons', 'produce'],
      ['bell pepper', 'produce'],
      ['black pepper', 'spices'],
      ['chicken thighs, bone-in', 'meat'],
      ['ground beef', 'meat'],
      ['eggs', 'dairy'],
      ['unsalted butter', 'dairy'],
      ['sourdough bread', 'bakery'],
      ['bread flour', 'spices'],
      ['spaghetti', 'grains'],
      ['chicken stock', 'canned'],
      ['olive oil, EVOO', 'condiments'],
      ['soy sauce', 'condiments'],
      ['kosher salt', 'spices'],
      ['ice cream', 'frozen'],
      ['frozen peas', 'frozen'],
      ['seltzer', 'drinks'],
      ['paper towels', 'household'],
      ['dish soap', 'household'],
      ['parchment paper', 'household'],
      ['something unheard of', 'other'],
    ];
    for (const [name, want] of cases) expect([name, sectionFor(name)]).toEqual([name, want]);
  });

  it('a section picked by hand beats the guess, and a junk value does not', () => {
    expect(sectionFor('tofu')).toBe('meat');
    expect(sectionFor('tofu', 'produce')).toBe('produce');
    // @ts-expect-error a stale value read back from storage
    expect(sectionFor('tofu', 'aisle-9')).toBe('meat');
    expect(sectionFor('tofu', null)).toBe('meat');
  });

  it('groups in walk order, drops empty sections, keeps arrival order inside', () => {
    const rows = ['seltzer', 'limes', 'ice cream', 'lemons', 'eggs'];
    const groups = groupBySection(rows, (n) => sectionFor(n));
    expect(groups.map((g) => g.section)).toEqual(['produce', 'dairy', 'drinks', 'frozen']);
    expect(groups[0]!.rows).toEqual(['limes', 'lemons']);
    // Frozen is walked after everything else cold.
    expect(SECTION_ORDER.indexOf('frozen')).toBeGreaterThan(SECTION_ORDER.indexOf('dairy'));
  });

  it('sinks what is already in the cart to the bottom of its section', () => {
    const got = new Set(['b']);
    expect(sinkGot(['a', 'b', 'c'], (r) => got.has(r))).toEqual(['a', 'c', 'b']);
    expect(sinkGot(['a', 'b'], () => false)).toEqual(['a', 'b']);
  });

  it('guesses where a bought item goes at home', () => {
    expect(locationForSection('frozen')).toBe('freezer');
    expect(locationForSection('produce')).toBe('fridge');
    expect(locationForSection('dairy')).toBe('fridge');
    expect(locationForSection('spices')).toBe('pantry');
    expect(locationForSection('household')).toBe('pantry');
  });
});
