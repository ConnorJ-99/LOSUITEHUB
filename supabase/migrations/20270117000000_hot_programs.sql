-- MPS HQ: Hot programs (Connor, 2026-11-12).
--
-- programs.is_hot marks the programs Connor wants to look at first. Match
-- lenders (Scenarios & Estimate) shows only Hot programs by default, with
-- "Show all programs"; Build estimates lists them first. One flag per program
-- for the whole company, changed by whoever can edit the lender catalog
-- (owners and admins), like every other program field. It changes no
-- matching rule: a Hot program that doesn't fit still shows why.
-- Apply after the borrower portal script. Safe to run more than once. A full
-- run ends with a confirmation row ("MPS HQ hot programs installed").

alter table public.programs add column if not exists is_hot boolean not null default false;

create index if not exists programs_hot_idx on public.programs (organization_id) where is_hot;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ hot programs installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'is_hot') as hot_column,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'programs_hot_idx') as hot_index;
