-- MPS HQ estimates: down payment assistance and splitting a fee with the
-- seller (Connor, 2026-11-14).
--
-- pricing_scenarios.dpa: an estimate's down payment assistance or gift /
--   grant ({ kind: gift | forgivable | repayable, amount, ratePct,
--   termMonths, name }); null = none. The math is in src/lib/calc/dpa.ts.
-- loan_fees.seller_paid: the seller's share of a borrower fee (title
--   insurance split with the seller); null = none.
--
-- Title insurance itself needs no database change: when the fee list has no
-- title policy that applies, estimates add it at 0.65% of the loan.
--
-- Safe to re-run. Ends with a confirmation row.

alter table public.pricing_scenarios add column if not exists dpa jsonb;
do $$ begin
  alter table public.pricing_scenarios add constraint pricing_scenarios_dpa_check check (
    dpa is null or (
      jsonb_typeof(dpa) = 'object'
      and dpa->>'kind' in ('gift', 'forgivable', 'repayable')
      and jsonb_typeof(dpa->'amount') = 'number' and (dpa->>'amount')::numeric between 0 and 10000000
    )
  );
exception when duplicate_object then null; end $$;

alter table public.loan_fees add column if not exists seller_paid numeric(12, 2);
do $$ begin
  alter table public.loan_fees add constraint loan_fees_seller_paid_check check (seller_paid is null or seller_paid > 0);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ estimate DPA and seller fee split installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'pricing_scenarios' and column_name = 'dpa') or (table_name = 'loan_fees' and column_name = 'seller_paid'))) as columns;
