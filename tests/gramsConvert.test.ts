/**
 * "To grams" must never trust a model's arithmetic.
 *
 * Regression: 2026-09-22, Mandy's Chinese Chicken Salad — "5 Tablespoons
 * sugar" came back from Claude as 38 g (≈ 3 tbsp). Correct ≈ 63 g. Nothing
 * checked it, and the recipe was saved with the wrong number.
 *
 * Now: staples convert from a local density table (no Claude), Claude only
 * ever supplies a grams-per-cup density, the multiplication happens in code,
 * and any density outside the physical band is rejected instead of applied.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const claudeText = vi.fn<(task: string, system: string, input: string) => Promise<string>>();

vi.mock('@/lib/api/claudeBridge', () => ({
  CLAUDE_AVAILABLE: true,
  claudeText: (...args: [string, string, string]) => claudeText(...args),
}));

import { convertToGrams } from '@/lib/parsing/units';
import {
  densityFor,
  localGramsFromVolume,
  plausibleDensity,
  volumeMl,
  MIN_G_PER_ML,
  MAX_G_PER_ML,
} from '@/lib/parsing/density';

const ing = (id: string, canonicalName: string, amount: number | null, unit: string | null) => ({
  id,
  canonicalName,
  amount,
  unit,
});

beforeEach(() => claudeText.mockReset());

describe('density table — the regression and its neighbours', () => {
  it('5 tablespoons sugar is ~63 g, and never asks Claude', async () => {
    const { results, rejected } = await convertToGrams([ing('sugar', 'sugar', 5, 'tablespoon')]);
    expect(claudeText).not.toHaveBeenCalled();
    expect(rejected).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe('table');
    expect(results[0]!.grams).toBeGreaterThanOrEqual(60);
    expect(results[0]!.grams).toBeLessThanOrEqual(65);
  });

  it('accepts the long unit spellings Claude-parsed recipes store', () => {
    expect(volumeMl('tablespoon')).toBeCloseTo(14.79, 1);
    expect(volumeMl('Tablespoons')).toBeCloseTo(14.79, 1);
    expect(volumeMl('teaspoon')).toBeCloseTo(4.93, 1);
    expect(volumeMl('tsp')).toBeCloseTo(4.93, 1);
    expect(volumeMl('cups')).toBeCloseTo(236.6, 0);
    expect(volumeMl('ml')).toBe(1);
    expect(volumeMl('stick')).toBeNull();
    expect(volumeMl(null)).toBeNull();
  });

  it('gets the rest of that dressing right too', () => {
    expect(localGramsFromVolume('avocado oil', 0.75, 'cup')!.grams).toBeCloseTo(164, -1);
    expect(localGramsFromVolume('rice vinegar', 6, 'tablespoons')!.grams).toBeCloseTo(90, -1);
    expect(localGramsFromVolume('sesame oil', 1.5, 'tablespoon')!.grams).toBeCloseTo(20, -1);
    expect(localGramsFromVolume('salt', 1, 'teaspoon')!.grams).toBeCloseTo(6, 0);
    expect(localGramsFromVolume('black pepper', 0.5, 'teaspoon')!.grams).toBeCloseTo(1, 0);
    expect(localGramsFromVolume('msg seasoning', 2, 'teaspoons')!.grams).toBeCloseTo(6, 0);
  });

  it('distinguishes the sugars and flours a baker cares about', () => {
    expect(densityFor('brown sugar')!.label).toMatch(/brown/);
    expect(densityFor('light brown sugar')!.label).toMatch(/brown/);
    expect(densityFor('powdered sugar')!.label).toMatch(/powdered/);
    expect(densityFor('granulated sugar')!.label).toMatch(/granulated/);
    expect(densityFor('all-purpose flour')!.label).toMatch(/all-purpose/);
    expect(densityFor('bread flour')!.label).toMatch(/bread/);
    expect(densityFor('almond flour')!.label).toMatch(/almond/);
    expect(densityFor('kosher salt')!.label).toMatch(/kosher/);
    expect(densityFor('table salt')!.label).toMatch(/table/);
  });

  it('does not over-match: prepared produce stays with Claude', () => {
    expect(densityFor('red bell pepper')).toBeNull();
    expect(densityFor('green beans')).toBeNull();
    expect(densityFor('romaine lettuce')).toBeNull();
    expect(densityFor('kale')).toBeNull();
    expect(densityFor('tofu')).toBeNull();
    expect(densityFor('cooked boneless chicken breast')).toBeNull();
    expect(densityFor('fresh ginger')).toBeNull();
  });

  it('routes nut butter and buttermilk away from the butter row', () => {
    expect(densityFor('peanut butter')!.label).toMatch(/nut butter/);
    expect(densityFor('buttermilk')!.label).toMatch(/dairy/);
    expect(densityFor('butter')!.label).toBe('butter');
    expect(densityFor('unsalted butter')!.label).toBe('butter');
  });

  it('mass units still convert locally and skip the table', async () => {
    const { results } = await convertToGrams([ing('x', 'anything at all', 2, 'oz')]);
    expect(claudeText).not.toHaveBeenCalled();
    expect(results[0]!.grams).toBe(57);
  });

  it('every table density sits inside the plausibility band', async () => {
    const { DENSITY } = await import('@/lib/parsing/density');
    for (const row of DENSITY) expect(plausibleDensity(row.gPerMl), row.label).toBe(true);
  });
});

describe('Claude path — density in, arithmetic here', () => {
  it('multiplies a returned grams-per-cup, never trusts a grams figure', async () => {
    claudeText.mockResolvedValue('{"items":[{"id":"k","gramsPerCup":67}]}');
    const { results, rejected } = await convertToGrams([ing('k', 'chopped kale', 2, 'cup')]);
    expect(claudeText).toHaveBeenCalledTimes(1);
    expect(rejected).toEqual([]);
    expect(results).toEqual([{ id: 'k', grams: 134, source: 'claude' }]);
  });

  it('asks Claude for a density, not the final grams', async () => {
    claudeText.mockResolvedValue('{"items":[]}');
    await convertToGrams([ing('k', 'chopped kale', 2, 'cup')]);
    const [task, system] = claudeText.mock.calls[0]!;
    expect(task).toBe('bench-convert-density');
    expect(system).toMatch(/grams per US cup/i);
    expect(system).toMatch(/NOT the grams for the amount/);
  });

  it('only sends Claude the ingredients the table cannot price', async () => {
    claudeText.mockResolvedValue('{"items":[{"id":"k","gramsPerCup":67}]}');
    await convertToGrams([
      ing('s', 'sugar', 5, 'tablespoon'),
      ing('k', 'chopped kale', 2, 'cup'),
    ]);
    const payload = JSON.parse(claudeText.mock.calls[0]![2]) as { id: string }[];
    expect(payload.map((p) => p.id)).toEqual(['k']);
  });

  it('rejects an implausible density instead of applying it', async () => {
    claudeText.mockResolvedValue(
      '{"items":[{"id":"a","gramsPerCup":5},{"id":"b","gramsPerCup":900},{"id":"c","gramsPerCup":150}]}',
    );
    const { results, rejected } = await convertToGrams([
      ing('a', 'mystery a', 1, 'cup'),
      ing('b', 'mystery b', 1, 'cup'),
      ing('c', 'mystery c', 1, 'cup'),
    ]);
    expect(results.map((r) => r.id)).toEqual(['c']);
    expect(rejected.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(rejected[0]!.reason).toMatch(/implausible/);
  });

  it('leaves an item Claude skipped untouched, with a reason', async () => {
    claudeText.mockResolvedValue('{"items":[]}');
    const { results, rejected } = await convertToGrams([ing('k', 'chopped kale', 2, 'cup')]);
    expect(results).toEqual([]);
    expect(rejected).toEqual([{ id: 'k', name: 'chopped kale', reason: 'no density returned' }]);
  });

  it('rejects count-ish units outright rather than guessing', async () => {
    const { results, rejected } = await convertToGrams([
      ing('c', 'mandarin oranges, drained', 2, 'can'),
      ing('h', 'romaine lettuce', 1, 'head'),
    ]);
    expect(claudeText).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(rejected.map((r) => r.id).sort()).toEqual(['c', 'h']);
  });

  it('skips items already in grams and items with no amount', async () => {
    const { results, rejected } = await convertToGrams([
      ing('g', 'sugar', 38, 'g'),
      ing('n', 'sesame seeds', null, null),
      ing('t', 'soy sauce', null, 'drop'),
    ]);
    expect(claudeText).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(rejected).toEqual([]);
  });

  it('band is wide enough for real food and tight enough to catch the slip', () => {
    // sugar's real density and the bad answer's implied density
    expect(plausibleDensity(200 / 236.6)).toBe(true);
    expect(plausibleDensity(MIN_G_PER_ML)).toBe(true);
    expect(plausibleDensity(MAX_G_PER_ML)).toBe(true);
    expect(plausibleDensity(0)).toBe(false);
    expect(plausibleDensity(-1)).toBe(false);
    expect(plausibleDensity(NaN)).toBe(false);
    expect(plausibleDensity(5)).toBe(false);
  });
});
