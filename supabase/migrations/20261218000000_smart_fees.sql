-- LOSuite: Smart Fees (Scenarios & Estimate part 4, docs/plans/scenarios-estimate.md,
-- approved by Connor 2026-11-03).
--
-- The company fee list (fee_templates) gains "Applies when": states,
-- counties, a lender, a loan-amount range and occupancies, plus two amount
-- types: tiered (a bracket table in `tiers`) and formula (a named calculator
-- in code, in `formula`). The same fee can now have several rules (one per
-- lender, county...); Smart Fees picks one per fee: lender + county > lender >
-- county > state > default. So the one-rule-per-fee-name rule is dropped.
-- lenders gain their mortgagee clause; organizations gain a default
-- homeowner's insurance percent of value.
--
-- Apply to the DEV Supabase project only, after the estimates script. Safe to
-- run more than once. A full run ends with a confirmation row
-- ("LOSuite smart fees installed").

-- New amount types (added on their own; nothing below uses them).
alter type public.fee_amount_type add value if not exists 'tiered';
alter type public.fee_amount_type add value if not exists 'formula';

alter table public.fee_templates
  add column if not exists states           text[],
  add column if not exists counties         text[],
  add column if not exists lender_id        uuid,
  add column if not exists min_loan_amount  numeric(14, 2) check (min_loan_amount >= 0),
  add column if not exists max_loan_amount  numeric(14, 2) check (max_loan_amount >= 0),
  add column if not exists occupancies      public.occupancy[],
  -- {"basis": "loan" | "value", "brackets": [{"upTo": 250000, "amount": 150}, {"upTo": null, "amount": 250}]}
  add column if not exists tiers            jsonb,
  add column if not exists formula          text;

do $$ begin
  alter table public.fee_templates
    add constraint fee_templates_formula_check
      check (formula is null or formula in ('title_owner_tx', 'title_lender_tx', 'ufmip', 'va_funding_fee', 'usda_guarantee', 'recording_by_county', 'prepaid_interest', 'escrow_reserves'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.fee_templates
    add constraint fee_templates_loan_range_check check (min_loan_amount is null or max_loan_amount is null or min_loan_amount <= max_loan_amount);
exception when duplicate_object then null; end $$;
-- A lender rule belongs to one of the company's own lenders; deleting the lender removes its rules.
do $$ begin
  alter table public.fee_templates
    add constraint fee_templates_lender_id_fkey
      foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade;
exception when duplicate_object then null; end $$;

-- Several rules per fee: the key is no longer unique.
alter table public.fee_templates drop constraint if exists fee_templates_key_unique;
create index if not exists fee_templates_org_key_idx on public.fee_templates (organization_id, key);
create index if not exists fee_templates_lender_idx on public.fee_templates (lender_id);

-- The lender's mortgagee clause (shown on each estimate with that lender).
alter table public.lenders add column if not exists mortgagee_clause text;

-- Settings default: homeowner's insurance as a percent of value, when the home has no figure.
alter table public.organizations add column if not exists default_hoi_pct numeric(5, 3) check (default_hoi_pct >= 0 and default_hoi_pct <= 10);

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite smart fees installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'fee_templates'
     and column_name in ('states', 'counties', 'lender_id', 'min_loan_amount', 'max_loan_amount', 'occupancies', 'tiers', 'formula')) as rule_columns,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'fee_amount_type' and e.enumlabel in ('tiered', 'formula')) as amount_types,
  (select count(*) from pg_constraint where conname = 'fee_templates_key_unique') as key_unique_left,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'lenders' and column_name = 'mortgagee_clause') or (table_name = 'organizations' and column_name = 'default_hoi_pct'))) as other_columns;
