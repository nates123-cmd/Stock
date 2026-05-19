/**
 * Keyless best-guess ingredient parser — fallback for spec §11.7 (Pipeline →
 * Plan as experiment, spec §8). Turns the cook's free-text "what will you
 * probably use?" into Ingredient[]. Everything is flagged "guessed": this is
 * a pre-cook hunch, not an extracted recipe, so the §5 experimental treatment
 * and §6 review styling read it as low-confidence.
 */
import type { Ingredient } from '@/types';
import { uid } from '@/lib/id';
import type { Confidenced } from './confidence';

const FRACTIONS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125,
};

const UNITS = new Set([
  'g', 'kg', 'mg', 'ml', 'l', 'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'lbs',
  'clove', 'cloves', 'pc', 'piece', 'pieces', 'pinch', 'can', 'stick', 'sticks',
  'bunch', 'sprig', 'sprigs',
]);

const LINE_RE = /^[-•*\s]*((?:\d+[\d./]*\s*[½¼¾⅓⅔⅛]?)|[½¼¾⅓⅔⅛])?\s*([a-zA-Z]+)?\s*(.*)$/;

function qty(token: string | undefined): number | null {
  if (!token) return null;
  const t = token.trim();
  const m = t.match(/^(\d+)?\s*([½¼¾⅓⅔⅛])$/);
  if (m) return (m[1] ? parseInt(m[1], 10) : 0) + (FRACTIONS[m[2] as string] ?? 0);
  if (FRACTIONS[t] != null) return FRACTIONS[t] as number;
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number);
    return b ? (a as number) / (b as number) : null;
  }
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function localBestGuess(freeText: string): Confidenced<Ingredient>[] {
  return freeText
    .split(/\r?\n|,/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(LINE_RE);
      const amount = qty(m?.[1]);
      let unit: string | null = null;
      let name = (m?.[3] ?? '').trim();
      const maybeUnit = (m?.[2] ?? '').toLowerCase();
      if (maybeUnit && UNITS.has(maybeUnit)) unit = maybeUnit;
      else if (maybeUnit) name = `${maybeUnit} ${name}`.trim();
      if (!name) name = line.toLowerCase();
      const ingredient: Ingredient = {
        id: uid('ing'),
        amount,
        unit,
        canonicalName: name.replace(/\s+/g, ' ').toLowerCase(),
        originalText: line,
        modificationHistory: [],
      };
      return { value: ingredient, confidence: 'guessed' as const };
    });
}
