/**
 * "Recently viewed" ordering for the recipe library.
 *
 * A recipe's recency is the later of when you last OPENED it and when it was
 * ADDED. Folding the added date in matters: a recipe you imported a minute ago
 * has never been opened, and sorting purely by view time would bury it under
 * everything you have ever looked at.
 */
export type ViewedMap = Record<string, number>;

export function recencyOf(
  r: { id: string; createdAt: Date | string },
  viewedAt: ViewedMap,
): number {
  const created = new Date(r.createdAt).getTime();
  const viewed = viewedAt[r.id] ?? 0;
  return Math.max(Number.isFinite(created) ? created : 0, viewed);
}

/** Descending: most recently viewed (or added) first. */
export function byRecentlyViewed<T extends { id: string; createdAt: Date | string }>(
  viewedAt: ViewedMap,
): (a: T, b: T) => number {
  return (a, b) => recencyOf(b, viewedAt) - recencyOf(a, viewedAt);
}
