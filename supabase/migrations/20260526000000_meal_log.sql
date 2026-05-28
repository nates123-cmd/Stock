-- Stock → Tide cross-app integration (spec §7 / §11). Stock writes a row
-- per Cook with calorie/macro totals; Tide reads the user's rows for its
-- daily nutrition surface. Tide owns extending the schema if it needs more
-- columns — this is the minimum Stock asks for.
--
-- Idempotency: (source_app, source_id) is unique so re-saving a cook
-- becomes an upsert, not a duplicate insert.

begin;

create table if not exists public.meal_log (
  id                text primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  source_app        text not null,
  source_id         text not null,
  name              text not null,
  eaten_at          timestamptz not null,
  calories          numeric,
  protein           numeric,
  carbs             numeric,
  fat               numeric,
  nutrition_source  text,
  servings          numeric,
  updated_at        timestamptz not null default now(),
  unique (user_id, source_app, source_id)
);

create index if not exists meal_log_user_eaten_idx
  on public.meal_log (user_id, eaten_at desc);

alter table public.meal_log enable row level security;

drop policy if exists "meal_log_select" on public.meal_log;
create policy "meal_log_select" on public.meal_log
  for select using (auth.uid() = user_id);
drop policy if exists "meal_log_insert" on public.meal_log;
create policy "meal_log_insert" on public.meal_log
  for insert with check (auth.uid() = user_id);
drop policy if exists "meal_log_update" on public.meal_log;
create policy "meal_log_update" on public.meal_log
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "meal_log_delete" on public.meal_log;
create policy "meal_log_delete" on public.meal_log
  for delete using (auth.uid() = user_id);

drop trigger if exists meal_log_updated_at on public.meal_log;
create trigger meal_log_updated_at before update on public.meal_log
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.meal_log to authenticated;

commit;
