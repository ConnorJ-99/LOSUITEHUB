-- MPS HQ: more about each lender (Connor, 2026-11-17), for the lenders CSV.
--
-- Adds the lender's NMLS #, website, the broker ID MPS has with them, the
-- portal username (never a password) and which states or products the AE
-- covers. Everyone else at the lender (a second AE, the scenario desk,
-- closing, condition uploads) goes in the existing lender contacts list.
-- Lenders → Import lenders CSV fills both.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ lender details installed").

alter table public.lenders add column if not exists nmls text;
alter table public.lenders add column if not exists website text;
alter table public.lenders add column if not exists broker_id text;
alter table public.lenders add column if not exists portal_username text;
alter table public.lenders add column if not exists ae_covers text;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ lender details installed' as result,
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'lenders'
     and column_name in ('nmls', 'website', 'broker_id', 'portal_username', 'ae_covers')) as new_columns;
