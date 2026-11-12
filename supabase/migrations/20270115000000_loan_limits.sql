-- MPS HQ: county loan limits for the Max Approval calculator (Connor, 2026-11-12).
--
-- The Prequal tab's Max Approval stops at the county loan limit. The company
-- keeps its home county's one-unit limits here, typed in Settings → Company
-- by owners and admins: the conforming limit (conventional loans) and the
-- FHA limit. Blank = no loan-limit check. VA (full entitlement) and Non-QM
-- don't use them.
-- Apply after the loan hold script. Safe to run more than once. A full run
-- ends with a confirmation row ("MPS HQ loan limits installed").

alter table public.organizations
  add column if not exists conforming_loan_limit numeric(12, 2),
  add column if not exists fha_loan_limit        numeric(12, 2);

alter table public.organizations drop constraint if exists organizations_loan_limits_check;
alter table public.organizations add constraint organizations_loan_limits_check check (
  (conforming_loan_limit is null or (conforming_loan_limit > 0 and conforming_loan_limit < 10000000))
  and (fha_loan_limit is null or (fha_loan_limit > 0 and fha_loan_limit < 10000000))
);

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ loan limits installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name in ('conforming_loan_limit', 'fha_loan_limit')) as limit_columns,
  (select count(*) from pg_constraint where conname = 'organizations_loan_limits_check') as limit_check;
