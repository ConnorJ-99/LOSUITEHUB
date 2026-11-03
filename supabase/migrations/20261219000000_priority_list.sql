-- LOSuite: the priority list on the Today page.
--
-- A priority item is an ordinary task with an action (Lock, Call, Get
-- documents, Price estimates, Other). Tasks with no action (contract
-- deadlines, key dates, hand-made tasks) stay in "Your day" as before.
--   action         what to do on the file; null = a regular task
--   starred        "this one first" (the file's own star is loans.priority)
--   sort_order     the order Connor set with the up/down buttons
--   snoozed_until  hidden from the list until this day; the due date stays put
-- The note is the task's title. Row Level Security is the tasks table's own.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite priority list installed").

alter table public.tasks
  add column if not exists action text check (action is null or action in ('lock', 'call', 'documents', 'price', 'other'));

alter table public.tasks add column if not exists starred boolean not null default false;

alter table public.tasks add column if not exists sort_order integer;

alter table public.tasks add column if not exists snoozed_until date;

-- The list reads one person's open priority items.
create index if not exists tasks_open_priority_idx on public.tasks (assigned_to) where completed_at is null and action is not null;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite priority list installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tasks'
     and column_name in ('action', 'starred', 'sort_order', 'snoozed_until')) as new_columns,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'tasks_open_priority_idx') as list_index;
