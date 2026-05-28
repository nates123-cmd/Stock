/**
 * Core domain types — transcribed from spec §4 "Data model".
 *
 * This is the canonical TypeScript surface; the SQLite schema (src/lib/db)
 * persists these. Deviations from the spec text:
 *  - Modification.before/after are `unknown` (spec wrote `any`) so strict mode
 *    forces a narrow at the use site.
 *  - `Date` fields are stored as ISO-8601 strings in SQLite and hydrated to
 *    Date by the db layer; the type stays `Date` for app-side ergonomics.
 */

export type Unit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'cup'
  | 'tbsp'
  | 'tsp'
  | 'oz'
  | 'lb'
  | 'pc'
  | (string & {}); // open set — parsers may emit others

export type RecipeSource = {
  /** Coarse category (drives the badge color); name carries the actual label. */
  type: 'nyt' | 'yt' | 'book' | 'mine' | 'web';
  /** Display label — derived at capture (hostname, JSON-LD publisher, etc.) and user-editable. */
  name?: string;
  url?: string;
  author?: string;
  bookRef?: string;
};

/**
 * Per-serving nutrition. `extracted` = from the source's schema.org/Recipe
 * JSON-LD; `estimated` = Claude's best guess from the ingredients (flag it so
 * the UI can mark it, and so a future Tide push knows the provenance).
 */
export type Nutrition = {
  per: 'serving';
  /** kcal */
  calories?: number;
  /** grams */
  protein?: number;
  carbs?: number;
  fat?: number;
  source: 'extracted' | 'estimated';
};

export type Recipe = {
  id: string;
  title: string;
  source: RecipeSource;
  status: 'draft' | 'active' | 'archived';
  yield: { serves: number; totalMinutes?: number };
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  myNotes?: string;
  /** optional planning note set at capture */
  firstCookIntention?: string;
  createdAt: Date;
  modifiedAt: Date;
  /** derived from Cook history */
  cookCount: number;
  /** if promoted from Pipeline */
  linkedPipelineId?: string;
  /** schema.org/Recipe image — the URL, not the bytes */
  imageUrl?: string;
  /** per-serving; extracted from source JSON-LD or estimated by Claude */
  nutrition?: Nutrition;
};

export type Ingredient = {
  id: string;
  amount: number | null;
  unit: Unit | null;
  /** normalized: "olive oil, EVOO" */
  canonicalName: string;
  /** raw text from source */
  originalText?: string;
  /** chronological */
  modificationHistory: Modification[];
  /** "good stuff, not blend" */
  inlineNote?: string;
};

export type ModificationType = 'amount' | 'added' | 'removed' | 'name' | 'note';

export type Modification = {
  id: string;
  /** null/undefined if direct edit (not during a cook) */
  cookId?: string;
  date: Date;
  type: ModificationType;
  before: unknown;
  after: unknown;
  /** free text */
  reason?: string;
};

export type Step = {
  id: string;
  ordinal: number;
  /** short version for glance mode */
  title: string;
  /** full text for focused mode */
  body: string;
  parsedTimers: { durationSeconds: number; label: string }[];
  parsedAmounts: { ingredientId: string; displayText: string }[];
  /** Fahrenheit */
  parsedTemperature?: number;
  modificationHistory: Modification[];
};

export type Cook = {
  id: string;
  recipeId: string;
  /** full recipe as it was that day */
  recipeVersionSnapshot: Recipe;
  startedAt: Date;
  finishedAt?: Date;
  durationMinutes?: number;
  /** for future multi-user (v1.1) */
  user?: string;
  /** "how'd it go" */
  note?: string;
  /** applied during this cook */
  modifications: Modification[];
  /** if user scaled */
  scaleFactor?: number;
  mode: 'focused' | 'glance';
  /** cook-time override of recipe.yield.serves; drives the Tide calorie push (spec §7) */
  servingsCooked?: number;
  /** when meal_log push succeeded; used for idempotent re-saves */
  tidePushedAt?: Date;
};

export type PipelineIdea = {
  id: string;
  title: string;
  note: string;
  status: 'captured' | 'researching' | 'ready' | 'attempted' | 'promoted';
  references: { url: string; label: string }[];
  /** for plan-as-experiment */
  bestGuessIngredients?: Ingredient[];
  createdAt: Date;
  /** once cooked */
  promotedRecipeId?: string;
};

export type PantryLocation = 'pantry' | 'fridge' | 'freezer';

/** Running-low signal — spec §10. Defaults to 'fine'. */
export type PantryStatus = 'fine' | 'low' | 'out';

export type PantryItem = {
  id: string;
  /** matches Ingredient.canonicalName */
  canonicalName: string;
  amount?: number;
  unit?: Unit;
  location: PantryLocation;
  /** "always have" flag */
  isStaple: boolean;
  acquiredAt: Date;
  /** heuristic by category */
  defaultFreshnessDays: number;
  /** computed */
  expiresAt?: Date;
  /** for cycle learning */
  purchaseHistory: Date[];
  /** computed from purchaseHistory */
  cycleEstimateDays?: number;
  originalInstacartText?: string;
  /** spec §10 running-low signal. Optional on the wire — missing reads as 'fine'. */
  status?: PantryStatus;
  /** free-text note about the item, persisted across status changes */
  statusNote?: string;
  /** when status last changed; used for stale 'out' aging */
  statusUpdatedAt?: Date;
};

export type Meal = 'breakfast' | 'lunch' | 'dinner';

export type PlanEntry = {
  id: string;
  /** year-month-day */
  date: Date;
  meal: Meal;
  recipeId?: string;
  /** if experimental */
  pipelineIdeaId?: string;
  status: 'planned' | 'cooked' | 'skipped';
  /** link once cooked */
  cookId?: string;
};

export type ShoppingCategory =
  | 'produce'
  | 'dairy'
  | 'meat'
  | 'pantry'
  | 'bakery'
  | 'frozen'
  | 'other';

export type ShoppingItem = {
  canonicalName: string;
  totalNeeded: { amount: number; unit: Unit };
  fromRecipes: { recipeId: string; amount: number; unit: Unit }[];
  pantryHas: { amount: number; unit: Unit } | null;
  toBuy: { amount: number; unit: Unit };
  category: ShoppingCategory;
  /** "bag of 6, lemons sell in bags" */
  rounding?: { suggestion: string; reason: string };
};

export type ShoppingList = {
  id: string;
  generatedFrom: { planEntries: string[]; dateRange: [Date, Date] };
  generatedAt: Date;
  items: ShoppingItem[];
  /** snapshot of pantry when generated */
  pantryCoverageAt: Date;
};
