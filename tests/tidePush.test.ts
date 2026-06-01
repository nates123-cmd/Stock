import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cook, Recipe } from '@/types';

// pushCookToTide is the highest-risk module: the patch (#0cdbce11) exists
// because macros MUST be nested in `metadata` with category='food' or Tide's
// Fuel tab never sees the cook. We inject a fake supabase client and capture
// exactly what gets written.

type Captured = {
  table?: string;
  deletedSourceId?: string;
  inserted?: any;
  insertError?: { message: string } | null;
};
const cap: Captured = {};

const state = {
  available: true,
  session: { user: { id: 'user-1' } } as { user: { id: string } } | null,
};

function makeClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
    },
    from(table: string) {
      cap.table = table;
      return {
        delete() {
          return {
            eq(col: string, val: string) {
              cap.deletedSourceId = val;
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(row: any) {
          cap.inserted = row;
          return Promise.resolve({ error: cap.insertError ?? null });
        },
      };
    },
  };
}

vi.mock('@/lib/supabase', () => ({
  get SUPABASE_AVAILABLE() {
    return state.available;
  },
  get supabase() {
    return state.available ? makeClient() : null;
  },
}));

import { pushCookToTide } from '@/lib/tide';

function fixtures(nutrition?: Recipe['nutrition']) {
  const recipe = {
    id: 'r1',
    title: 'Chili',
    nutrition: nutrition ?? {
      per: 'serving' as const,
      source: 'estimated' as const,
      calories: 500,
      protein: 30,
      carbs: 40,
      fat: 20,
    },
  } as Recipe;
  const cook = {
    id: 'cook-abc',
    recipeId: 'r1',
    startedAt: new Date('2026-06-01T18:30:00'),
    finishedAt: new Date('2026-06-01T19:15:00'),
  } as Cook;
  return { recipe, cook };
}

beforeEach(() => {
  cap.table = undefined;
  cap.deletedSourceId = undefined;
  cap.inserted = undefined;
  cap.insertError = null;
  state.available = true;
  state.session = { user: { id: 'user-1' } };
});

describe('pushCookToTide — payload shape', () => {
  it('writes to tide_intake_logs with category=food', async () => {
    const { recipe, cook } = fixtures();
    const r = await pushCookToTide(cook, recipe, 2);
    expect(r.ok).toBe(true);
    expect(cap.table).toBe('tide_intake_logs');
    expect(cap.inserted.category).toBe('food');
  });

  it('nests scaled macros in metadata (the load-bearing shape)', async () => {
    const { recipe, cook } = fixtures();
    await pushCookToTide(cook, recipe, 2);
    expect(cap.inserted.metadata).toMatchObject({
      kcal: 1000, // 500 * 2
      protein_g: 60, // 30 * 2
      carbs_g: 80, // 40 * 2
      fat_g: 40, // 20 * 2
      source: 'stock',
      source_app: 'stock',
      source_id: 'cook-abc',
      servings: 2,
    });
  });

  it('mirrors calories into top-level quantity/unit for Tide display', async () => {
    const { recipe, cook } = fixtures();
    await pushCookToTide(cook, recipe, 2);
    expect(cap.inserted.quantity).toBe(1000);
    expect(cap.inserted.unit).toBe('kcal');
    expect(cap.inserted.item_type).toBe('Chili');
  });

  it('uses finishedAt for the eaten time and a local log_date', async () => {
    const { recipe, cook } = fixtures();
    await pushCookToTide(cook, recipe, 1);
    expect(cap.inserted.log_date).toBe('2026-06-01');
    expect(cap.inserted.logged_at).toBe(cook.finishedAt!.toISOString());
  });

  it('falls back to startedAt when finishedAt is missing', async () => {
    const { recipe, cook } = fixtures();
    delete (cook as any).finishedAt;
    await pushCookToTide(cook, recipe, 1);
    expect(cap.inserted.logged_at).toBe(cook.startedAt.toISOString());
  });

  it('rounds scaled macros', async () => {
    const { recipe, cook } = fixtures({
      per: 'serving',
      source: 'estimated',
      calories: 333.3,
      protein: 10.6,
      carbs: 0,
      fat: 0,
    });
    await pushCookToTide(cook, recipe, 1.5);
    expect(cap.inserted.metadata.kcal).toBe(500); // round(333.3*1.5=499.95)
    expect(cap.inserted.metadata.protein_g).toBe(16); // round(10.6*1.5=15.9)
  });

  it('coerces missing macros to 0 (not undefined)', async () => {
    const { recipe, cook } = fixtures({
      per: 'serving',
      source: 'estimated',
      calories: 200,
      // protein/carbs/fat omitted
    });
    await pushCookToTide(cook, recipe, 1);
    expect(cap.inserted.metadata.protein_g).toBe(0);
    expect(cap.inserted.metadata.carbs_g).toBe(0);
    expect(cap.inserted.metadata.fat_g).toBe(0);
  });
});

describe('pushCookToTide — idempotency', () => {
  it('deletes any prior push for this cook before inserting', async () => {
    const { recipe, cook } = fixtures();
    await pushCookToTide(cook, recipe, 1);
    expect(cap.deletedSourceId).toBe('cook-abc');
  });
});

describe('pushCookToTide — guards', () => {
  it('returns no-supabase when supabase is unavailable', async () => {
    state.available = false;
    const { recipe, cook } = fixtures();
    const r = await pushCookToTide(cook, recipe, 1);
    expect(r).toEqual({ ok: false, reason: 'no-supabase' });
  });

  it('returns no-nutrition when the recipe has no calories', async () => {
    const { recipe, cook } = fixtures();
    (recipe as any).nutrition = undefined;
    const r = await pushCookToTide(cook, recipe, 1);
    expect(r).toEqual({ ok: false, reason: 'no-nutrition' });
  });

  it('returns no-nutrition when calories is null', async () => {
    const { recipe, cook } = fixtures({
      per: 'serving',
      source: 'estimated',
      calories: undefined,
    });
    const r = await pushCookToTide(cook, recipe, 1);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('no-nutrition');
  });

  it('returns not-signed-in when there is no session user', async () => {
    state.session = null;
    const { recipe, cook } = fixtures();
    const r = await pushCookToTide(cook, recipe, 1);
    expect(r).toEqual({ ok: false, reason: 'not-signed-in' });
  });

  it('swallows an insert error and reports it (fire-and-forget)', async () => {
    cap.insertError = { message: 'rls denied' };
    const { recipe, cook } = fixtures();
    const r = await pushCookToTide(cook, recipe, 1);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe('error');
    expect((r as any).detail).toBe('rls denied');
  });
});
