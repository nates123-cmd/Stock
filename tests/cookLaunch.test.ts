/**
 * The Cook tab's lead + week picker.
 *
 * 2026-10-15: a planned DINNER (a recipe that links other recipes) opened
 * fine from the Plan tab (its recipe page, every linked recipe listed) but
 * the Cook tab launched it straight into cook mode, where a dinner shell has
 * no steps. Both doors must open the same page, and the week must be
 * reachable from Cook so another night's dinner can be cooked instead.
 */
import { describe, expect, it } from 'vitest';
import type { CookPlan, Meal, Recipe } from '@/types';
import {
  cookWeek,
  cookableDishes,
  dishDestination,
  entryDestination,
  entryTitle,
  leadEntry,
} from '@/lib/cookLaunch';
import { indexRecipes } from '@/lib/dinners';

const rec = (id: string, extra: Partial<Recipe> = {}): Recipe =>
  ({
    id,
    title: id,
    status: 'active',
    ingredients: [],
    steps: [{ id: `s_${id}`, ordinal: 1, title: 'go', body: 'go', parsedTimers: [], parsedAmounts: [], modificationHistory: [] }],
    yield: { serves: 2 },
    ...extra,
  }) as unknown as Recipe;

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const today = day(2026, 10, 15); // a Thursday

const meal = (id: string, date: Date, recipeIds: string[], extra: Partial<Meal> = {}): Meal => ({
  id,
  date,
  dishes: recipeIds.map((rid) => ({ id: `d_${id}_${rid}`, recipeId: rid, title: rid })),
  ...extra,
});

const plan = (id: string, serveAt: Date | undefined, extra: Partial<CookPlan> = {}): CookPlan =>
  ({
    id,
    title: id,
    status: 'active',
    spread: [],
    components: [],
    phases: [],
    serveAt,
    cookCount: 0,
    ...extra,
  }) as unknown as CookPlan;

const gnocchi = rec('gnocchi');
const focaccia = rec('focaccia');
const pears = rec('pears');
const pumpkinNight = rec('pumpkin-night', {
  isDinner: true,
  steps: [],
  componentRecipes: [
    { id: 'c1', recipeId: 'gnocchi' },
    { id: 'c2', recipeId: 'focaccia' },
    { id: 'c3', recipeId: 'pears' },
  ],
});
const tacos = rec('tacos');
const salad = rec('salad');
const gone = rec('gone', { status: 'archived' });
const index = indexRecipes([gnocchi, focaccia, pears, pumpkinNight, tacos, salad, gone]);

describe('cookableDishes', () => {
  it('a dinner resolves to its linked recipes, in order', () => {
    const [d] = cookableDishes(meal('m', today, ['pumpkin-night']), index);
    expect(d?.dinner).toBe(true);
    expect(d?.parts.map((r) => r.id)).toEqual(['gnocchi', 'focaccia', 'pears']);
  });

  it('a plain recipe has no parts; archived and missing recipes drop out', () => {
    const dishes = cookableDishes(meal('m', today, ['tacos', 'gone', 'nope']), index);
    expect(dishes.map((d) => d.recipe.id)).toEqual(['tacos']);
    expect(dishes[0]?.dinner).toBe(false);
    expect(dishes[0]?.parts).toEqual([]);
  });
});

describe('destinations match the Plan tab', () => {
  it('a dinner opens on its recipe page, a dish goes into cook mode', () => {
    const [dinner] = cookableDishes(meal('m', today, ['pumpkin-night']), index);
    const [dish] = cookableDishes(meal('m2', today, ['tacos']), index);
    expect(dishDestination(dinner!)).toEqual({ pathname: '/recipes/[id]', params: { id: 'pumpkin-night' } });
    expect(dishDestination(dish!)).toEqual({ pathname: '/cook/[id]', params: { id: 'tacos' } });
  });

  it('a one-dish meal opens that dish; a multi-dish meal opens the combined cook', () => {
    const week = cookWeek(
      [meal('one', today, ['pumpkin-night']), meal('two', day(2026, 10, 16), ['tacos', 'salad'])],
      [],
      index,
      today,
    );
    expect(entryDestination(week[0]!)).toEqual({ pathname: '/recipes/[id]', params: { id: 'pumpkin-night' } });
    expect(entryDestination(week[1]!)).toEqual({ pathname: '/cook/meal/[id]', params: { id: 'two' } });
  });

  it('a cook plan opens its detail page', () => {
    const week = cookWeek([], [plan('p', new Date(2026, 9, 17, 18, 30))], index, today);
    expect(entryDestination(week[0]!)).toEqual({ pathname: '/cook-plan/[id]', params: { id: 'p' } });
    expect(entryTitle(week[0]!)).toBe('p');
  });
});

describe('cookWeek', () => {
  it('covers today through six days out, soonest first, skipping skipped meals and past days', () => {
    const week = cookWeek(
      [
        meal('yesterday', day(2026, 10, 14), ['tacos']),
        meal('sat', day(2026, 10, 17), ['salad']),
        meal('today', today, ['pumpkin-night']),
        meal('skipped', day(2026, 10, 16), ['tacos'], { status: 'skipped' }),
        meal('next-thu', day(2026, 10, 22), ['tacos']),
        meal('wed', day(2026, 10, 21), ['tacos']),
      ],
      [],
      index,
      today,
    );
    expect(week.map((e) => e.id)).toEqual(['today', 'sat', 'wed']);
  });

  it('a meal with no cookable dish is not a day to cook', () => {
    const week = cookWeek([meal('m', today, ['gone'])], [], index, today);
    expect(week).toEqual([]);
  });

  it('a scheduled cook plan sits on its day after that day\'s meal; unscheduled and archived plans stay out', () => {
    const week = cookWeek(
      [meal('m', day(2026, 10, 17), ['tacos'])],
      [
        plan('party', new Date(2026, 9, 17, 19, 0)),
        plan('draft', undefined),
        plan('old', new Date(2026, 9, 16, 19, 0), { status: 'archived' }),
      ],
      index,
      today,
    );
    expect(week.map((e) => `${e.kind}:${e.id}`)).toEqual(['meal:m', 'plan:party']);
  });
});

describe('leadEntry', () => {
  it("leads with today's dinner over today's lunch", () => {
    const week = cookWeek(
      [meal('lunch', today, ['salad'], { type: 'lunch' }), meal('dinner', today, ['pumpkin-night'], { type: 'dinner' })],
      [],
      index,
      today,
    );
    expect(leadEntry(week, today)?.id).toBe('dinner');
  });

  it("falls back to today's untyped meal, then to the soonest upcoming day", () => {
    const todayWeek = cookWeek([meal('m', today, ['tacos'])], [], index, today);
    expect(leadEntry(todayWeek, today)?.id).toBe('m');
    const later = cookWeek(
      [meal('sun', day(2026, 10, 18), ['salad']), meal('sat', day(2026, 10, 17), ['tacos'])],
      [],
      index,
      today,
    );
    expect(leadEntry(later, today)?.id).toBe('sat');
    expect(leadEntry([], today)).toBeNull();
  });
});
