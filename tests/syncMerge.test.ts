/**
 * Cloud-sync reconciliation (src/lib/syncMerge.ts).
 *
 * These are the rules that decide whether a recipe survives a pull, so they are
 * worth pinning: the bug this module was written for was "recipes I add on one
 * device never show up on the others", and the way a naive fix goes wrong is
 * the opposite failure — a resync that deletes rows whose upload hadn't landed.
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

function ctx(seedSeen: [string, string][] = [], seedConfirmed: string[] = []) {
  return {
    seen: new Map<string, string>(seedSeen),
    confirmed: new Set<string>(seedConfirmed),
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
  confirmed: Set<string>;
  adoptOnly?: boolean;
  /** Ids to withhold, simulating a body fetch that missed a row. */
  withhold?: string[];
}) {
  const stamps = opts.rows.map((r) => ({ id: r.id, updated_at: r.updated_at }));
  const wanted = idsNeedingFetch(opts.local, stamps, opts.seen);
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
    confirmed: opts.confirmed,
    revive,
    adoptOnly: opts.adoptOnly,
  });
  return { ...plan, fetched: wanted };
}

describe('planMerge', () => {
  it('does nothing when every cloud row is unchanged', () => {
    const local: Row[] = [{ id: 'a', title: 'Chili' }];
    const { seen, confirmed } = ctx([['a', 't1']], ['a']);

    const plan = merge({
      local,
      rows: [row('a', 'Chili', 't1')],
      seen,
      confirmed,
    });

    expect(plan.next).toBeNull();
    expect(plan.changedIds).toEqual([]);
    expect(plan.droppedIds).toEqual([]);
  });

  it('keeps the identical object reference for unchanged rows', () => {
    // Ref identity is load-bearing: the local→cloud subscriber diffs on it, so
    // a new ref for an unchanged row would push it straight back to the cloud.
    const keep: Row = { id: 'a', title: 'Chili' };
    const { seen, confirmed } = ctx([['a', 't1']], ['a']);

    const plan = merge({
      local: [keep, { id: 'b', title: 'Soup' }],
      rows: [row('a', 'Chili', 't1'), row('b', 'Soup v2', 't9')],
      seen,
      confirmed,
    });

    expect(plan.next).not.toBeNull();
    expect(plan.next!.find((x) => x.id === 'a')).toBe(keep);
    expect(plan.changedIds).toEqual(['b']);
  });

  it('brings down a recipe added on another device', () => {
    const { seen, confirmed } = ctx([['a', 't1']], ['a']);

    const plan = merge({
      local: [{ id: 'a', title: 'Chili' }],
      rows: [row('a', 'Chili', 't1'), row('z', 'Amanda’s Pasta', 't2')],
      seen,
      confirmed,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['z', 'a']);
    expect(plan.changedIds).toEqual(['z']);
    expect(confirmed.has('z')).toBe(true);
  });

  it('takes the cloud version when a row was edited elsewhere', () => {
    const { seen, confirmed } = ctx([['a', 't1']], ['a']);

    const plan = merge({
      local: [{ id: 'a', title: 'Chili' }],
      rows: [row('a', 'Chili (more cumin)', 't2')],
      seen,
      confirmed,
    });

    expect(plan.next![0]!.title).toBe('Chili (more cumin)');
    expect(seen.get('a')).toBe('t2');
  });

  it('drops a row another device deleted', () => {
    const { seen, confirmed } = ctx(
      [
        ['a', 't1'],
        ['b', 't1'],
      ],
      ['a', 'b'],
    );

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'b', title: 'Soup' },
      ],
      rows: [row('a', 'Chili', 't1')],
      seen,
      confirmed,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['a']);
    expect(plan.droppedIds).toEqual(['b']);
    expect(confirmed.has('b')).toBe(false);
  });

  it('KEEPS a local row the cloud has never confirmed', () => {
    // The offline case: the recipe was just written, its upsert hasn't landed
    // (or failed), so it is legitimately absent from the cloud. Dropping it
    // here would delete work the user can still see on screen.
    const { seen, confirmed } = ctx([['a', 't1']], ['a']);

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'new', title: 'Written on the subway' },
      ],
      rows: [row('a', 'Chili', 't1')],
      seen,
      confirmed,
    });

    // next === null means "leave the store as it is", and the store already
    // holds both rows — the pending one is untouched, which is the point.
    expect(plan.next).toBeNull();
    expect(plan.droppedIds).toEqual([]);
  });

  it('keeps a pending local row while ALSO applying a cloud change', () => {
    // The combination that matters: Amanda edits a recipe upstream at the same
    // moment this device has an unsent one. Both must survive.
    const { seen, confirmed } = ctx([['a', 't1']], ['a']);

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'new', title: 'Written on the subway' },
      ],
      rows: [row('a', 'Chili (more cumin)', 't2')],
      seen,
      confirmed,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['a', 'new']);
    expect(plan.next![0]!.title).toBe('Chili (more cumin)');
    expect(plan.droppedIds).toEqual([]);
  });

  it('adopts the kitchen wholesale on a member’s first pull', () => {
    // Amanda joining Nate's household: she gets his kitchen, and the handful of
    // recipes she had in local-only mode do not get merged into his data.
    const { seen, confirmed } = ctx();

    const plan = merge({
      local: [{ id: 'hers', title: 'Her local recipe' }],
      rows: [row('his', 'Chili', 't1')],
      seen,
      confirmed,
      adoptOnly: true,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['his']);
    expect(plan.droppedIds).toEqual(['hers']);
  });

  it('does not adopt-drop on a later resync, only the first pull', () => {
    // Same shape as above but adoptOnly off (a routine resync): an unconfirmed
    // local row is a pending upload, not someone else's leftovers.
    const { seen, confirmed } = ctx();

    const plan = merge({
      local: [{ id: 'pending', title: 'Just added' }],
      rows: [row('his', 'Chili', 't1')],
      seen,
      confirmed,
    });

    expect(plan.next!.map((x) => x.id).sort()).toEqual(['his', 'pending']);
    expect(plan.droppedIds).toEqual([]);
  });

  it('populates an empty device from the cloud', () => {
    const { seen, confirmed } = ctx();

    const plan = merge({
      local: [],
      rows: [row('a', 'Chili', 't1'), row('b', 'Soup', 't1')],
      seen,
      confirmed,
    });

    expect(plan.next!.map((x) => x.id)).toEqual(['a', 'b']);
    expect(plan.changedIds).toEqual(['a', 'b']);
  });

  it('is idempotent — a second identical pull changes nothing', () => {
    const { seen, confirmed } = ctx();
    const rows = [row('a', 'Chili', 't1'), row('b', 'Soup', 't1')];

    const first = merge({ local: [], rows, seen, confirmed });
    const second = merge({ local: first.next!, rows, seen, confirmed });

    expect(second.next).toBeNull();
    // …and the second pull downloaded no bodies at all. This is the property
    // that makes a once-a-minute poll cheap enough to ship: a library of
    // photo-carrying recipes costs one small stamp query to confirm it's
    // current, not a re-download.
    expect(second.fetched).toEqual([]);
    expect(first.fetched).toEqual(['a', 'b']);
  });

  it('only asks for the body of the row that changed', () => {
    const { seen, confirmed } = ctx(
      [
        ['a', 't1'],
        ['b', 't1'],
      ],
      ['a', 'b'],
    );

    const plan = merge({
      local: [
        { id: 'a', title: 'Chili' },
        { id: 'b', title: 'Soup' },
      ],
      rows: [row('a', 'Chili', 't1'), row('b', 'Soup v2', 't2')],
      seen,
      confirmed,
    });

    expect(plan.fetched).toEqual(['b']);
    expect(plan.changedIds).toEqual(['b']);
  });

  it('leaves a row alone when its body fetch missed it, and retries next pass', () => {
    // The two-phase read is not atomic: a row can be rewritten between the
    // stamp query and the body query. Better to keep the stale copy for one
    // more pass than to write `undefined` into the store.
    const { seen, confirmed } = ctx([['a', 't1']], ['a']);
    const rows = [row('a', 'Chili (more cumin)', 't2')];
    const local = [{ id: 'a', title: 'Chili' }];

    const missed = merge({ local, rows, seen, confirmed, withhold: ['a'] });
    expect(missed.next).toBeNull();
    expect(seen.get('a')).toBe('t1'); // stamp NOT advanced — so we try again

    const retry = merge({ local, rows, seen, confirmed });
    expect(retry.next![0]!.title).toBe('Chili (more cumin)');
    expect(seen.get('a')).toBe('t2');
  });
});
