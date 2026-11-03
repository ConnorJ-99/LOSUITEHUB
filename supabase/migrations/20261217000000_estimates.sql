-- LOSuite: Scenarios & Estimate (docs/plans/scenarios-estimate.md, approved
-- by Connor 2026-11-03).
--
-- An estimate is a pricing scenario (pricing_scenarios) that also carries its
-- program and lender, its pricing date, its own seller credit and earnest
-- money, the fee rules Smart Fees used, its saved results and the loan facts
-- it was priced from. loans.pricing_scenario_id is the estimate Selected for
-- the file (one at a time); the loan stays the one source of truth.
--
-- The same program can be on a file more than once (each estimate has its own
-- program option), and points may be negative (a lender credit as a percent).
-- Saved Loan · Pricing quotes become estimates of their own; loan_quotes and
-- loans.chosen_quote_id are kept but retired (nothing writes them any more).
--
-- Apply to the DEV Supabase project only, after the launch intake script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite estimates installed").

-- ---------------------------------------------------------------------------
-- New columns on each estimate
-- ---------------------------------------------------------------------------

alter table public.pricing_scenarios
  -- The program and lender this estimate prices (blank = typed by hand).
  add column if not exists program_option_id  uuid,
  -- The date of the lender's pricing.
  add column if not exists quote_date         date,
  -- Soft archive: blank = active.
  add column if not exists archived_at        timestamptz,
  -- This estimate's own figures; blank = the loan's seller credit and the 1003's earnest money.
  add column if not exists seller_credits     numeric(12, 2) check (seller_credits >= 0),
  add column if not exists earnest_money      numeric(12, 2) check (earnest_money >= 0),
  -- The fee-list rules Smart Fees used, so a saved estimate keeps its numbers.
  add column if not exists fee_rules          jsonb,
  -- The saved results (payment, closing costs, cash to close, funds left, DTI).
  add column if not exists figures            jsonb,
  -- The loan facts it was priced from (for "Loan changed since this estimate").
  add column if not exists loan_snapshot      jsonb,
  add column if not exists priced_at          timestamptz,
  add column if not exists fees_generated_at  timestamptz,
  -- Carried over from an earlier loan ("From previous loan").
  add column if not exists from_loan_id       uuid,
  -- The Loan · Pricing quote this estimate was made from (bookkeeping for the move).
  add column if not exists from_quote_id      uuid;

do $$ begin
  alter table public.pricing_scenarios
    add constraint pricing_scenarios_program_option_id_fkey
      foreign key (program_option_id, loan_id) references public.loan_program_options (id, loan_id) on delete set null (program_option_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pricing_scenarios
    add constraint pricing_scenarios_from_loan_id_fkey
      foreign key (from_loan_id) references public.loans (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pricing_scenarios
    add constraint pricing_scenarios_from_quote_id_fkey
      foreign key (from_quote_id) references public.loan_quotes (id) on delete set null;
exception when duplicate_object then null; end $$;
create unique index if not exists pricing_scenarios_from_quote_idx on public.pricing_scenarios (from_quote_id) where from_quote_id is not null;
create index if not exists pricing_scenarios_program_option_idx on public.pricing_scenarios (program_option_id);

-- Points may be negative: a lender credit as a percent of the loan.
alter table public.pricing_scenarios drop constraint if exists pricing_scenarios_points_pct_check;
alter table public.pricing_scenarios add constraint pricing_scenarios_points_pct_check check (points_pct between -10 and 10);

-- The same program can be on a file more than once.
alter table public.loan_program_options drop constraint if exists loan_program_options_one_per_program;
create index if not exists loan_program_options_loan_program_idx on public.loan_program_options (loan_id, program_id);

-- ---------------------------------------------------------------------------
-- Saved quotes become estimates
-- ---------------------------------------------------------------------------

-- Each quote: a copy of its scenario at the quote's program, rate, points, lock and date, with the scenario's fee edits.
do $$
declare
  q record;
  v_new uuid;
begin
  for q in
    select lq.*, coalesce(p.name, 'Program') as program_label, coalesce(l.short_name, l.name) as lender_label
    from public.loan_quotes lq
    join public.loan_program_options o on o.id = lq.option_id
    left join public.programs p on p.id = o.program_id
    left join public.lenders l on l.id = p.lender_id
    where not exists (select 1 from public.pricing_scenarios s where s.from_quote_id = lq.id)
    order by lq.created_at
  loop
    insert into public.pricing_scenarios (
      organization_id, loan_id, property_id, name, lender_name, program_name, mortgage_type, amortization_type, interest_only, term_months,
      note_rate, qualifying_rate, buydown, lock_days, loan_amount, purchase_price, property_value, taxes_value, taxes_factor,
      insurance_value, insurance_factor, supplemental_insurance_monthly, monthly_hoa, monthly_mi, other_payment_monthly, other_payment_label,
      impound_waiver, estimated_funding_date, first_payment_date, points_pct, lender_credit, prepaid_interest_days, hoi_prepaid_months,
      tax_prepaid_months, hoi_reserve_months, tax_reserve_months, mi_reserve_months, aggregate_adjustment, notes, created_by,
      program_option_id, quote_date, priced_at, from_quote_id)
    select
      s.organization_id, s.loan_id, s.property_id, left(q.program_label || coalesce(' · ' || q.lender_label, ''), 120), q.lender_label, q.program_label,
      s.mortgage_type, s.amortization_type, s.interest_only, s.term_months,
      q.rate, s.qualifying_rate, s.buydown, coalesce(q.lock_days, s.lock_days), s.loan_amount, s.purchase_price, s.property_value, s.taxes_value, s.taxes_factor,
      s.insurance_value, s.insurance_factor, s.supplemental_insurance_monthly, s.monthly_hoa, coalesce(q.monthly_mi, s.monthly_mi), s.other_payment_monthly, s.other_payment_label,
      s.impound_waiver, s.estimated_funding_date, s.first_payment_date, q.points_pct, q.lender_credit, s.prepaid_interest_days, s.hoi_prepaid_months,
      s.tax_prepaid_months, s.hoi_reserve_months, s.tax_reserve_months, s.mi_reserve_months, s.aggregate_adjustment, coalesce(q.notes, s.notes), s.created_by,
      q.option_id, q.quote_date, q.updated_at, q.id
    from public.pricing_scenarios s
    where s.id = q.pricing_scenario_id
    returning id into v_new;

    insert into public.loan_fees (organization_id, loan_id, pricing_scenario_id, fee_key, section, name, at_closing, before_closing, paid_by, apr, paid_to, is_custom)
    select organization_id, loan_id, v_new, fee_key, section, name, at_closing, before_closing, paid_by, apr, paid_to, is_custom
    from public.loan_fees where pricing_scenario_id = q.pricing_scenario_id
    on conflict (pricing_scenario_id, fee_key) do nothing;

    -- The chosen quote's estimate is Selected for the file.
    update public.loans set pricing_scenario_id = v_new where id = q.loan_id and chosen_quote_id = q.id;
  end loop;
end $$;

-- A scenario whose quotes all became estimates was only a holder for them: archive it unless it is Selected.
update public.pricing_scenarios s
set archived_at = now()
where s.archived_at is null
  and s.from_quote_id is null
  and exists (select 1 from public.loan_quotes q where q.pricing_scenario_id = s.id)
  and not exists (select 1 from public.loans l where l.pricing_scenario_id = s.id);

comment on table public.loan_quotes is 'Retired 2026-11-03: each quote became an estimate (pricing_scenarios.from_quote_id). Kept for history; nothing writes it.';
comment on column public.loans.chosen_quote_id is 'Retired 2026-11-03: the selected estimate is loans.pricing_scenario_id.';

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite estimates installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'pricing_scenarios'
     and column_name in ('program_option_id', 'quote_date', 'archived_at', 'seller_credits', 'earnest_money', 'fee_rules', 'figures',
                         'loan_snapshot', 'priced_at', 'fees_generated_at', 'from_loan_id', 'from_quote_id')) as new_columns,
  (select count(*) from pg_constraint where conname = 'loan_program_options_one_per_program') as one_per_program_left,
  (select count(*) from pg_constraint where conname = 'pricing_scenarios_points_pct_check' and pg_get_constraintdef(oid) like '%-10%') as credit_points,
  (select count(*) from public.loan_quotes q where not exists (select 1 from public.pricing_scenarios s where s.from_quote_id = q.id)) as quotes_not_moved;
