import { describe, expect, it } from 'vitest';
import { dropIndex, moveItem, rowShift } from '../src/lib/sortable';

describe('moveItem', () => {
  it('moves down and up', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
  });
  it('is a no-op for same or out-of-range indexes, and never mutates', () => {
    const rows = ['a', 'b'];
    expect(moveItem(rows, 1, 1)).toEqual(['a', 'b']);
    expect(moveItem(rows, 0, 5)).toEqual(['a', 'b']);
    expect(rows).toEqual(['a', 'b']);
  });
});

describe('dropIndex', () => {
  // Three 60px rows, 8px gap: tops at 0, 68, 136; midpoints 30, 98, 166.
  const H = [60, 60, 60];
  it('stays put under half a row', () => {
    expect(dropIndex(H, 8, 0, 30)).toBe(0);
    expect(dropIndex(H, 8, 2, -30)).toBe(2);
  });
  it('moves one slot past the neighbour midpoint', () => {
    expect(dropIndex(H, 8, 0, 70)).toBe(1);
    expect(dropIndex(H, 8, 2, -80)).toBe(1);
  });
  it('goes to the ends on a long drag, and clamps beyond them', () => {
    expect(dropIndex(H, 8, 0, 160)).toBe(2);
    expect(dropIndex(H, 8, 2, -150)).toBe(0);
    expect(dropIndex(H, 8, 0, 999)).toBe(2);
    expect(dropIndex(H, 8, 2, -999)).toBe(0);
  });
  it('respects uneven heights (a long step next to short ones)', () => {
    // tops 0, 128, 176; midpoints 60, 148, 196. The short last row has to
    // rise 48px to pass its neighbour, and 136px to pass the tall first row.
    const U = [120, 40, 40];
    expect(dropIndex(U, 8, 2, -40)).toBe(2);
    expect(dropIndex(U, 8, 2, -50)).toBe(1);
    expect(dropIndex(U, 8, 2, -140)).toBe(0);
  });
  it('a missing row index is a no-op', () => {
    expect(dropIndex(H, 8, 7, 100)).toBe(7);
  });
});

describe('rowShift', () => {
  const slot = 68;
  it('nothing moves without a drag, and the dragged row is the gesture’s job', () => {
    expect(rowShift(1, null)).toBe(0);
    expect(rowShift(0, { from: 0, to: 2, slot })).toBe(0);
  });
  it('dragging down lifts the rows it passes', () => {
    const d = { from: 0, to: 2, slot };
    expect([1, 2, 3].map((i) => rowShift(i, d))).toEqual([-slot, -slot, 0]);
  });
  it('dragging up drops the rows it passes', () => {
    const d = { from: 2, to: 0, slot };
    expect([0, 1, 3].map((i) => rowShift(i, d))).toEqual([slot, slot, 0]);
  });
});
