import type { Ingredient, Modification, Recipe } from '@/types';
import { monthShort } from './format';
import { uid } from './id';

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
    // before/after may be a bare number (legacy) or {amount, unit} (current).
    const num = (v: unknown): number | null =>
      typeof v === 'number'
        ? v
        : v && typeof v === 'object' && typeof (v as { amount?: unknown }).amount === 'number'
          ? ((v as { amount: number }).amount)
          : null;
    const unitOf = (v: unknown, fallback: string): string =>
      v && typeof v === 'object' && typeof (v as { unit?: unknown }).unit === 'string'
        ? ((v as { unit: string }).unit)
        : fallback;
    const beforeAmt = num(m.before);
    const afterAmt = num(m.after);
    const beforeUnit = unitOf(m.before, unit);
    const beforeStr = beforeAmt != null ? `${beforeAmt}${beforeUnit}` : 'before';
    const verb =
      beforeAmt != null && afterAmt != null && afterAmt > beforeAmt
        ? 'upped'
        : beforeAmt != null && afterAmt != null && afterAmt < beforeAmt
          ? 'reduced'
          : 'changed';
    return `· ${verb} from ${beforeStr}${when}`;
  }
  if (m.type === 'name') return `· renamed${when}`;
  if (m.type === 'added') return `· added${when}`;
  if (m.type === 'removed') return `· removed${when}`;
  return `· edited${when}`;
}

/**
 * The recipe's original amount + unit, for inline-diff display
 * (~~45g~~ 60g, or ~~1 cup~~ 220g when units change too).
 *
 * Backwards-compatible: legacy modifications stored a bare number in
 * `before` (with same unit); newer ones store {amount, unit} so a
 * conversion from "1 cup" → "220g" shows both correctly.
 */
export function priorAmount(
  ing: Ingredient,
): { amount: number | null; unit: string | null } | null {
  const m = ing.modificationHistory.find((x) => x.type === 'amount');
  if (!m) return null;
  if (typeof m.before === 'number') {
    return { amount: m.before, unit: ing.unit };
  }
  if (m.before && typeof m.before === 'object') {
    const b = m.before as { amount?: number | null; unit?: string | null };
    return { amount: b.amount ?? null, unit: b.unit ?? null };
  }
  return null;
}

/** The recipe's original ingredient name, for inline-diff display. */
export function priorName(ing: Ingredient): string | null {
  const m = ing.modificationHistory.find((x) => x.type === 'name');
  return m && typeof m.before === 'string' ? m.before : null;
}

/** Whether this ingredient was added during a cook (no prior recipe entry). */
export function wasAdded(ing: Ingredient): boolean {
  const first = ing.modificationHistory[0];
  return !!first && first.type === 'added';
}

/** Build a Modification (spec §6). cookId ties it to a specific Cook. */
export function makeMod(opts: {
  type: Modification['type'];
  before: unknown;
  after: unknown;
  cookId?: string;
  reason?: string;
}): Modification {
  return {
    id: uid('mod'),
    cookId: opts.cookId,
    date: new Date(),
    type: opts.type,
    before: opts.before,
    after: opts.after,
    reason: opts.reason,
  };
}
