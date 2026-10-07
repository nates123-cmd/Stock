import { describe, it, expect } from 'vitest';
import {
  ingredientPantryStatus,
  newPantryRowFor,
  pantryRowFor,
} from '../src/lib/ingredientPantry';
import type { PantryItem } from '../src/types';

function row(canonicalName: string, over: Partial<PantryItem> = {}): PantryItem {
  return {
    id: `pan_${canonicalName.replace(/\W+/g, '_')}`,
    canonicalName,
    location: 'pantry',
    isStaple: false,
    acquiredAt: new Date('2026-09-01'),
    defaultFreshnessDays: 365,
    purchaseHistory: [new Date('2026-09-01')],
    status: 'fine',
    ...over,
  };
}

describe('pantryRowFor', () => {
  it('matches on the pantry match key (qualifier after the comma dropped)', () => {
    const items = [row('olive oil')];
    expect(pantryRowFor({ canonicalName: 'olive oil, EVOO' }, items)?.id).toBe(items[0]!.id);
  });

  it('prefers the staple when several rows share a key', () => {
    const items = [row('salt', { id: 'a' }), row('salt', { id: 'b', isStaple: true })];
    expect(pantryRowFor({ canonicalName: 'salt' }, items)?.id).toBe('b');
  });

  it("falls back to the pantry's loose same-item rule", () => {
    const items = [row('chickpeas')];
    expect(pantryRowFor({ canonicalName: 'cooked chickpeas' }, items)?.id).toBe(items[0]!.id);
  });

  it('does not merge different oils', () => {
    const items = [row('sesame oil')];
    expect(pantryRowFor({ canonicalName: 'olive oil' }, items)).toBeUndefined();
  });

  it('returns undefined when nothing is tracked', () => {
    expect(pantryRowFor({ canonicalName: 'saffron' }, [])).toBeUndefined();
  });
});

describe('newPantryRowFor', () => {
  it('builds a non-staple row with the status and NO purchase history', () => {
    const at = new Date('2026-10-06T12:00:00Z');
    const r = newPantryRowFor({ canonicalName: 'saffron, good stuff' }, 'out', 'pan_x', at);
    expect(r.canonicalName).toBe('saffron');
    expect(r.status).toBe('out');
    expect(r.isStaple).toBe(false);
    expect(r.purchaseHistory).toEqual([]);
    expect(r.expiresAt).toBeUndefined();
    expect(r.statusUpdatedAt).toBe(at);
  });

  it('files perishables in the fridge', () => {
    expect(newPantryRowFor({ canonicalName: 'heavy cream' }, 'low', 'pan_y').location).toBe('fridge');
  });
});

describe('ingredientPantryStatus', () => {
  it("reads the matched row's status, fine when untracked", () => {
    const items = [row('butter', { status: 'low' })];
    expect(ingredientPantryStatus({ canonicalName: 'unsalted butter' }, items)).toBe('low');
    expect(ingredientPantryStatus({ canonicalName: 'saffron' }, items)).toBe('fine');
  });
});
