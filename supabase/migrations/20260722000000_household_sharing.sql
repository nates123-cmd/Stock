-- Stock — household sharing.
--
-- Until now every kitchen table was a private silo: RLS was
-- `auth.uid() = user_id`, and the client pulled/pushed/subscribed with its own
-- uid. That is right for calories (per-person) and wrong for a kitchen two
-- people share — one pantry, one shopping list, one recipe box.
--
-- Model: an OWNER grants a MEMBER access to the owner's kitchen. Membership is
-- keyed by the member's EMAIL, not their uid, deliberately:
--   * the owner can add someone who has never signed in (no auth.users row to
--     reference yet, so no FK ordering problem), and
--   * the member is in the household the instant they first sign in, so they
--     never get a window where they write rows into a private silo that then
--     have to be re-stamped.
--
-- The client resolves an "effective owner id" at sign-in and uses it for every
-- read, write, and Realtime filter, so household rows all converge on the
-- owner's uid. These policies are the server-side half: they widen every
-- kitchen table from "my uid" to "any uid whose kitchen I'm a member of".
--
-- NOT widened, on purpose:
--   * tide_intake_logs (Tide's table) — calories are per-person. A member's
--     cooks log against their own Tide/Trim account, not the owner's.
--   * instacart_jobs — a push is a job the pusher owns and polls.
--   * meal_log — dead table, superseded by tide_intake_logs (patch #0cdbce11).

begin;

/* ---------- Membership ---------- */

create table if not exists public.household_members (
  owner_id     uuid not null references auth.users(id) on delete cascade,
  member_email text not null,
  label        text,
  created_at   timestamptz not null default now(),
  primary key (owner_id, member_email)
);

-- Case-insensitive match against the JWT email claim.
create unique index if not exists household_members_owner_lower_email_idx
  on public.household_members (owner_id, lower(member_email));

create index if not exists household_members_lower_email_idx
  on public.household_members (lower(member_email));

alter table public.household_members enable row level security;

-- The owner manages their own household. A member may read the row that grants
-- them access (the client needs it to resolve the effective owner) but cannot
-- write it — you cannot add yourself to someone else's kitchen.
drop policy if exists "household_members_select" on public.household_members;
create policy "household_members_select" on public.household_members
  for select using (
    auth.uid() = owner_id
    or lower(member_email) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "household_members_insert" on public.household_members;
create policy "household_members_insert" on public.household_members
  for insert with check (auth.uid() = owner_id);

drop policy if exists "household_members_update" on public.household_members;
create policy "household_members_update" on public.household_members
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "household_members_delete" on public.household_members;
create policy "household_members_delete" on public.household_members
  for delete using (auth.uid() = owner_id);

grant select, insert, update, delete on public.household_members to authenticated;

/* ---------- Which kitchens may I touch? ---------- */

-- SECURITY DEFINER so a kitchen-table policy can consult household_members
-- without needing household_members' own RLS to be permissive (and without the
-- recursive-policy trap). STABLE so the planner hoists it into an InitPlan and
-- evaluates it once per statement rather than once per row.
create or replace function public.stock_owner_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid()
  union
  select hm.owner_id
    from public.household_members hm
   where lower(hm.member_email) = lower(auth.jwt() ->> 'email')
$$;

-- Only signed-in users need this: it is called from the kitchen tables' RLS
-- policies, which evaluate as the querying role. anon never has a kitchen, so
-- leave it no reason to reach a SECURITY DEFINER function. (Supabase's default
-- grants hand anon EXECUTE on new public functions, so revoking from PUBLIC
-- alone is not enough — name anon explicitly.)
revoke all on function public.stock_owner_ids() from public;
revoke execute on function public.stock_owner_ids() from anon;
grant execute on function public.stock_owner_ids() to authenticated;

/* ---------- Widen the kitchen tables ---------- */

do $body$
declare t text;
begin
  foreach t in array array[
    'recipes','plan_entries','pantry_items','pipeline_ideas',
    'cooks','cook_plans','have_records','extras'
  ]
  loop
    -- Skip tables that don't exist in this project rather than aborting the
    -- whole migration (Stock's tables arrived across several migrations).
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'household_sharing: skipping missing table %', t;
      continue;
    end if;

    execute format($f$
      drop policy if exists "%s_select" on public.%I;
      create policy "%s_select" on public.%I for select
        using (user_id in (select public.stock_owner_ids()));

      drop policy if exists "%s_insert" on public.%I;
      create policy "%s_insert" on public.%I for insert
        with check (user_id in (select public.stock_owner_ids()));

      drop policy if exists "%s_update" on public.%I;
      create policy "%s_update" on public.%I for update
        using (user_id in (select public.stock_owner_ids()))
        with check (user_id in (select public.stock_owner_ids()));

      drop policy if exists "%s_delete" on public.%I;
      create policy "%s_delete" on public.%I for delete
        using (user_id in (select public.stock_owner_ids()));
    $f$,
      t, t,  t, t,
      t, t,  t, t,
      t, t,  t, t,
      t, t,  t, t
    );
  end loop;
end $body$;

commit;
