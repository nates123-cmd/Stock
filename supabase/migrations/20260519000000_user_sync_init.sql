-- Stock — auth-gated, per-user sync tables.
-- Run once in the Supabase SQL editor (or via `supabase db push` if linked).
--
-- One row per app object. data jsonb mirrors the app's TypeScript type.
-- updated_at is row-level; the in-JSON createdAt/modifiedAt are the app's.
-- RLS scopes every read/write to auth.uid() = user_id.

begin;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $body$
declare t text;
begin
  foreach t in array array['recipes','plan_entries','pantry_items','pipeline_ideas','cooks','cook_plans']
  loop
    execute format($f$
      create table if not exists public.%I (
        id          text primary key,
        user_id     uuid not null references auth.users(id) on delete cascade,
        data        jsonb not null,
        updated_at  timestamptz not null default now()
      );
      create index if not exists %I on public.%I (user_id, updated_at desc);
      alter table public.%I enable row level security;

      drop policy if exists "%s_select" on public.%I;
      create policy "%s_select" on public.%I for select using (auth.uid() = user_id);
      drop policy if exists "%s_insert" on public.%I;
      create policy "%s_insert" on public.%I for insert with check (auth.uid() = user_id);
      drop policy if exists "%s_update" on public.%I;
      create policy "%s_update" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
      drop policy if exists "%s_delete" on public.%I;
      create policy "%s_delete" on public.%I for delete using (auth.uid() = user_id);

      drop trigger if exists %I on public.%I;
      create trigger %I before update on public.%I
        for each row execute function public.set_updated_at();

      grant select, insert, update, delete on public.%I to authenticated;
    $f$,
      t,
      t || '_user_updated_idx', t,
      t,
      t, t,  t, t,
      t, t,  t, t,
      t, t,  t, t,
      t, t,  t, t,
      t || '_updated_at', t,  t || '_updated_at', t,
      t
    );

    -- Realtime publication (idempotent; swallow duplicate).
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $body$;

commit;
