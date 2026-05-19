import type { Ingredient, Recipe } from '@/types';
import { monthShort } from './format';

/** Total modifications across ingredients + steps (spec §6 "modified" pill). */
export function modCount(r: Recipe): number {
  const ing = r.ingredients.reduce((n, i) => n + i.modificationHistory.length, 0);
  const stp = r.steps.reduce((n, s) => n + s.modificationHistory.length, 0);
  return ing + stp;
}

export function isModified(r: Recipe): boolean {
  return modCount(r) > 0;
}

/**
 * Inline annotation for a modified ingredient (spec §6):
 *   "· upped from 150g (Apr)"  /  "· reduced from 1¼ tsp (Apr)"
 * Uses the most recent modification.
 */
export function ingredientAnnotation(ing: Ingredient): string | null {
  const m = ing.modificationHistory.at(-1);
  if (!m) return null;
  const when = m.date instanceof Date ? ` (${monthShort(m.date)})` : '';
  const unit = ing.unit ?? '';
  if (m.type === 'amount') {
    const before = `${m.before as number}${unit}`;
    const verb = (m.after as number) > (m.before as number) ? 'upped' : 'reduced';
    return `· ${verb} from ${before}${when}`;
  }
  if (m.type === 'name') return `· renamed${when}`;
  if (m.type === 'added') return `· added${when}`;
  if (m.type === 'removed') return `· removed${when}`;
  return `· edited${when}`;
}
