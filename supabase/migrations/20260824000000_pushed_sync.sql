-- Stock — sync table for the "pushed" markers.
--
-- WHY THIS EXISTS (the "shopping list doesn't clear after a grocery push" bug):
--
-- A pushed marker is the ONLY thing that takes a row off the active shopping
-- list after you push it to Wegmans / Reminders / Amazon / Costco / Walmart —
-- see lib/activeList.ts, which drops an extra when `isExtraPushed` says a
-- marker owns it. The extras themselves were always synced; the markers were
-- not. They lived in per-browser IndexedDB only.
--
-- So: push on the phone, markers written locally, rows leave the list there.
-- The laptop pulls the same `extras` rows from the cloud, has zero markers,
-- and shows every one of them still on the list. Same account, same list,
-- different answer per device — which is exactly the reported shape, and why
-- the previous rounds of shopping-list fixes (all client-side row logic) could
-- never resolve it.
--
-- Shape and policy template match the other kitchen tables. Policies are the
-- WIDE (household) form from 20260722000000_household_sharing.sql, not the
-- narrow `auth.uid() = user_id` one, because the shopping list is shared: if
-- Nate pushes the list, it must clear for Amanda too.

begin;

create table if not exists public.pushed (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists pushed_user_updated_idx
  on public.pushed (user_id, updated_at desc);

alter table public.pushed enable row level security;

drop policy if exists "pushed_select" on public.pushed;
create policy "pushed_select" on public.pushed for select
  using (user_id in (select public.stock_owner_ids()));

drop policy if exists "pushed_insert" on public.pushed;
create policy "pushed_insert" on public.pushed for insert
  with check (user_id in (select public.stock_owner_ids()));

drop policy if exists "pushed_update" on public.pushed;
create policy "pushed_update" on public.pushed for update
  using (user_id in (select public.stock_owner_ids()))
  with check (user_id in (select public.stock_owner_ids()));

drop policy if exists "pushed_delete" on public.pushed;
create policy "pushed_delete" on public.pushed for delete
  using (user_id in (select public.stock_owner_ids()));

drop trigger if exists pushed_updated_at on public.pushed;
create trigger pushed_updated_at before update on public.pushed
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.pushed to authenticated;

-- Realtime, so a push on one device clears the list on the other WITHOUT a
-- reload. Without this the fix would only take effect at the next cold start.
do $body$
begin
  alter publication supabase_realtime add table public.pushed;
exception when duplicate_object then null;
end $body$;

commit;
