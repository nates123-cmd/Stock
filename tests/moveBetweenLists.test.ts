import { describe, it, expect } from 'vitest';
import { activeExtras, type ExtraRef } from '../src/lib/activeList';
import { MANUAL_ACTIVE, MANUAL_STAPLE, PLAN_WIZARD } from '../src/lib/shopping';

/**
 * "Move to Staples" / "Move to Active" in the shopping list's long-press menu.
 *
 * The move is an ORIGIN CHANGE on the extra, not a delete-and-re-add, so the
 * row keeps its qty / store / note. These lock the routing contract the move
 * depends on: which list an origin lands a row on, and the fact that a pin
 * cannot drag a manual Active row back to Staples behind the user's back.
 */

const extra = (id: string, name: string, originId: string | null): ExtraRef => ({
  id,
  canonicalName: name,
  originId,
});

/** The real `manualHome` rule from shopping.tsx, with an injectable pin set. */
const manualHomeWith =
  (pinned: Set<string>) =>
  (ex: ExtraRef): 'active' | 'staples' | null => {
    if (ex.originId === MANUAL_STAPLE) return 'staples';
    if (ex.originId === MANUAL_ACTIVE) return 'active';
    if (ex.originId == null)
      return pinned.has(ex.canonicalName.toLowerCase()) ? 'staples' : 'active';
    return null;
  };

const ctx = (opts: {
  pinned?: Set<string>;
  checked?: Record<string, true>;
  inHave?: (n: string) => boolean;
} = {}) => ({
  pushed: [],
  pendingKeys: new Set<string>(),
  checked: opts.checked ?? {},
  manualHome: manualHomeWith(opts.pinned ?? new Set()),
  inHave: opts.inHave ?? (() => false),
});

describe('moving a row between Active and Staples', () => {
  it('moving to Staples takes the row off Active', () => {
    const rows = [extra('e1', 'pine nuts', MANUAL_STAPLE)];
    expect(activeExtras(rows, ctx())).toEqual([]);
  });

  it('moving to Active puts it back on Active', () => {
    const rows = [extra('e1', 'pine nuts', MANUAL_ACTIVE)];
    expect(activeExtras(rows, ctx()).map((r) => r.id)).toEqual(['e1']);
  });

  it('a moved-to-Active row survives an always-have pin', () => {
    // This is the whole reason the move does NOT un-pin: "I keep olive oil AND
    // I need to buy it this week" has to be expressible. A pin must not be able
    // to hide a row the user deliberately moved onto Active.
    const rows = [extra('e1', 'olive oil', MANUAL_ACTIVE)];
    const pinned = new Set(['olive oil']);
    const got = activeExtras(rows, ctx({ pinned, inHave: () => true }));
    expect(got.map((r) => r.id)).toEqual(['e1']);
  });

  it('a legacy null-origin row still follows the old pin rule', () => {
    const rows = [extra('e1', 'olive oil', null)];
    expect(activeExtras(rows, ctx({ pinned: new Set(['olive oil']) }))).toEqual([]);
    expect(activeExtras(rows, ctx({ pinned: new Set() })).map((r) => r.id)).toEqual(['e1']);
  });

  it('moving a plan-wizard row to Staples re-origins it off Active', () => {
    // A wizard row is force-kept on Active and is barred from Staples by its
    // origin, so the move only works because it rewrites the origin.
    const before = [extra('e1', 'shallots', PLAN_WIZARD)];
    expect(activeExtras(before, ctx()).map((r) => r.id)).toEqual(['e1']);
    const after = [extra('e1', 'shallots', MANUAL_STAPLE)];
    expect(activeExtras(after, ctx())).toEqual([]);
  });

  it('a permanent check-off still hides a moved row, which is why the move clears it', () => {
    // have.ts `checked` never expires. The move clears it for the same reason a
    // fresh add does — otherwise moving something you once bought does nothing
    // visible.
    const rows = [extra('e1', 'pine nuts', MANUAL_ACTIVE)];
    const checked = { 'pine nuts': true as const };
    expect(activeExtras(rows, ctx({ checked }))).toEqual([]);
    expect(activeExtras(rows, ctx()).map((r) => r.id)).toEqual(['e1']);
  });

  it('moves every member of a merged row, not just the visible one', () => {
    // The menu moves each member id; if one were left behind it would pop back
    // out as its own line the moment the merge was recomputed.
    const moved = [
      extra('e1', 'cherry tomatoes', MANUAL_STAPLE),
      extra('e2', 'grape tomatoes', MANUAL_STAPLE),
    ];
    expect(activeExtras(moved, ctx())).toEqual([]);
    const halfMoved = [
      extra('e1', 'cherry tomatoes', MANUAL_STAPLE),
      extra('e2', 'grape tomatoes', MANUAL_ACTIVE),
    ];
    expect(activeExtras(halfMoved, ctx()).map((r) => r.id)).toEqual(['e2']);
  });
});
