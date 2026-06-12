/**
 * Free-text ingredient line parser — the cheap, deterministic FIRST PASS for
 * "2 cups flour" → {amount, unit, name}, shared by every keyless parser
 * (localRecipe, localBestGuess, localInstacart manual-add). Backed by the
 * `parse-ingredient` library (jakeboone02), which carries a far larger UOM
 * vocabulary and quantity grammar (unicode fractions, ranges, mixed numbers)
 * than the hand-rolled regexes it replaces.
 *
 * Stock keeps its OWN canonical Unit set (spec §4), so this module maps
 * parse-ingredient's `unitOfMeasureID` onto Stock codes and — crucially —
 * folds any UOM Stock doesn't recognize back into the ingredient NAME. That
 * matches the prior hand-rolled contract (e.g. "1 bunch parsley" → unit null,
 * name "bunch parsley") rather than leaking the library's wider vocabulary
 * into the typed Unit set.
 *
 * Claude stays the deep-inference path (parsing/recipe.ts, instacart.ts); this
 * is the local fallback those modules drop to when no key is configured.
 */
import { parseIngredient } from 'parse-ingredient';

/**
 * parse-ingredient `unitOfMeasureID` → Stock canonical Unit (spec §4). Only
 * IDs present here are emitted as a unit; anything else (e.g. "bunch",
 * "sprig", "pinch", "package") is treated as part of the name, preserving the
 * old UNIT_SYNONYMS behavior. parse-ingredient normalizes plurals/synonyms to
 * a singular ID before we ever see it ("teaspoons" → "teaspoon").
 */
const UOM_TO_STOCK: Record<string, string> = {
  gram: 'g',
  kilogram: 'kg',
  milligram: 'mg',
  milliliter: 'ml',
  liter: 'l',
  cup: 'cup',
  tablespoon: 'tbsp',
  teaspoon: 'tsp',
  ounce: 'oz',
  pound: 'lb',
  clove: 'clove',
  stick: 'stick',
  can: 'can',
  pinch: 'pinch',
  piece: 'pc',
};

export type ParsedLine = {
  /** primary quantity, or null when none was stated ("to taste") */
  amount: number | null;
  /** Stock canonical unit, or null when none/unrecognized */
  unit: string | null;
  /** the food, with any unrecognized UOM folded back in, trimmed */
  name: string;
};

/**
 * Parse a single free-text ingredient line into Stock's shape. Returns null
 * only when the line yields no usable food name (caller decides the fallback).
 */
export function parseIngredientLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const [parsed] = parseIngredient(trimmed, { normalizeUOM: true });
  if (!parsed) return null;

  const amount = parsed.quantity;
  let name = (parsed.description ?? '').trim();
  let unit: string | null = null;

  const id = parsed.unitOfMeasureID;
  if (id) {
    const stock = UOM_TO_STOCK[id];
    if (stock) {
      unit = stock;
    } else {
      // Unrecognized UOM (bunch, sprig, package…): keep it in the name, using
      // the library's display form, exactly like the old hand-rolled parser.
      const word = (parsed.unitOfMeasure ?? id).trim();
      name = `${word} ${name}`.trim();
    }
  }

  name = name.replace(/\s+/g, ' ').trim();
  if (!name) return null;

  return { amount, unit, name };
}
