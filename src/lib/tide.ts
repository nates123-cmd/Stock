/**
 * Tide calorie push (spec §7 / §11). On Save cook, if the recipe has
 * per-serving nutrition we scale by `servingsCooked` and write a food row
 * into the shared Supabase `tide_intake_logs` table — the exact table Tide's
 * Fuel tab reads (category='food'). Tide's mealMacros() pulls calories +
 * macros from `metadata` ({kcal, protein_g, carbs_g, fat_g}), so that shape
 * is what makes the meal show up in Tide's day total.
 *
 * (Previously this wrote to a `meal_log` table that Tide never read, so cooks
 * never surfaced in Tide — patch #0cdbce11.)
 *
 * Fire-and-forget: a failed push must never block the cook from being
 * recorded locally. Errors are logged + swallowed.
 *
 * Cross-app visibility: tide_intake_logs is per-user (RLS auth.uid()=user_id).
 * user_id defaults to auth.uid() from our JWT, so the row is Tide-visible only
 * when Stock and Tide are signed in as the SAME account (same email/uid).
 *
 * Idempotency: tide_intake_logs has no unique constraint on the source, so a
 * re-save first deletes any prior push for this cook (matched by
 * metadata->>source_id) and then inserts a fresh row.
 */
import { supabase, SUPABASE_AVAILABLE } from './supabase';
import type { Cook, Recipe } from '@/types';

export type PushOutcome =
  | { ok: true; pushedAt: Date }
  | { ok: false; reason: 'no-nutrition' | 'not-signed-in' | 'no-supabase' | 'error'; detail?: string };

const round = (n: number) => Math.round(n);

/** Local YYYY-MM-DD — Tide buckets the day by local log_date, not UTC. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

  const eaten = cook.finishedAt ?? cook.startedAt;
  const macro = (v: number | null | undefined) => (v != null ? round(v * servings) : 0);
  const row = {
    category: 'food',
    item_type: recipe.title,
    // quantity/unit mirror Tide's own food rows for display; the calorie math
    // reads metadata.kcal, so metadata is the source of truth.
    quantity: round(nutrition.calories * servings),
    unit: 'kcal',
    logged_at: eaten.toISOString(),
    log_date: localDateKey(eaten),
    metadata: {
      kcal: round(nutrition.calories * servings),
      protein_g: macro(nutrition.protein),
      carbs_g: macro(nutrition.carbs),
      fat_g: macro(nutrition.fat),
      source: 'stock',
      source_app: 'stock',
      source_id: cook.id,
      nutrition_source: nutrition.source,
      servings,
    },
    // user_id defaults to auth.uid() server-side from our JWT.
  };

  // Idempotent re-save: clear any prior push for this cook first. RLS scopes
  // the delete to our own rows.
  await supabase.from('tide_intake_logs').delete().eq('metadata->>source_id', cook.id);

  const { error } = await supabase.from('tide_intake_logs').insert(row);

  if (error) {
    console.warn('[stock] tide push failed', error.message);
    return { ok: false, reason: 'error', detail: error.message };
  }
  return { ok: true, pushedAt: new Date() };
}
