/**
 * Dinner → Cook Plan.
 *
 * A dinner (a Recipe that references other recipes — see lib/dinners) is the
 * *what*: the spread, and the recipes that make it. A CookPlan is the *when*:
 * one interleaved, back-scheduled timeline you run live with alarms. This is
 * the morph between them.
 *
 * The timeline itself comes from `combineMeal`, which already asks Claude to
 * interleave several dishes' steps against a serve time and degrades to a
 * sequential per-dish list offline. All this module adds is the translation:
 *   CombinedStep[] (flat, "T-2h" labels) → PlanPhase[] (bucketed, with the
 *   hours-before-serve windows planSchedule.ts turns into wall-clock times).
 *
 * Each referenced recipe becomes a PlanComponent carrying its ingredients and
 * a `recipeId` back-link, so the plan stays traceable to the recipe it came
 * from and a future shopping rollup can treat plan components uniformly.
 */
import { combineMeal } from '@/lib/combineMeal';
import { componentsFromRecipes, phasesFromCombined } from '@/lib/cookPlanShape';
import { expandRecipe, type RecipeIndex } from '@/lib/dinners';
import { uid } from '@/lib/id';
import type { CookPlan, Recipe } from '@/types';

export {
  componentsFromRecipes,
  parseOffsetHours,
  phasesFromCombined,
  timerFromText,
} from '@/lib/cookPlanShape';

export type BuildPlanResult = {
  plan: CookPlan;
  /** whether the timeline came from Claude or the offline fallback */
  source: 'claude' | 'fallback';
};

/**
 * Build a CookPlan from a dinner. Never throws — combineMeal degrades to the
 * sequential fallback when Claude is unavailable, and a dinner whose links are
 * all missing still produces a valid (empty-ish) plan rather than nothing.
 */
export async function buildCookPlanFromDinner(
  dinner: Recipe,
  index: RecipeIndex,
  opts: { serveAt?: Date; force?: boolean } = {},
): Promise<BuildPlanResult> {
  const expanded = expandRecipe(dinner, index);
  // The root only earns a component of its own when it brings ingredients —
  // a pure dinner ("just the three recipes") should not show an empty row.
  const forComponents = expanded.filter(
    (e) => e.depth > 0 || e.recipe.ingredients.length > 0,
  );
  const components = componentsFromRecipes(
    forComponents.map((e) => ({ recipe: e.recipe, scale: e.scale })),
  );

  // Every part that has actual method to schedule, the dinner's own steps
  // included (those are the "open the wine", "plate it" instructions).
  const dishes = expanded
    .filter((e) => e.recipe.steps.length > 0)
    .map((e) => ({ title: e.recipe.title, steps: e.recipe.steps }));

  const combined = await combineMeal(dishes, {
    serveLabel: dinner.title,
    force: opts.force,
  });
  const phases = phasesFromCombined(combined.steps, components);

  const now = new Date();
  const plan: CookPlan = {
    id: uid('plan'),
    title: dinner.title,
    status: 'active',
    spread: expanded.filter((e) => e.depth > 0).map((e) => e.recipe.title),
    components,
    phases,
    myNotes: dinner.myNotes,
    ...(opts.serveAt ? { serveAt: opts.serveAt } : {}),
    createdAt: now,
    modifiedAt: now,
    cookCount: 0,
    origin: 'manual',
  };
  return { plan, source: combined.source };
}
