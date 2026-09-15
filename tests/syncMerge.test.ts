/**
 * Cloud-sync reconciliation (src/lib/syncMerge.ts).
 *
 * These are the rules that decide whether a row survives a pull, so they are
 * worth pinning: the bug this module was written for was "recipes I add on one
 * device never show up on the others", and the way a naive fix goes wrong is
 * the opposite failure — a resync that deletes rows whose upload hadn't landed.
 *
 * Round 3 (2026-09-14) added the inverse bug: rows DELETED on one device that
 * never left another. The old rule kept any local row the session had not
 * seen in the cloud, and "seen" lived in memory, so a reload turned every
 * locally-persisted row the cloud no longer had into an immortal ghost. The
 * merge now keys off a persisted set of PENDING uploads instead — see the
 * "ghost" cases below.
 */
import { describe, it, expect } from 'vitest';
import { idsNeedingFetch, planMerge } from '@/lib/syncMerge';

type Row = { id: string; title: string };
type FakeRow = { id: string; data: Row; updated_at: string };

const row = (id: string, title: string, updated_at: string): FakeRow => ({
  id,
  data: { id, title },
  updated_at,
});

const revive = (raw: unknown) => ({ ...(raw as Row) });

function ctx(
  seedSeen: [string, string][] = [],
  seedPending: string[] = [],
  seedPendingDeletes: string[] = [],
) {
  return {
    seen: new Map<string, string>(seedSeen),
    pending: new Set<string>(seedPending),
    pendingDeletes: new Set<string>(seedPendingDeletes),
  };
}

/**
 * Drives the real two-phase pull the way sync.ts does: split the fake cloud
 * into stamps, ask idsNeedingFetch what to fetch, and hand planMerge ONLY those
 * bodies. Any test that passes here would also pass against the network,
 * including the "we deliberately didn't download that row" cases.
 */
function merge(opts: {
  local: Row[];
  rows: FakeRow[];
  seen: Map<string, string>;
  pending: Set<string>;
  pendingDeletes?: Set<string>;
  adoptOnly?: boolean;
  /** Ids to withhold, simulating a body fetch that missed a row. */
  withhold?: string[];
}) {
  const stamps = opts.rows.map((r) => ({ id: r.id, updated_at: r.updated_at }));
  const wanted = idsNeedingFetch(opts.local, stamps, opts.seen, opts.pendingDeletes);
  const bodies = new Map<string, unknown>();
  for (const id of wanted) {
    if (opts.withhold?.includes(id)) continue;
    bodies.set(id, opts.rows.find((r) => r.id === id)!.data);
  }
  const plan = planMerge<Row>({
    local: opts.local,
    stamps,
    bodies,
    seen: opts.seen,
    pending: opts.pending,
    pendingDeletes: opts.pendingDeletes,
    revive,
    adoptOnly: opts.adoptOnly,
  });
  return { ...plan, fetched: wanted };
}

describe('planMerge', () => {
  it('does nothing when every cloud row is unchanged', () => {
    const local: Row[] = [{ id: 'a', title: 'Chili' }];
    const { seen, pending } = ctx([['a', 't1']]);

    const plan = merge({
      local,
      rows: [row('a', 'Chili', 't1')],
      seen,
      pending,
    });

    expect(plan.next).toBeNull();
    expect(plan.changedIds).toEqual([]);
    expect(plan.droppedIds).toEqual([]);
  });

  it('keeps the identical object reference for unchanged rows', () => {
    // Ref identity is load-bearing: the local→cloud subscriber diffs on it, so
    // a new ref for an unchanged row would push it straight back to the cloud.
    const keep: Row = { id: 'a', title: 'Chili' };
    const { seen, pending } = ctx([['a', 't1']]);

    const plan = merge({
      local: [keep, { id: 'b', title: 'Soup' }],
      rows: [row('a', 'Chili', 't1'), row('b', 'Soup v2', 't9')],
      seen,
      pending,
    });

    expect(plan.next).not.toBeNull();
    expect(plan.next!.find((x) => x.id === 'a')).toBe(keep);
    expect(plan.changedIds).toEqual(['b']);
  });

  it('brings down a recipe added on another device', () => {
    const { seen, pending } = ctx([['a', 't1']]);

    const plan = merge({
      local: [{ id: 'a', title: 'Chili' }],
      rows: [row('a', 'Chili', 't1'), row('z', 'Amanda’s Pasta', 't2')],
      seen,
      pending,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['z', 'a']);
    expect(plan.changedIds).toEqual(['z']);
    expect(seen.get('z')).toBe('t2');
  });

  it('takes the cloud version when a row was edited elsewhere', () => {
    const { seen, pending } = ctx([['a', 't1']]);

    const plan = merge({
      local: [{ id: 'a', title: 'Chili' }],
      rows: [row('a', 'Chili (more cumin)', 't2')],
      seen,
      pending,
    });

    expect(plan.next![0]!.title).toBe('Chili (more cumin)');
    expect(seen.get('a')).toBe('t2');
  });

  it('drops a row another device deleted', () => {
    const { seen, pending } = ctx([
      ['a', 't1'],
      ['b', 't1'],
    ]);

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'b', title: 'Soup' },
      ],
      rows: [row('a', 'Chili', 't1')],
      seen,
      pending,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['a']);
    expect(plan.droppedIds).toEqual(['b']);
    expect(seen.has('b')).toBe(false);
  });

  it('drops a GHOST: a persisted local row the cloud lacks, on a fresh session', () => {
    // The 2026-09-14 bug. Phone deleted "shallot"; laptop had been reloaded
    // since, so its session had never seen the row in the cloud. The old rule
    // read "never confirmed" as "pending upload" and kept it — forever, on
    // every reload, un-killable from any other device. A fresh session has an
    // EMPTY seen map and an empty pending set; that must still drop the row.
    const { seen, pending } = ctx(); // nothing seen, nothing pending

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'shallot', title: 'shallot for Flower Child Salad' },
      ],
      rows: [row('a', 'Chili', 't1')],
      seen,
      pending,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['a']);
    expect(plan.droppedIds).toEqual(['shallot']);
  });

  it('KEEPS a local row whose upload is still pending', () => {
    // The offline case: the recipe was just written, its upsert hasn't landed
    // (or failed), so it is legitimately absent from the cloud. Dropping it
    // here would delete work the user can still see on screen.
    const { seen, pending } = ctx([['a', 't1']], ['new']);

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'new', title: 'Written on the subway' },
      ],
      rows: [row('a', 'Chili', 't1')],
      seen,
      pending,
    });

    // next === null means "leave the store as it is", and the store already
    // holds both rows — the pending one is untouched, which is the point.
    expect(plan.next).toBeNull();
    expect(plan.droppedIds).toEqual([]);
  });

  it('keeps a pending local row while ALSO applying a cloud change', () => {
    // The combination that matters: Amanda edits a recipe upstream at the same
    // moment this device has an unsent one. Both must survive.
    const { seen, pending } = ctx([['a', 't1']], ['new']);

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'new', title: 'Written on the subway' },
      ],
      rows: [row('a', 'Chili (more cumin)', 't2')],
      seen,
      pending,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['a', 'new']);
    expect(plan.next![0]!.title).toBe('Chili (more cumin)');
    expect(plan.droppedIds).toEqual([]);
  });

  it('does not revive a row whose delete is still pending on this device', () => {
    // Delete made offline (or the DELETE request failed). The cloud still has
    // the row, so a naive merge brings it straight back and the user deletes
    // it again — "shallot keeps popping up despite many deletes".
    const { seen, pending, pendingDeletes } = ctx([['a', 't1']], [], ['shallot']);

    const plan = merge({
      local: [{ id: 'a', title: 'Chili' }],
      rows: [row('a', 'Chili', 't1'), row('shallot', 'shallot', 't1')],
      seen,
      pending,
      pendingDeletes,
    });

    expect(plan.next).toBeNull();
    expect(plan.fetched).toEqual([]); // and we didn't even download its body
    expect(plan.changedIds).toEqual([]);
  });

  it('adopts the kitchen wholesale on a member’s first pull', () => {
    // Amanda joining Nate's household: she gets his kitchen, and the handful of
    // recipes she had in local-only mode do not get merged into his data —
    // even ones whose upload is pending, since they were meant for HER silo.
    const { seen, pending } = ctx([], ['hers']);

    const plan = merge({
      local: [{ id: 'hers', title: 'Her local recipe' }],
      rows: [row('his', 'Chili', 't1')],
      seen,
      pending,
      adoptOnly: true,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['his']);
    expect(plan.droppedIds).toEqual(['hers']);
  });

  it('does not adopt-drop on a later resync, only the first pull', () => {
    // Same shape as above but adoptOnly off (a routine resync): a pending
    // local row is an upload in flight, not someone else's leftovers.
    const { seen, pending } = ctx([], ['pending']);

    const plan = merge({
      local: [{ id: 'pending', title: 'Just added' }],
      rows: [row('his', 'Chili', 't1')],
      seen,
      pending,
    });

    expect(plan.next!.map((x) => x.id).sort()).toEqual(['his', 'pending']);
    expect(plan.droppedIds).toEqual([]);
  });

  it('populates an empty device from the cloud', () => {
    const { seen, pending } = ctx();

    const plan = merge({
      local: [],
      rows: [row('a', 'Chili', 't1'), row('b', 'Soup', 't1')],
      seen,
      pending,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['a', 'b']);
    expect(plan.changedIds).toEqual(['a', 'b']);
  });

  it('is idempotent — a second identical pull changes nothing', () => {
    const { seen, pending } = ctx();
    const rows = [row('a', 'Chili', 't1'), row('b', 'Soup', 't1')];

    const first = merge({ local: [], rows, seen, pending });
    const second = merge({ local: first.next!, rows, seen, pending });

    expect(second.next).toBeNull();
    // …and the second pull downloaded no bodies at all. This is the property
    // that makes a once-a-minute poll cheap enough to ship: a library of
    // photo-carrying recipes costs one small stamp query to confirm it's
    // current, not a re-download.
    expect(second.fetched).toEqual([]);
    expect(first.fetched).toEqual(['a', 'b']);
  });

  it('only asks for the body of the row that changed', () => {
    const { seen, pending } = ctx([
      ['a', 't1'],
      ['b', 't1'],
    ]);

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'b', title: 'Soup' },
      ],
      rows: [row('a', 'Chili', 't1'), row('b', 'Soup v2', 't2')],
      seen,
      pending,
    });

    expect(plan.fetched).toEqual(['b']);
    expect(plan.changedIds).toEqual(['b']);
  });

  it('leaves a row alone when its body fetch missed it, and retries next pass', () => {
    // The two-phase read is not atomic: a row can be rewritten between the
    // stamp query and the body query. Better to keep the stale copy for one
    // more pass than to write `undefined` into the store.
    const { seen, pending } = ctx([['a', 't1']]);
    const rows = [row('a', 'Chili (more cumin)', 't2')];
    const local = [{ id: 'a', title: 'Chili' }];

    const missed = merge({ local, rows, seen, pending, withhold: ['a'] });
    expect(missed.next).toBeNull();
    expect(seen.get('a')).toBe('t1'); // stamp NOT advanced — so we try again

    const retry = merge({ local, rows, seen, pending });
    expect(retry.next![0]!.title).toBe('Chili (more cumin)');
    expect(seen.get('a')).toBe('t2');
  });

  it('a cloud-only row whose body was missed is not treated as dropped', () => {
    // Withheld body for a row we don't have locally: nothing to keep, nothing
    // to drop, and the stamp stays unrecorded so the next pass fetches it.
    const { seen, pending } = ctx([['a', 't1']]);

    const plan = merge({
      local: [{ id: 'a', title: 'Chili' }],
      rows: [row('a', 'Chili', 't1'), row('z', 'New elsewhere', 't2')],
      seen,
      pending,
      withhold: ['z'],
    });

    expect(plan.next).toBeNull();
    expect(plan.droppedIds).toEqual([]);
    expect(seen.has('z')).toBe(false);
  });
});
