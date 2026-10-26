-- LOSuite: contract intake, part 3c (contract deadlines become tasks).
--
-- tasks.source_key remembers which contract deadline a task was made from
-- (e.g. "contract:option_end"), so when a contract date changes the task's
-- due date is updated instead of a second task being created. Tasks Connor
-- adds by hand have no source_key.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite contract tasks installed").

alter table public.tasks
  add column if not exists source_key text check (source_key is null or length(trim(source_key)) > 0);

-- One task per deadline per file. (Hand-made tasks have no key, so any number of them is fine.)
do $$ begin
  alter table public.tasks add constraint tasks_one_per_source unique (loan_id, source_key);
exception when duplicate_object or duplicate_table then null;
end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite contract tasks installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'source_key') as source_column,
  (select count(*) from pg_constraint where conname = 'tasks_one_per_source') as one_per_deadline;
