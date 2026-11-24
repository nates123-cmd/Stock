import { describe, expect, it } from 'vitest';
import { byRecentlyViewed, recencyOf } from '../src/lib/recipeRecency';

const r = (id: string, created: string) => ({ id, createdAt: new Date(created) });

describe('recently viewed order', () => {
  const old = r('old', '2026-01-01T00:00:00Z');
  const mid = r('mid', '2026-06-01T00:00:00Z');
  const fresh = r('fresh', '2026-11-01T00:00:00Z');

  it('puts the recipe opened last on top, whatever its age', () => {
    const viewed = { old: Date.parse('2026-11-20T00:00:00Z') };
    const out = [fresh, mid, old].sort(byRecentlyViewed(viewed));
    expect(out.map((x) => x.id)).toEqual(['old', 'fresh', 'mid']);
  });

  it('falls back to newest-added when nothing has been opened', () => {
    const out = [old, fresh, mid].sort(byRecentlyViewed({}));
    expect(out.map((x) => x.id)).toEqual(['fresh', 'mid', 'old']);
  });

  it('a just-added recipe outranks one viewed before it was added', () => {
    const viewed = { old: Date.parse('2026-10-01T00:00:00Z') };
    const out = [old, fresh].sort(byRecentlyViewed(viewed));
    expect(out[0]!.id).toBe('fresh');
  });

  it('orders two opened recipes by which was opened later', () => {
    const viewed = { old: 2_000_000_000_000, mid: 2_000_000_000_500 };
    const out = [old, mid].sort(byRecentlyViewed(viewed));
    expect(out.map((x) => x.id)).toEqual(['mid', 'old']);
  });

  it('survives a createdAt that came back from JSON as a string or garbage', () => {
    expect(recencyOf({ id: 'a', createdAt: '2026-06-01T00:00:00Z' }, {})).toBe(
      Date.parse('2026-06-01T00:00:00Z'),
    );
    expect(recencyOf({ id: 'a', createdAt: 'nope' }, { a: 5 })).toBe(5);
  });
});
