-- Stock — sync tables for "already have" counts/pins + shopping Extras.
-- Same shape + policy template as 20260519000000_user_sync_init.sql.

begin;

do $body$
declare t text;
begin
  foreach t in array array['have_records','extras']
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

    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $body$;

commit;
