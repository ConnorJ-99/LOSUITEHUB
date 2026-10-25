-- LOSuite: phone prequal tool.
--
-- The prequal is a short 1003: income, debts and savings typed on the call
-- save into the same 1003 records. This adds only what a prequal needs that
-- the 1003 doesn't already have:
--   * estimates for a home not picked yet (tax rate, insurance, HOA), used
--     until a subject property with real figures is chosen;
--   * mortgage insurance settings (annual rate and financed upfront fee),
--     blank meaning "use the default for the loan type";
--   * each borrower's estimated credit score on this loan.
-- Apply to the DEV Supabase project only. Safe to run more than once: each
-- step skips what already exists. A full run ends with a confirmation row
-- ("LOSuite prequal installed"); if you do not see it, the whole script did not run.

-- ---------------------------------------------------------------------------
-- Loan estimates and mortgage insurance settings
-- ---------------------------------------------------------------------------

alter table public.loans
  -- Yearly property tax as a percent of the price or value (e.g. 2.2).
  add column if not exists estimated_tax_rate_pct    numeric(5, 3) check (estimated_tax_rate_pct >= 0 and estimated_tax_rate_pct <= 10),
  add column if not exists estimated_annual_insurance numeric(12, 2) check (estimated_annual_insurance >= 0),
  add column if not exists estimated_monthly_hoa      numeric(10, 2) check (estimated_monthly_hoa >= 0),
  -- Yearly mortgage insurance as a percent of the loan; blank = default for the loan type.
  add column if not exists mi_rate_pct                numeric(5, 3) check (mi_rate_pct >= 0 and mi_rate_pct <= 5),
  -- Financed upfront fee (FHA UFMIP, VA funding fee, USDA guarantee fee) as a
  -- percent of the base loan; blank = default, 0 = none (e.g. VA exempt).
  add column if not exists upfront_fee_pct            numeric(5, 3) check (upfront_fee_pct >= 0 and upfront_fee_pct <= 10);

-- ---------------------------------------------------------------------------
-- Each borrower's estimated credit score on this loan
-- ---------------------------------------------------------------------------

alter table public.loan_borrowers
  add column if not exists estimated_credit_score smallint check (estimated_credit_score between 300 and 850);

-- loan_borrowers already lets members who can see the loan edit its rows
-- (Phase 1 policies), so no new policies are needed.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite prequal installed' as result,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and (table_name, column_name) in (
        ('loans', 'estimated_tax_rate_pct'), ('loans', 'estimated_annual_insurance'), ('loans', 'estimated_monthly_hoa'),
        ('loans', 'mi_rate_pct'), ('loans', 'upfront_fee_pct'), ('loan_borrowers', 'estimated_credit_score')
      )) as new_columns;
