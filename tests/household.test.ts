import { describe, it, expect, vi, beforeEach } from 'vitest';

// resolveOwnerId decides WHICH KITCHEN a session reads and writes. Get it
// wrong and a member either sees nothing (resolved to their own empty silo) or,
// far worse, writes land somewhere unexpected. The rule under test: return the
// owner's uid only on a clean hit, and fall back to the user's own uid on every
// failure — never guess.

type Row = { owner_id: string; created_at: string };

const state = {
  available: true,
  rows: [] as Row[],
  error: null as { message: string } | null,
  /** what the query actually filtered on, so we can assert the email match */
  lastIlike: null as { col: string; val: string } | null,
};

function makeClient() {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          const q: any = {
            ilike(col: string, val: string) {
              state.lastIlike = { col, val };
              return q;
            },
            eq() {
              return q;
            },
            order() {
              return q;
            },
            limit() {
              return Promise.resolve({
                data: state.error ? null : state.rows,
                error: state.error,
              });
            },
            then(res: any) {
              return Promise.resolve({
                data: state.error ? null : state.rows,
                error: state.error,
              }).then(res);
            },
          };
          return q;
        },
      };
    },
  };
}

vi.mock('@/lib/supabase', () => ({
  get SUPABASE_AVAILABLE() {
    return state.available;
  },
  get supabase() {
    return state.available ? makeClient() : null;
  },
}));

import { resolveOwnerId, addMember } from '@/lib/household';

const ME = 'uid-me';
const OWNER = 'uid-owner';

beforeEach(() => {
  state.available = true;
  state.rows = [];
  state.error = null;
  state.lastIlike = null;
});

describe('resolveOwnerId', () => {
  it('returns own uid when not a member of any household', async () => {
    expect(await resolveOwnerId(ME, 'me@example.com')).toBe(ME);
  });

  it("returns the owner's uid when this email was added to their household", async () => {
    state.rows = [{ owner_id: OWNER, created_at: '2026-07-22T00:00:00Z' }];
    expect(await resolveOwnerId(ME, 'me@example.com')).toBe(OWNER);
  });

  it('matches the email case-insensitively, untrimmed input included', async () => {
    state.rows = [{ owner_id: OWNER, created_at: '2026-07-22T00:00:00Z' }];
    await resolveOwnerId(ME, '  Me@Example.COM ');
    // ilike is the case-insensitive operator; the value is trimmed for it.
    expect(state.lastIlike?.col).toBe('member_email');
    expect(state.lastIlike?.val).toBe('Me@Example.COM');
  });

  it('falls back to own uid when the lookup errors — never a guessed kitchen', async () => {
    state.error = { message: 'network down' };
    expect(await resolveOwnerId(ME, 'me@example.com')).toBe(ME);
  });

  it('falls back to own uid with no email on the session', async () => {
    state.rows = [{ owner_id: OWNER, created_at: '2026-07-22T00:00:00Z' }];
    expect(await resolveOwnerId(ME, null)).toBe(ME);
  });

  it('falls back to own uid when sync is not configured', async () => {
    state.available = false;
    expect(await resolveOwnerId(ME, 'me@example.com')).toBe(ME);
  });

  it('ignores a self-referential row rather than reporting a shared kitchen', async () => {
    state.rows = [{ owner_id: ME, created_at: '2026-07-22T00:00:00Z' }];
    expect(await resolveOwnerId(ME, 'me@example.com')).toBe(ME);
  });
});

describe('addMember', () => {
  it('rejects a malformed email before touching the database', async () => {
    const res = await addMember(ME, 'not-an-email');
    expect(res.ok).toBe(false);
  });
});
