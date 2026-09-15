-- Realtime DELETE events carry only the row's primary key unless the table has
-- REPLICA IDENTITY FULL. The client subscribes with `filter: user_id=eq.<owner>`,
-- and a DELETE payload with no user_id can never match that filter — so no
-- device ever heard about a deletion live; only the minute-scale poll could
-- drop a row. Give the small kitchen tables a full identity so deletes stream.
--
-- recipes and cooks are left on the default identity on purpose: they carry
-- embedded photos, and FULL identity writes the whole old row to WAL on every
-- update. Their deletes still arrive through the poll.
alter table public.extras         replica identity full;
alter table public.pushed         replica identity full;
alter table public.have_records   replica identity full;
alter table public.pantry_items   replica identity full;
alter table public.plan_entries   replica identity full;
alter table public.pipeline_ideas replica identity full;
alter table public.cook_plans     replica identity full;
