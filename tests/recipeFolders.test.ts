import { describe, expect, it } from 'vitest';
import type { Recipe } from '@/types';
import {
  UNFILED,
  folderCounts,
  inFolder,
  normalizeFolderName,
  unfiledCount,
} from '@/lib/recipeFolders';

const rec = (id: string, folder?: string, extra: Partial<Recipe> = {}): Recipe =>
  ({
    id,
    title: id,
    status: 'active',
    tags: [],
    cookCount: 0,
    ingredients: [],
    steps: [],
    createdAt: new Date('2026-01-01'),
    modifiedAt: new Date('2026-01-01'),
    ...(folder ? { folder } : {}),
    ...extra,
  }) as Recipe;

describe('normalizeFolderName', () => {
  it('collapses whitespace and treats blank as unfiled', () => {
    expect(normalizeFolderName('  Week   night ')).toBe('Week night');
    expect(normalizeFolderName('   ')).toBeUndefined();
  });
});

describe('folderCounts', () => {
  it('counts per folder, alphabetically', () => {
    const lib = [rec('a', 'Weeknight'), rec('b', 'Baking'), rec('c', 'Weeknight'), rec('d')];
    expect(folderCounts(lib)).toEqual([
      { name: 'Baking', count: 1 },
      { name: 'Weeknight', count: 2 },
    ]);
  });

  it('treats differently-cased spellings as one folder', () => {
    const lib = [rec('a', 'Baking'), rec('b', 'baking')];
    const out = folderCounts(lib);
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(2);
  });

  it('counts describe only the recipes handed in — that is what scopes the bar to a segment', () => {
    const lib = [
      rec('a', 'Weeknight', { isFavorite: true }),
      rec('b', 'Weeknight'),
      rec('c', 'Weeknight'),
    ];
    expect(folderCounts(lib)[0]!.count).toBe(3);
    expect(folderCounts(lib.filter((r) => r.isFavorite))[0]!.count).toBe(1);
  });
});

describe('unfiledCount', () => {
  it('counts recipes with no folder, including whitespace-only', () => {
    expect(unfiledCount([rec('a'), rec('b', 'X'), rec('c', '  ')])).toBe(2);
  });
});

describe('inFolder', () => {
  it('null selects everything', () => {
    expect(inFolder(rec('a', 'X'), null)).toBe(true);
    expect(inFolder(rec('b'), null)).toBe(true);
  });

  it('UNFILED selects only the folderless', () => {
    expect(inFolder(rec('a'), UNFILED)).toBe(true);
    expect(inFolder(rec('b', 'X'), UNFILED)).toBe(false);
  });

  it('matches a named folder case-insensitively', () => {
    expect(inFolder(rec('a', 'Baking'), 'baking')).toBe(true);
    expect(inFolder(rec('a', 'Baking'), 'Weeknight')).toBe(false);
  });
});
