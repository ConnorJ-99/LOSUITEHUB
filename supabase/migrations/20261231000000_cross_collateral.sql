-- MPS HQ: cross-collateralized DSCR loans (Connor, 2026-11-09).
--
-- A cross-collateral (blanket) loan is secured by several homes, so the full
-- value of all of them counts. Two switches, nothing else:
--   loans.cross_collateral      the loan is cross-collateralized
--   properties.is_collateral    this home secures the loan too (the subject
--                               property always counts; this marks the others)
-- The combined value, existing mortgages and rent are worked out in code
-- (src/lib/calc/collateral.ts), never stored. is_collateral is ignored while
-- the loan's cross_collateral is off.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ cross-collateral installed").

alter table public.loans
  add column if not exists cross_collateral boolean not null default false;

alter table public.properties
  add column if not exists is_collateral boolean not null default false;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ cross-collateral installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name = 'cross_collateral') as loan_column,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'properties' and column_name = 'is_collateral') as property_column;
