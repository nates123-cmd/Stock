/**
 * Pure maths behind drag-to-reorder (components/SortableList.tsx), kept here
 * so it can be tested without a renderer.
 */

/** Move one element; returns a new array. Out-of-range indexes are a no-op. */
export function moveItem<T>(rows: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) {
    return rows.slice();
  }
  const next = rows.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * The index a dragged row would land at.
 *
 * `heights` are the rows' heights in their CURRENT order, stacked with `gap`
 * between them. The row lands past every row whose midpoint its own centre
 * has crossed — the usual "half way over the neighbour" rule.
 */
export function dropIndex(heights: readonly number[], gap: number, from: number, dy: number): number {
  const ys: number[] = [];
  let y = 0;
  for (const h of heights) {
    ys.push(y);
    y += h + gap;
  }
  const mine = heights[from];
  if (mine == null) return from;
  const centre = ys[from]! + mine / 2 + dy;
  let to = from;
  if (dy > 0) {
    for (let i = from + 1; i < heights.length; i++) {
      if (centre > ys[i]! + heights[i]! / 2) to = i;
    }
  } else {
    for (let i = from - 1; i >= 0; i--) {
      if (centre < ys[i]! + heights[i]! / 2) to = i;
    }
  }
  return to;
}

/**
 * How far row `i` slides while another row is being dragged from `from`
 * toward `to`: one slot (the dragged row's height + gap, `slot`) toward the
 * hole it leaves. The dragged row itself is moved by the gesture, not here.
 */
export function rowShift(i: number, drag: { from: number; to: number; slot: number } | null): number {
  if (!drag || i === drag.from) return 0;
  if (drag.from < i && i <= drag.to) return -drag.slot;
  if (drag.to <= i && i < drag.from) return drag.slot;
  return 0;
}
