/**
 * Household sharing — two people, one kitchen.
 *
 * An owner grants a member access by email (see
 * supabase/migrations/20260722000000_household_sharing.sql). Membership is
 * keyed by email rather than uid so the owner can add someone who has never
 * signed in, and so that person is already in the household the first time
 * they do.
 *
 * The single idea on the client: an EFFECTIVE OWNER ID. Every kitchen row
 * (recipes, plan, pantry, cooks, cook plans, have-records, shopping extras) is
 * read, written, and Realtime-subscribed under that id instead of the signed-in
 * uid, so both accounts converge on one set of rows. RLS allows exactly this
 * and no more — you can only borrow the id of a kitchen you're a member of.
 *
 * Deliberately NOT shared: calorie pushes (`tide_intake_logs`) stay on the
 * signed-in account, because a cook feeds one person's day, not both.
 */
import { supabase } from './supabase';

export type HouseholdMember = {
  ownerId: string;
  email: string;
  label: string | null;
  createdAt: Date;
};

/**
 * The uid whose kitchen this session should read and write.
 *
 * Returns the owner's uid when the signed-in email has been added to someone's
 * household, otherwise the user's own uid (they own their kitchen).
 *
 * Failure is deliberately non-fatal and biased toward the private case: if the
 * lookup errors (offline, table missing on an older project) we fall back to
 * the user's own uid. That means "not shared yet", never "wrote over someone
 * else's kitchen" — the safe direction to fail in.
 */
export async function resolveOwnerId(
  userId: string,
  email: string | null | undefined,
): Promise<string> {
  if (!supabase || !email) return userId;

  const { data, error } = await supabase
    .from('household_members')
    .select('owner_id, created_at')
    .ilike('member_email', email.trim())
    // Deterministic if someone is ever in two households: oldest invite wins.
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.warn('[stock/household] owner lookup failed', error.message);
    return userId;
  }

  const ownerId = data?.[0]?.owner_id as string | undefined;
  // An owner who somehow appears in their own household is still just an owner.
  return ownerId && ownerId !== userId ? ownerId : userId;
}

/** Everyone the signed-in user has shared THEIR kitchen with. */
export async function listMembers(ownerId: string): Promise<HouseholdMember[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('household_members')
    .select('owner_id, member_email, label, created_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[stock/household] list failed', error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    ownerId: r.owner_id as string,
    email: r.member_email as string,
    label: (r.label as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
  }));
}

/** Share this kitchen with `email`. Idempotent on (owner, lower(email)). */
export async function addMember(
  ownerId: string,
  email: string,
  label?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' };
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'That email doesn’t look right.' };
  }
  const { error } = await supabase
    .from('household_members')
    .upsert(
      { owner_id: ownerId, member_email: trimmed, label: label?.trim() || null },
      { onConflict: 'owner_id,member_email' },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Stop sharing. Their own kitchen is untouched; they just lose this one. */
export async function removeMember(
  ownerId: string,
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Sync isn’t configured.' };
  const { error } = await supabase
    .from('household_members')
    .delete()
    .eq('owner_id', ownerId)
    .ilike('member_email', email.trim());
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
