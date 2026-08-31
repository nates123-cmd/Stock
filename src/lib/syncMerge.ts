/**
 * The reconciliation half of the cloud sync layer, kept pure and free of
 * react-native / supabase imports so it can be unit-tested directly. See
 * lib/sync.ts for the I/O and lifecycle around it.
 *
 * This is the piece that decides whether a local row survives a pull, so it is
 * also the piece that can lose data if it's wrong. The rules, in one place:
 *
 *   1. A cloud row whose `updated_at` matches the one we last saw is UNCHANGED.
 *      Keep the existing local object by reference — that's what makes a
 *      once-a-minute resync free (no re-render, no echo push back to cloud).
 *   2. A cloud row that is new or whose `updated_at` moved WINS. Revive it.
 *   3. A local row the cloud didn't return, that we have CONFIRMED was in the
 *      cloud, was deleted on another device. Drop it.
 *   4. A local row the cloud didn't return that was NEVER confirmed is one
 *      whose upload hasn't landed (new, or written while offline). KEEP it —
 *      dropping it is how a sync layer eats work the user just did.
 *   5. Exception to 4: the first pull for someone joining another person's
 *      household is an ADOPTION, not a merge. Their local-only rows are theirs,
 *      not the kitchen's, so they don't get carried in.
 *
 * The pull is two-phase, which is why stamps and bodies are separate inputs: a
 * recipe row carries an embedded photo, so re-downloading `data` for the whole
 * library every minute would cost megabytes of mobile data to learn that
 * nothing changed. Phase one reads `id, updated_at` only (a few KB), and
 * `idsNeedingFetch` names the handful of rows worth asking for in full.
 */

/** Phase-one row: the id and its version, no payload. */
export type CloudStamp = { id: string; updated_at: string };

export type MergePlan<T> = {
  /** The array to write to the store, or null when nothing moved. */
  next: T[] | null;
  /** Ids whose object ref changed (cloud won) — echo-suppress these. */
  changedIds: string[];
  /** Ids removed because another device deleted them — echo-suppress these. */
  droppedIds: string[];
};

/**
 * Which rows do we actually need the body of? Exactly those the cloud has that
 * we're missing locally, plus those whose version moved since our last pull.
 */
export function idsNeedingFetch<T extends { id: string }>(
  local: T[],
  stamps: CloudStamp[],
  seen: Map<string, string>,
): string[] {
  const localIds = new Set(local.map((x) => x.id));
  const out: string[] = [];
  for (const s of stamps) {
    if (localIds.has(s.id) && seen.get(s.id) === s.updated_at) continue;
    out.push(s.id);
  }
  return out;
}

export function planMerge<T extends { id: string }>(opts: {
  local: T[];
  /** Every row the cloud holds for this kitchen, id + version. */
  stamps: CloudStamp[];
  /** Bodies for (at least) the ids `idsNeedingFetch` asked for. */
  bodies: Map<string, unknown>;
  /** id → the updated_at last pulled for it. Mutated in place. */
  seen: Map<string, string>;
  /** Ids known to exist in the cloud. Mutated in place. */
  confirmed: Set<string>;
  revive: (raw: unknown) => T;
  /** Member's first pull of someone else's kitchen: drop local-only rows. */
  adoptOnly?: boolean;
}): MergePlan<T> {
  const { local, stamps, bodies, seen, confirmed, revive, adoptOnly = false } = opts;

  const localById = new Map(local.map((x) => [x.id, x]));
  const cloudIds = new Set(stamps.map((s) => s.id));
  const changedIds: string[] = [];
  const droppedIds: string[] = [];
  const nextById = new Map<string, T>();

  for (const s of stamps) {
    const existing = localById.get(s.id);
    if (existing && seen.get(s.id) === s.updated_at) {
      nextById.set(s.id, existing); // rule 1 — same ref, deliberately
      continue;
    }
    const raw = bodies.get(s.id);
    if (raw === undefined) {
      // The body fetch didn't cover this row — it was written again between the
      // two phases, or trimmed from the batch. Leave the local copy alone and
      // DON'T record the stamp, so the next pass picks it up.
      if (existing) nextById.set(s.id, existing);
      continue;
    }
    const item = revive(raw); // rule 2
    seen.set(s.id, s.updated_at);
    confirmed.add(s.id);
    nextById.set(s.id, item);
    changedIds.push(s.id);
  }

  for (const item of local) {
    if (cloudIds.has(item.id)) continue;
    if (confirmed.has(item.id) || adoptOnly) {
      droppedIds.push(item.id); // rules 3 and 5
      confirmed.delete(item.id);
      seen.delete(item.id);
    } else {
      nextById.set(item.id, item); // rule 4
    }
  }

  if (changedIds.length === 0 && droppedIds.length === 0 && nextById.size === local.length) {
    return { next: null, changedIds, droppedIds };
  }

  // Keep the local ordering for rows we already had; rows arriving from another
  // device go to the front, matching what the Realtime path does with an insert.
  const kept: T[] = [];
  const placed = new Set<string>();
  for (const item of local) {
    const next = nextById.get(item.id);
    if (next) {
      kept.push(next);
      placed.add(item.id);
    }
  }
  const fresh: T[] = [];
  for (const [id, item] of nextById) {
    if (!placed.has(id)) fresh.push(item);
  }

  return { next: [...fresh, ...kept], changedIds, droppedIds };
}
