/**
 * Recipe folders.
 *
 * One shared set across the library: To Try and Favorites are filters that sit
 * ON TOP of folders, not separate filing systems. See the `folder` field on
 * Recipe for why.
 *
 * The list of folders is DERIVED from the recipes rather than stored anywhere.
 * That is what lets folders sync with no new table and no migration — a folder
 * is simply the set of recipes carrying that name.
 */
import type { Recipe } from '@/types';

/** Sentinel for "no folder", so the picker can offer it like any other row. */
export const UNFILED = '__unfiled__';

/** Trim and collapse whitespace; empty becomes undefined (= Unfiled). */
export function normalizeFolderName(raw: string): string | undefined {
  const clean = raw.trim().replace(/\s+/g, ' ');
  return clean || undefined;
}

/** Case-insensitive identity, so "Baking" and "baking" are one folder. */
const key = (s: string) => s.toLowerCase();

export type FolderCount = { name: string; count: number };

/**
 * Every folder present in `recipes`, alphabetical, with counts.
 *
 * Counts reflect exactly the recipes passed in — hand it the segment's
 * recipes and the counts describe that segment, which is what makes one
 * folder bar work for All, To Try and Favorites alike.
 */
export function folderCounts(recipes: Recipe[]): FolderCount[] {
  const seen = new Map<string, FolderCount>();
  for (const r of recipes) {
    const name = r.folder?.trim();
    if (!name) continue;
    const k = key(name);
    const hit = seen.get(k);
    if (hit) hit.count += 1;
    // First spelling encountered wins as the display name.
    else seen.set(k, { name, count: 1 });
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

/** How many of these recipes are in no folder at all. */
export function unfiledCount(recipes: Recipe[]): number {
  return recipes.filter((r) => !r.folder?.trim()).length;
}

/** Does this recipe belong in the given folder selection? */
export function inFolder(r: Recipe, selected: string | null): boolean {
  if (selected === null) return true; // "All folders"
  const own = r.folder?.trim();
  if (selected === UNFILED) return !own;
  return !!own && key(own) === key(selected);
}

/** All folder names across the library, for the picker's suggestions. */
export function allFolderNames(recipes: Recipe[]): string[] {
  return folderCounts(recipes).map((f) => f.name);
}
