/**
 * Dinners — recipes that reference other recipes.
 *
 * A `Recipe` may link other recipes through `componentRecipes`. Two shapes use
 * the same mechanism:
 *   - a normal recipe pointing at a sub-recipe it uses ("the ginger-scallion
 *     oil", "the dry brine"), and
 *   - a **dinner** (`isDinner`): a named spread whose body is mostly links —
 *     roast chicken + slaw + bread — plus whatever steps and notes are its own
 *     ("open the wine at 6", "plate family style").
 *
 * A reference is a LINK, never a copy, so editing the chicken recipe updates
 * every dinner that serves it. That makes cycles possible by hand (A includes
 * B includes A), so every reader here is cycle-safe: traversal tracks a visited
 * set and stops, rather than trusting the data to be a tree.
 *
 * Pure module — no store, no IO — so it unit-tests directly and is safe to call
 * from a render pass.
 */
import { uid } from '@/lib/id';
import type { Ingredient, Recipe, RecipeRef } from '@/types';

/** How deep a reference chain is followed before we stop. */
export const MAX_DEPTH = 4;

/** Lookup shape both the stores and the tests can satisfy. */
export type RecipeIndex = Map<string, Recipe> | ((id: string) => Recipe | undefined);

function lookup(index: RecipeIndex, id: string): Recipe | undefined {
  return typeof index === 'function' ? index(id) : index.get(id);
}

/** Build an index from a flat recipe list. */
export function indexRecipes(recipes: Recipe[]): Map<string, Recipe> {
  return new Map(recipes.map((r) => [r.id, r]));
}

/** This recipe's references, always an array. */
export function componentRefs(recipe: Recipe | undefined): RecipeRef[] {
  return recipe?.componentRecipes ?? [];
}

/** Does this recipe link any other recipe? */
export function hasComponents(recipe: Recipe | undefined): boolean {
  return componentRefs(recipe).length > 0;
}

/**
 * Is this a dinner? The explicit flag wins. A recipe that is all links and no
 * method of its own reads as one too — that is what a dinner IS, and it keeps
 * rows saved before the flag existed from looking like plain recipes.
 */
export function isDinner(recipe: Recipe | undefined): boolean {
  if (!recipe) return false;
  if (recipe.isDinner) return true;
  return componentRefs(recipe).length > 0 && recipe.steps.length === 0;
}

/** A reference paired with the live recipe it points at (undefined if gone). */
export type ResolvedRef = {
  ref: RecipeRef;
  recipe?: Recipe;
  /** live title when it resolves, else the link-time snapshot, else a stub */
  title: string;
  /** the target is missing from the library (deleted, or not synced yet) */
  missing: boolean;
};

/** Resolve one recipe's direct references against the library. */
export function resolveRefs(recipe: Recipe | undefined, index: RecipeIndex): ResolvedRef[] {
  return componentRefs(recipe).map((ref) => {
    const target = lookup(index, ref.recipeId);
    return {
      ref,
      recipe: target,
      title: target?.title ?? ref.title ?? 'Missing recipe',
      missing: !target,
    };
  });
}

/** A recipe reached by walking references, with how it was reached. */
export type ExpandedRecipe = {
  recipe: Recipe;
  /** 0 for the root, 1 for a direct component, … */
  depth: number;
  /** product of every `scale` on the path from the root (1 when none) */
  scale: number;
  /** the reference that pulled it in (absent for the root) */
  ref?: RecipeRef;
};

/**
 * Walk a recipe and everything it references, breadth-first, de-duplicated.
 * The root is always first. A recipe reached twice is kept once (its first,
 * shallowest reach wins) — which is also what makes a reference cycle safe.
 */
export function expandRecipe(
  root: Recipe | undefined,
  index: RecipeIndex,
  opts: { maxDepth?: number; includeRoot?: boolean } = {},
): ExpandedRecipe[] {
  if (!root) return [];
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const includeRoot = opts.includeRoot ?? true;
  const seen = new Set<string>([root.id]);
  const out: ExpandedRecipe[] = [];
  const rootNode: ExpandedRecipe = { recipe: root, depth: 0, scale: 1 };
  if (includeRoot) out.push(rootNode);

  let frontier: ExpandedRecipe[] = [rootNode];
  while (frontier.length > 0) {
    const next: ExpandedRecipe[] = [];
    for (const node of frontier) {
      if (node.depth >= maxDepth) continue;
      for (const ref of componentRefs(node.recipe)) {
        if (seen.has(ref.recipeId)) continue;
        const target = lookup(index, ref.recipeId);
        if (!target) continue;
        seen.add(target.id);
        const child: ExpandedRecipe = {
          recipe: target,
          depth: node.depth + 1,
          scale: node.scale * (ref.scale ?? 1),
          ref,
        };
        out.push(child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return out;
}

/** Just the recipes a dinner pulls in, root first. Convenience over expandRecipe. */
export function dinnerRecipes(root: Recipe | undefined, index: RecipeIndex): Recipe[] {
  return expandRecipe(root, index).map((e) => e.recipe);
}

/** Scale an ingredient's amount, leaving "to taste" (null) alone. */
function scaleIngredient(ing: Ingredient, scale: number): Ingredient {
  if (scale === 1 || ing.amount == null) return ing;
  return { ...ing, amount: ing.amount * scale };
}

/** Ingredients grouped by the recipe they came from — the detail-screen view. */
export type IngredientGroup = {
  recipeId: string;
  title: string;
  /** true for the dinner's own ingredients */
  isRoot: boolean;
  ingredients: Ingredient[];
};

/**
 * Every ingredient a recipe needs including the ones its references bring,
 * grouped per source recipe and scaled by the path. Groups with no ingredients
 * are dropped, so a dinner that has none of its own starts at its first dish.
 */
export function ingredientGroups(
  root: Recipe | undefined,
  index: RecipeIndex,
): IngredientGroup[] {
  return expandRecipe(root, index)
    .map((node) => ({
      recipeId: node.recipe.id,
      title: node.recipe.title,
      isRoot: node.depth === 0,
      ingredients: node.recipe.ingredients.map((i) => scaleIngredient(i, node.scale)),
    }))
    .filter((g) => g.ingredients.length > 0);
}

/** Flat rolled-up ingredient list (own + referenced), in group order. */
export function rollupIngredients(
  root: Recipe | undefined,
  index: RecipeIndex,
): Ingredient[] {
  return ingredientGroups(root, index).flatMap((g) => g.ingredients);
}

/** Total minutes across a dinner, when any part declares one. */
export function rollupMinutes(
  root: Recipe | undefined,
  index: RecipeIndex,
): number | undefined {
  const mins = expandRecipe(root, index)
    .map((e) => e.recipe.yield.totalMinutes)
    .filter((m): m is number => typeof m === 'number' && m > 0);
  return mins.length > 0 ? mins.reduce((a, b) => a + b, 0) : undefined;
}

/**
 * Would linking `childId` into `parentId` create a cycle? True when the parent
 * is already reachable from the child — the picker uses this to refuse the link
 * rather than let traversal silently truncate later.
 */
export function wouldCycle(parentId: string, childId: string, index: RecipeIndex): boolean {
  if (parentId === childId) return true;
  const child = lookup(index, childId);
  if (!child) return false;
  return expandRecipe(child, index).some((e) => e.recipe.id === parentId);
}

/** Is this recipe already linked here? */
export function linksTo(recipe: Recipe | undefined, recipeId: string): boolean {
  return componentRefs(recipe).some((r) => r.recipeId === recipeId);
}

/**
 * Pure add — returns the recipe with `target` linked on the end. A duplicate
 * link or a cycle is a no-op (the same object comes back), so callers can just
 * save the result.
 */
export function addComponent(
  recipe: Recipe,
  target: Recipe,
  index: RecipeIndex,
  extra: { note?: string; scale?: number } = {},
): Recipe {
  if (linksTo(recipe, target.id)) return recipe;
  if (wouldCycle(recipe.id, target.id, index)) return recipe;
  const ref: RecipeRef = {
    id: uid('ref'),
    recipeId: target.id,
    title: target.title,
    ...(extra.note ? { note: extra.note } : {}),
    ...(extra.scale && extra.scale !== 1 ? { scale: extra.scale } : {}),
  };
  return {
    ...recipe,
    componentRecipes: [...componentRefs(recipe), ref],
    modifiedAt: new Date(),
  };
}

/** Pure remove by reference id. */
export function removeComponent(recipe: Recipe, refId: string): Recipe {
  const next = componentRefs(recipe).filter((r) => r.id !== refId);
  if (next.length === componentRefs(recipe).length) return recipe;
  return { ...recipe, componentRecipes: next, modifiedAt: new Date() };
}

/** Pure patch of one reference (note / scale). */
export function updateComponent(
  recipe: Recipe,
  refId: string,
  patch: Partial<Pick<RecipeRef, 'note' | 'scale'>>,
): Recipe {
  return {
    ...recipe,
    componentRecipes: componentRefs(recipe).map((r) =>
      r.id === refId ? { ...r, ...patch } : r,
    ),
    modifiedAt: new Date(),
  };
}

/** Move a reference up/down so the dinner reads in the order you serve it. */
export function moveComponent(recipe: Recipe, refId: string, delta: number): Recipe {
  const refs = [...componentRefs(recipe)];
  const i = refs.findIndex((r) => r.id === refId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= refs.length) return recipe;
  const a = refs[i];
  const b = refs[j];
  if (!a || !b) return recipe;
  refs[i] = b;
  refs[j] = a;
  return { ...recipe, componentRecipes: refs, modifiedAt: new Date() };
}

/**
 * Every dinner that serves this recipe — the reverse link, shown on a plain
 * recipe so you know what it is part of before you edit or delete it.
 */
export function dinnersContaining(recipeId: string, recipes: Recipe[]): Recipe[] {
  return recipes.filter((r) => r.id !== recipeId && linksTo(r, recipeId));
}

/** A blank dinner, ready to have recipes added. */
export function newDinner(title: string): Recipe {
  const now = new Date();
  return {
    id: uid('recipe'),
    title: title.trim() || 'Dinner',
    source: { type: 'mine', name: 'Dinner' },
    status: 'active',
    yield: { serves: 4 },
    ingredients: [],
    steps: [],
    tags: [],
    createdAt: now,
    modifiedAt: now,
    cookCount: 0,
    componentRecipes: [],
    isDinner: true,
  };
}
