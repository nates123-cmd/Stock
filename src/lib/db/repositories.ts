/**
 * Repository layer (scaffold) — typed accessors over the JSON-blob tables in
 * schema.ts. The Recipe repo is implemented as the reference pattern; the
 * other pillars follow the same shape and are stubbed with TODOs tied to the
 * spec build order (§13: Recipes → Cook → Plan → Pantry → Pipeline → Bench).
 */
import type {
  Cook,
  CookPlan,
  Modification,
  PantryItem,
  PipelineIdea,
  PlanEntry,
  Recipe,
} from '@/types';
import { getDb } from './client';
import { dateKey } from '@/lib/week';

/** JSON round-trips Dates to ISO strings; restore the §4 Date fields. */
function reviveModDates(mods: Modification[] | undefined): void {
  mods?.forEach((m) => {
    m.date = new Date(m.date as unknown as string);
  });
}

export function reviveRecipeDates(r: Recipe): Recipe {
  r.createdAt = new Date(r.createdAt as unknown as string);
  r.modifiedAt = new Date(r.modifiedAt as unknown as string);
  r.ingredients.forEach((i) => reviveModDates(i.modificationHistory));
  r.steps.forEach((s) => reviveModDates(s.modificationHistory));
  return r;
}

const reviveRecipe = (raw: string): Recipe =>
  reviveRecipeDates(JSON.parse(raw) as Recipe);

export const recipeRepo = {
  async all(): Promise<Recipe[]> {
    const rows = await getDb().getAllAsync<{ data: string }>(
      'SELECT data FROM recipes ORDER BY modified_at DESC',
    );
    return rows.map((r) => reviveRecipe(r.data));
  },

  async byId(id: string): Promise<Recipe | null> {
    const row = await getDb().getFirstAsync<{ data: string }>(
      'SELECT data FROM recipes WHERE id = ?',
      id,
    );
    return row ? reviveRecipe(row.data) : null;
  },

  async upsert(recipe: Recipe): Promise<void> {
    await getDb().runAsync(
      `INSERT INTO recipes
         (id, title, source_type, status, serves, total_minutes,
          cook_count, linked_pipeline_id, created_at, modified_at, data)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, source_type=excluded.source_type,
         status=excluded.status, serves=excluded.serves,
         total_minutes=excluded.total_minutes, cook_count=excluded.cook_count,
         linked_pipeline_id=excluded.linked_pipeline_id,
         modified_at=excluded.modified_at, data=excluded.data`,
      recipe.id,
      recipe.title,
      recipe.source.type,
      recipe.status,
      recipe.yield.serves,
      recipe.yield.totalMinutes ?? null,
      recipe.cookCount,
      recipe.linkedPipelineId ?? null,
      recipe.createdAt.toISOString(),
      recipe.modifiedAt.toISOString(),
      JSON.stringify(recipe),
    );
  },

  async remove(id: string): Promise<void> {
    await getDb().runAsync('DELETE FROM recipes WHERE id = ?', id);
  },
};

/** JSON round-trips Dates to ISO strings; restore the §4 Date fields. */
export function reviveCookPlanDates(p: CookPlan): CookPlan {
  p.createdAt = new Date(p.createdAt as unknown as string);
  p.modifiedAt = new Date(p.modifiedAt as unknown as string);
  if (p.serveAt) p.serveAt = new Date(p.serveAt as unknown as string);
  p.components?.forEach((c) =>
    c.ingredients?.forEach((i) => reviveModDates(i.modificationHistory)),
  );
  return p;
}

const reviveCookPlan = (raw: string): CookPlan =>
  reviveCookPlanDates(JSON.parse(raw) as CookPlan);

export const cookPlanRepo = {
  async all(): Promise<CookPlan[]> {
    const rows = await getDb().getAllAsync<{ data: string }>(
      'SELECT data FROM cook_plans ORDER BY modified_at DESC',
    );
    return rows.map((r) => reviveCookPlan(r.data));
  },

  async byId(id: string): Promise<CookPlan | null> {
    const row = await getDb().getFirstAsync<{ data: string }>(
      'SELECT data FROM cook_plans WHERE id = ?',
      id,
    );
    return row ? reviveCookPlan(row.data) : null;
  },

  async upsert(plan: CookPlan): Promise<void> {
    await getDb().runAsync(
      `INSERT INTO cook_plans
         (id, title, status, serve_at, cook_count, created_at, modified_at, data)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, status=excluded.status,
         serve_at=excluded.serve_at, cook_count=excluded.cook_count,
         modified_at=excluded.modified_at, data=excluded.data`,
      plan.id,
      plan.title,
      plan.status,
      plan.serveAt ? plan.serveAt.toISOString() : null,
      plan.cookCount,
      plan.createdAt.toISOString(),
      plan.modifiedAt.toISOString(),
      JSON.stringify(plan),
    );
  },

  async remove(id: string): Promise<void> {
    await getDb().runAsync('DELETE FROM cook_plans WHERE id = ?', id);
  },
};

export const cookRepo = {
  async byRecipe(recipeId: string): Promise<Cook[]> {
    const rows = await getDb().getAllAsync<{ data: string }>(
      'SELECT data FROM cooks WHERE recipe_id = ? ORDER BY started_at DESC',
      recipeId,
    );
    return rows.map((r) => JSON.parse(r.data) as Cook);
  },

  async upsert(cook: Cook): Promise<void> {
    await getDb().runAsync(
      `INSERT INTO cooks
         (id, recipe_id, started_at, finished_at, duration_minutes, mode, data)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         finished_at=excluded.finished_at,
         duration_minutes=excluded.duration_minutes, data=excluded.data`,
      cook.id,
      cook.recipeId,
      cook.startedAt.toISOString(),
      cook.finishedAt ? cook.finishedAt.toISOString() : null,
      cook.durationMinutes ?? null,
      cook.mode,
      JSON.stringify(cook),
    );
  },
};

export const planRepo = {
  async all(): Promise<PlanEntry[]> {
    const rows = await getDb().getAllAsync<{ data: string }>(
      'SELECT data FROM plan_entries ORDER BY date ASC',
    );
    return rows.map((r) => {
      const p = JSON.parse(r.data) as PlanEntry;
      p.date = new Date(p.date as unknown as string);
      return p;
    });
  },

  async upsert(entry: PlanEntry): Promise<void> {
    const db = getDb();
    // Store the LOCAL day key, not toISOString().slice(0,10) (UTC) — the
    // store matches entries by local dateKey(), so a UTC column drifts a day
    // east of UTC and desyncs the grid from what's persisted.
    const day = dateKey(entry.date);
    // (date, meal) is UNIQUE. The old ON CONFLICT(id)-only upsert threw
    // "UNIQUE constraint failed" when re-pinning a slot that held a row with
    // a different id (e.g. a seed), and setRecipe swallowed it — the pin was
    // silently lost. Clear the slot first so the write is idempotent.
    await db.runAsync(
      'DELETE FROM plan_entries WHERE date = ? AND meal = ? AND id <> ?',
      day,
      entry.meal,
      entry.id,
    );
    await db.runAsync(
      `INSERT INTO plan_entries
         (id, date, meal, recipe_id, pipeline_idea_id, status, cook_id, data)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         date=excluded.date, meal=excluded.meal,
         recipe_id=excluded.recipe_id, pipeline_idea_id=excluded.pipeline_idea_id,
         status=excluded.status, cook_id=excluded.cook_id, data=excluded.data`,
      entry.id,
      day,
      entry.meal,
      entry.recipeId ?? null,
      entry.pipelineIdeaId ?? null,
      entry.status,
      entry.cookId ?? null,
      JSON.stringify(entry),
    );
  },

  async remove(id: string): Promise<void> {
    await getDb().runAsync('DELETE FROM plan_entries WHERE id = ?', id);
  },
};

/** JSON round-trips Dates to ISO strings; restore the §4 Date fields. */
function revivePantryItem(raw: string): PantryItem {
  const p = JSON.parse(raw) as PantryItem;
  p.acquiredAt = new Date(p.acquiredAt as unknown as string);
  if (p.expiresAt) p.expiresAt = new Date(p.expiresAt as unknown as string);
  p.purchaseHistory = (p.purchaseHistory ?? []).map(
    (d) => new Date(d as unknown as string),
  );
  return p;
}

export const pantryRepo = {
  async all(): Promise<PantryItem[]> {
    const rows = await getDb().getAllAsync<{ data: string }>(
      'SELECT data FROM pantry_items ORDER BY is_staple DESC, acquired_at DESC',
    );
    return rows.map((r) => revivePantryItem(r.data));
  },

  async upsert(item: PantryItem): Promise<void> {
    await getDb().runAsync(
      `INSERT INTO pantry_items
         (id, canonical_name, location, is_staple, acquired_at, expires_at, data)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         canonical_name=excluded.canonical_name, location=excluded.location,
         is_staple=excluded.is_staple, acquired_at=excluded.acquired_at,
         expires_at=excluded.expires_at, data=excluded.data`,
      item.id,
      item.canonicalName,
      item.location,
      item.isStaple ? 1 : 0,
      item.acquiredAt.toISOString(),
      item.expiresAt ? item.expiresAt.toISOString() : null,
      JSON.stringify(item),
    );
  },

  async remove(id: string): Promise<void> {
    await getDb().runAsync('DELETE FROM pantry_items WHERE id = ?', id);
  },
};

function revivePipelineIdea(raw: string): PipelineIdea {
  const p = JSON.parse(raw) as PipelineIdea;
  p.createdAt = new Date(p.createdAt as unknown as string);
  p.bestGuessIngredients?.forEach((i) => reviveModDates(i.modificationHistory));
  return p;
}

export const pipelineRepo = {
  async all(): Promise<PipelineIdea[]> {
    const rows = await getDb().getAllAsync<{ data: string }>(
      'SELECT data FROM pipeline_ideas ORDER BY created_at DESC',
    );
    return rows.map((r) => revivePipelineIdea(r.data));
  },

  async byId(id: string): Promise<PipelineIdea | null> {
    const row = await getDb().getFirstAsync<{ data: string }>(
      'SELECT data FROM pipeline_ideas WHERE id = ?',
      id,
    );
    return row ? revivePipelineIdea(row.data) : null;
  },

  async upsert(idea: PipelineIdea): Promise<void> {
    await getDb().runAsync(
      `INSERT INTO pipeline_ideas
         (id, title, status, promoted_recipe_id, created_at, data)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, status=excluded.status,
         promoted_recipe_id=excluded.promoted_recipe_id, data=excluded.data`,
      idea.id,
      idea.title,
      idea.status,
      idea.promotedRecipeId ?? null,
      idea.createdAt.toISOString(),
      JSON.stringify(idea),
    );
  },

  async remove(id: string): Promise<void> {
    await getDb().runAsync('DELETE FROM pipeline_ideas WHERE id = ?', id);
  },
};
