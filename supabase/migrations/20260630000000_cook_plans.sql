-- Stock — Cook Plans sync table (per-user, RLS). Additive; mirrors the
-- generic (id, user_id, data jsonb, updated_at) shape used by the other
-- pillar tables. Safe to run on an already-initialized project.

begin;

create table if not exists public.cook_plans (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists cook_plans_user_updated_idx
  on public.cook_plans (user_id, updated_at desc);

alter table public.cook_plans enable row level security;

drop policy if exists "cook_plans_select" on public.cook_plans;
create policy "cook_plans_select" on public.cook_plans
  for select using (auth.uid() = user_id);
drop policy if exists "cook_plans_insert" on public.cook_plans;
create policy "cook_plans_insert" on public.cook_plans
  for insert with check (auth.uid() = user_id);
drop policy if exists "cook_plans_update" on public.cook_plans;
create policy "cook_plans_update" on public.cook_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "cook_plans_delete" on public.cook_plans;
create policy "cook_plans_delete" on public.cook_plans
  for delete using (auth.uid() = user_id);

drop trigger if exists cook_plans_updated_at on public.cook_plans;
create trigger cook_plans_updated_at before update on public.cook_plans
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.cook_plans to authenticated;

do $$
begin
  execute 'alter publication supabase_realtime add table public.cook_plans';
exception when duplicate_object then null;
end $$;

commit;
