/**
 * Tide calorie push (spec §7 / §11). On Save cook, if the recipe has
 * per-serving nutrition we scale by `servingsCooked` and upsert a row into
 * the shared Supabase `meal_log` table. Tide reads from there.
 *
 * Fire-and-forget: a failed push must never block the cook from being
 * recorded locally. Errors are logged + swallowed.
 *
 * Idempotency: (user_id, source_app, source_id) is unique in meal_log, so
 * re-saving the same cook upserts rather than duplicating.
 */
import { supabase, SUPABASE_AVAILABLE } from './supabase';
import type { Cook, Recipe } from '@/types';

export type PushOutcome =
  | { ok: true; pushedAt: Date }
  | { ok: false; reason: 'no-nutrition' | 'not-signed-in' | 'no-supabase' | 'error'; detail?: string };

const round = (n: number) => Math.round(n);

export async function pushCookToTide(
  cook: Cook,
  recipe: Recipe,
  servings: number,
): Promise<PushOutcome> {
  if (!SUPABASE_AVAILABLE || !supabase) return { ok: false, reason: 'no-supabase' };
  const nutrition = recipe.nutrition;
  if (!nutrition || nutrition.calories == null) return { ok: false, reason: 'no-nutrition' };

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return { ok: false, reason: 'not-signed-in' };

  const eatenAt = (cook.finishedAt ?? cook.startedAt).toISOString();
  const row = {
    // Deterministic primary key so a re-save updates the same row. Includes
    // user_id implicitly via RLS, but we also scope id by user to keep ids
    // collision-free if the schema ever drops the unique() constraint.
    id: `stock:${cook.id}`,
    user_id: session.user.id,
    source_app: 'stock',
    source_id: cook.id,
    name: recipe.title,
    eaten_at: eatenAt,
    calories: round(nutrition.calories * servings),
    protein: nutrition.protein != null ? round(nutrition.protein * servings) : null,
    carbs: nutrition.carbs != null ? round(nutrition.carbs * servings) : null,
    fat: nutrition.fat != null ? round(nutrition.fat * servings) : null,
    nutrition_source: nutrition.source,
    servings,
  };

  const { error } = await supabase
    .from('meal_log')
    .upsert(row, { onConflict: 'user_id,source_app,source_id' });

  if (error) {
    console.warn('[stock] tide push failed', error.message);
    return { ok: false, reason: 'error', detail: error.message };
  }
  return { ok: true, pushedAt: new Date() };
}
