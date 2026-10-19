import { describe, expect, it } from 'vitest';
import {
  backupCount,
  freshnessStatus,
  hasBackup,
  isDownstairs,
  isDownstairsLocation,
  isFrozenLocation,
  PANTRY_LOCATION_LABEL,
  PANTRY_LOCATION_ORDER,
} from '../src/lib/pantry';
import type { PantryItem } from '../src/types';

const DAY = 86_400_000;

function item(over: Partial<PantryItem> = {}): PantryItem {
  return {
    id: 'pan_t',
    canonicalName: 'chicken thighs',
    location: 'fridge',
    isStaple: false,
    acquiredAt: new Date(Date.now() - 30 * DAY),
    defaultFreshnessDays: 4,
    purchaseHistory: [],
    ...over,
  };
}

describe('downstairs locations', () => {
  it('every location has a label and sits in the chip order', () => {
    for (const loc of PANTRY_LOCATION_ORDER) expect(PANTRY_LOCATION_LABEL[loc]).toBeTruthy();
    expect(PANTRY_LOCATION_ORDER).toEqual(['pantry', 'fridge', 'freezer', 'basement', 'deep-freezer']);
  });

  it('basement + chest freezer are downstairs; kitchen spots are not', () => {
    expect(isDownstairsLocation('basement')).toBe(true);
    expect(isDownstairsLocation('deep-freezer')).toBe(true);
    expect(isDownstairsLocation('pantry')).toBe(false);
    expect(isDownstairsLocation('fridge')).toBe(false);
    expect(isDownstairsLocation('freezer')).toBe(false);
  });

  it('the chest freezer pauses the freshness clock like the kitchen freezer', () => {
    expect(isFrozenLocation('deep-freezer')).toBe(true);
    expect(freshnessStatus(item({ location: 'deep-freezer' }))).toBe('fresh');
    expect(freshnessStatus(item({ location: 'freezer' }))).toBe('fresh');
    // Same age on the basement shelf still ages — it's not frozen.
    expect(freshnessStatus(item({ location: 'basement' }))).toBe('wilting');
  });
});

describe('spares downstairs', () => {
  it('reads missing / bad counts as none', () => {
    expect(backupCount(item())).toBe(0);
    expect(backupCount(item({ backups: 0 }))).toBe(0);
    expect(backupCount(item({ backups: -2 }))).toBe(0);
    expect(backupCount(item({ backups: Number.NaN }))).toBe(0);
    expect(backupCount(item({ backups: 2.7 }))).toBe(2);
    expect(hasBackup(item({ backups: 1 }))).toBe(true);
    expect(hasBackup(item())).toBe(false);
  });

  it('a kitchen item with a spare belongs in the Downstairs section', () => {
    expect(isDownstairs(item({ location: 'pantry', backups: 1 }))).toBe(true);
    expect(isDownstairs(item({ location: 'pantry' }))).toBe(false);
    expect(isDownstairs(item({ location: 'deep-freezer' }))).toBe(true);
  });
});
