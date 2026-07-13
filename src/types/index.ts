import type { PantryCategory } from '@/lib/pantryCategories';
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
  /** user-pinned favorite — surfaces under the Recipes "Favorites" segment */
  isFavorite?: boolean;
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
  /**
   * What the To-Try item actually is (redesign — mixed-type capture bin).
   * Optional so existing persisted rows revive fine; absent reads as 'idea'.
   */
  kind?: 'idea' | 'ingredient' | 'link' | 'recipe';
  status: 'captured' | 'ready' | 'attempted' | 'promoted';
  references: { url: string; label: string }[];
  /** for plan-as-experiment */
  bestGuessIngredients?: Ingredient[];
  createdAt: Date;
  /** once cooked */
  promotedRecipeId?: string;
};

/* ---------------------------------------------------------------------------
 * Cook Plan — a multi-component, multi-phase production (a whole meal / event),
 * one level above a Recipe. A Recipe is one dish; a CookPlan bundles several
 * component recipes plus a phased, time-anchored timeline you run live during
 * the cook. Rare-but-worthy feature: the big Friday fried-chicken spread.
 * ------------------------------------------------------------------------- */

/**
 * A live-cook timer attached to a plan step.
 *  - `duration`: a fixed countdown (fry 12 min) — seconds.
 *  - `clock`: a long window with a min/max (brine 8-12h) — alarm fires at min,
 *    window stays open until max. Seconds.
 *  - `temp`: a target temperature (oil 375°F) — display only, no countdown.
 */
export type PlanTimer = {
  kind: 'duration' | 'clock' | 'temp';
  label: string;
  /** duration kind: the single countdown length, in seconds */
  seconds?: number;
  /** clock kind: alarm-at, in seconds */
  minSeconds?: number;
  /** clock kind: window-closes-at, in seconds */
  maxSeconds?: number;
  /** temp kind: target in Fahrenheit (a range collapses to its low end) */
  tempF?: number;
  /** temp kind: high end when the source gave a range (e.g. 325-335) */
  tempHighF?: number;
};

export type PlanStep = {
  id: string;
  ordinal: number;
  text: string;
  /** optional link back to the component this step builds */
  componentId?: string;
  timer?: PlanTimer;
};

/**
 * A timeline phase ("Tonight", "Tomorrow AM", "Cook night"). When the plan is
 * scheduled, `offsetFromServe` lets the app back-compute a wall-clock window
 * from the serve time (brine = serve − 8-12h).
 */
export type PlanPhase = {
  id: string;
  label: string;
  /** ordered work for this phase */
  steps: PlanStep[];
  /** hours-before-serve window for scheduling; omitted = unscheduled/relative */
  offsetFromServe?: { minHours: number; maxHours: number };
};

/**
 * A sub-recipe within a plan (the ginger-scallion oil, the dry brine, the
 * slaw dressing…). Ingredients reuse the Recipe `Ingredient` shape so a future
 * shopping rollup / baker's-% scaling can treat them uniformly.
 */
export type PlanComponent = {
  id: string;
  name: string;
  ingredients: Ingredient[];
  notes?: string;
  /** baker's-% anchor (e.g. slaw anchored on rice vinegar = 100%) */
  bakersPercent?: { anchorIngredientId: string };
  /** optional link to a standalone Recipe if this component was promoted */
  recipeId?: string;
};

export type CookPlan = {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'archived';
  /** the menu — what lands on the table ("fried chicken, rice, broth, …") */
  spread: string[];
  components: PlanComponent[];
  phases: PlanPhase[];
  myNotes?: string;
  /** set when the plan is scheduled; drives the Plan-tab shadow + phase windows */
  serveAt?: Date;
  createdAt: Date;
  modifiedAt: Date;
  /** how many times this whole spread has been run */
  cookCount: number;
  /** provenance of how it was created */
  origin?: 'paste' | 'manual';
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
  /**
   * Manual shelf-category override. Absent = use the keyword guess
   * (categorizePantryItem). No keyword list is ever right 100% of the time, so
   * every item can be reassigned by hand and the choice sticks.
   */
  category?: PantryCategory;
};

/**
 * Optional meal split (redesign Phase B). The default plan model merges every
 * dish for a day into ONE unlabeled meal; assigning a `type` splits a day into
 * lunch vs dinner. No forced breakfast label — context implies (spec note 2).
 */
export type MealType = 'lunch' | 'dinner';

export type MealStatus = 'planned' | 'cooked' | 'skipped';

/**
 * A single dish within a meal. Points at a recipe, a To-Try / pipeline item,
 * or is just a free-text title. `title` is the display fallback — for recipe /
 * pipeline dishes the live record's title wins when it resolves.
 */
export type Dish = {
  id: string;
  recipeId?: string;
  pipelineId?: string;
  title: string;
};

/**
 * A meal on a day — holds one or more dishes (redesign Phase B, Day→Meals→
 * Dishes). Merge-by-default: a day carries a single unlabeled meal (`type`
 * null/absent) unless the user splits it into lunch/dinner.
 */
export type Meal = {
  id: string;
  /** local year-month-day */
  date: Date;
  /** null/absent = the day's default unlabeled meal */
  type?: MealType | null;
  dishes: Dish[];
  status?: MealStatus;
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
