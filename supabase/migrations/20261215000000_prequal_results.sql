-- LOSuite: prequal results (next build Session 3, decision 7).
--
-- document_kind gets 'prequal_results', so the one-page Prequal Results PDF
--   saves to Documents and can be emailed like the other borrower PDFs.
-- profiles gets personal_cell: the loan officer's own cell, typed in
--   Settings -> My profile. The follow-up text after prequal results are
--   emailed offers it ("you're welcome to reach me on my personal cell too").
--   Stored as typed; it must have 10 digits (an optional leading 1 is fine).
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite prequal results installed").

alter type public.document_kind add value if not exists 'prequal_results';

alter table public.profiles add column if not exists personal_cell text;

do $$ begin
  alter table public.profiles
    add constraint profiles_personal_cell_digits check (personal_cell is null or regexp_replace(personal_cell, '\D', '', 'g') ~ '^1?[0-9]{10}$');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite prequal results installed' as result,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel = 'prequal_results') as new_kind,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'personal_cell') as personal_cell_column,
  (select count(*) from pg_constraint where conname = 'profiles_personal_cell_digits') as cell_check;
