/**
 * Local-first SQLite schema — spec §4 ("Storage": local-first, SQLite, no
 * required server sync for v1; iCloud sync is v1.1+).
 *
 * Strategy: nested arrays (ingredients, steps, modificationHistory,
 * references, purchaseHistory…) are stored as JSON in a `data` column on the
 * owning row. Scalar fields we actually query/sort on are mirrored into typed,
 * indexed columns. This keeps v1 simple while leaving room to normalize later.
 *
 * Dates are stored as ISO-8601 TEXT.
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS recipes (
     id            TEXT PRIMARY KEY NOT NULL,
     title         TEXT NOT NULL,
     source_type   TEXT NOT NULL,
     status        TEXT NOT NULL,
     serves        INTEGER,
     total_minutes INTEGER,
     cook_count    INTEGER NOT NULL DEFAULT 0,
     linked_pipeline_id TEXT,
     created_at    TEXT NOT NULL,
     modified_at   TEXT NOT NULL,
     data          TEXT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_recipes_status ON recipes(status);`,
  `CREATE INDEX IF NOT EXISTS idx_recipes_cook_count ON recipes(cook_count DESC);`,

  `CREATE TABLE IF NOT EXISTS cooks (
     id          TEXT PRIMARY KEY NOT NULL,
     recipe_id   TEXT NOT NULL,
     started_at  TEXT NOT NULL,
     finished_at TEXT,
     duration_minutes INTEGER,
     mode        TEXT NOT NULL,
     data        TEXT NOT NULL,
     FOREIGN KEY (recipe_id) REFERENCES recipes(id)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_cooks_recipe ON cooks(recipe_id);`,

  `CREATE TABLE IF NOT EXISTS pipeline_ideas (
     id          TEXT PRIMARY KEY NOT NULL,
     title       TEXT NOT NULL,
     status      TEXT NOT NULL,
     promoted_recipe_id TEXT,
     created_at  TEXT NOT NULL,
     data        TEXT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_status ON pipeline_ideas(status);`,

  `CREATE TABLE IF NOT EXISTS pantry_items (
     id             TEXT PRIMARY KEY NOT NULL,
     canonical_name TEXT NOT NULL,
     location       TEXT NOT NULL,
     is_staple      INTEGER NOT NULL DEFAULT 0,
     acquired_at    TEXT NOT NULL,
     expires_at     TEXT,
     data           TEXT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_pantry_canonical ON pantry_items(canonical_name);`,
  `CREATE INDEX IF NOT EXISTS idx_pantry_staple ON pantry_items(is_staple);`,

  `CREATE TABLE IF NOT EXISTS plan_entries (
     id               TEXT PRIMARY KEY NOT NULL,
     date             TEXT NOT NULL,
     meal             TEXT NOT NULL,
     recipe_id        TEXT,
     pipeline_idea_id TEXT,
     status           TEXT NOT NULL,
     cook_id          TEXT,
     data             TEXT NOT NULL,
     UNIQUE (date, meal)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_plan_date ON plan_entries(date);`,

  // Cook Plans (v2) — a multi-component, multi-phase production. Like recipes,
  // nested data lives in the JSON blob; queryable scalars are mirrored.
  `CREATE TABLE IF NOT EXISTS cook_plans (
     id          TEXT PRIMARY KEY NOT NULL,
     title       TEXT NOT NULL,
     status      TEXT NOT NULL,
     serve_at    TEXT,
     cook_count  INTEGER NOT NULL DEFAULT 0,
     created_at  TEXT NOT NULL,
     modified_at TEXT NOT NULL,
     data        TEXT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_cook_plans_status ON cook_plans(status);`,

  `CREATE TABLE IF NOT EXISTS shopping_lists (
     id           TEXT PRIMARY KEY NOT NULL,
     generated_at TEXT NOT NULL,
     data         TEXT NOT NULL
   );`,

  // Cache for Claude API results (spec §11 "Caching": conversions cache on
  // input string, substitutions on ingredient+amount).
  `CREATE TABLE IF NOT EXISTS ai_cache (
     cache_key  TEXT PRIMARY KEY NOT NULL,
     task       TEXT NOT NULL,
     result     TEXT NOT NULL,
     created_at TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
];
