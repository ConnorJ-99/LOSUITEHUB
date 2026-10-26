-- LOSuite: pricing scenarios, part 8a (the Pricing tab's data).
--
-- pricing_scenarios: saved pricing options on one file (one per house, per
-- lender, per program...). Each holds the numbers being compared: lender and
-- program (typed for now; Product Search links them later), loan terms, the
-- home's price, taxes, insurance and HOA, and the fee settings (points,
-- lender credit, prepaid days and months, reserve months, how each payment
-- line is figured). A scenario can come from a property ("Push to pricer"),
-- and stays linked to it.
-- A scenario is a what-if. The loan's own fields stay the one source of
-- truth: "Use for this loan" copies a scenario's numbers into the loan and
-- records it as loans.pricing_scenario_id.
-- loan_fees (from the fees script) now belong to a scenario, and
-- loan_fee_settings is replaced by the scenario's own fee settings. Both were
-- created empty the same day, so no data is lost.
-- loan_documents gains property_id and pricing_scenario_id, so a saved Fee
-- Worksheet PDF shows on its property.
-- Apply to the DEV Supabase project only, after the fees script. Safe to run
-- more than once. A full run ends with a confirmation row
-- ("LOSuite pricing installed").

-- ---------------------------------------------------------------------------
-- pricing_scenarios
-- ---------------------------------------------------------------------------

create table if not exists public.pricing_scenarios (
  id                              uuid primary key default gen_random_uuid(),
  organization_id                 uuid not null,
  loan_id                         uuid not null,
  -- The home this pricing is for; deleting the property keeps the scenario.
  property_id                     uuid,
  name                            text not null check (length(trim(name)) > 0),
  lender_name                     text,
  program_name                    text,
  -- Loan terms.
  mortgage_type                   public.mortgage_type,
  amortization_type               public.amortization_type not null default 'fixed',
  interest_only                   boolean not null default false,
  term_months                     smallint check (term_months between 1 and 480),
  note_rate                       numeric(6, 3) check (note_rate >= 0 and note_rate <= 30),
  qualifying_rate                 numeric(6, 3) check (qualifying_rate >= 0 and qualifying_rate <= 30),
  buydown                         text check (buydown in ('1-0', '2-1', '3-2-1')),
  lock_days                       smallint check (lock_days between 0 and 365),
  loan_amount                     numeric(14, 2) check (loan_amount >= 0),
  -- The home: price (purchase) and value (appraised or estimated).
  purchase_price                  numeric(14, 2) check (purchase_price >= 0),
  property_value                  numeric(14, 2) check (property_value >= 0),
  -- Payment lines. Taxes and insurance are typed in the unit their factor says.
  taxes_value                     numeric(12, 3) check (taxes_value >= 0),
  taxes_factor                    public.payment_factor not null default 'annual',
  insurance_value                 numeric(12, 3) check (insurance_value >= 0),
  insurance_factor                public.payment_factor not null default 'annual',
  supplemental_insurance_monthly  numeric(10, 2) check (supplemental_insurance_monthly >= 0),
  monthly_hoa                     numeric(10, 2) check (monthly_hoa >= 0),
  -- Null = calculated from the loan type and LTV.
  monthly_mi                      numeric(10, 2) check (monthly_mi >= 0),
  other_payment_monthly           numeric(10, 2) check (other_payment_monthly >= 0),
  other_payment_label             text,
  impound_waiver                  public.impound_waiver not null default 'none',
  -- Dates.
  estimated_funding_date          date,
  first_payment_date              date,
  -- Fee settings.
  points_pct                      numeric(6, 3) not null default 0 check (points_pct >= 0 and points_pct <= 10),
  lender_credit                   numeric(12, 2) not null default 0 check (lender_credit >= 0),
  -- Null = worked out from the funding (or closing) date.
  prepaid_interest_days           smallint check (prepaid_interest_days between 0 and 60),
  -- Null = the default for the loan purpose.
  hoi_prepaid_months              smallint check (hoi_prepaid_months between 0 and 24),
  tax_prepaid_months              smallint check (tax_prepaid_months between 0 and 24),
  hoi_reserve_months              smallint check (hoi_reserve_months between 0 and 24),
  tax_reserve_months              smallint check (tax_reserve_months between 0 and 24),
  mi_reserve_months               smallint check (mi_reserve_months between 0 and 24),
  aggregate_adjustment            numeric(12, 2) not null default 0,
  notes                           text,
  created_by                      uuid default auth.uid(),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  -- Deleting a loan deletes its scenarios.
  constraint pricing_scenarios_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  -- The property must be one of this loan's own.
  constraint pricing_scenarios_property_id_fkey
    foreign key (property_id, loan_id) references public.properties (id, loan_id) on delete set null (property_id),
  constraint pricing_scenarios_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint pricing_scenarios_id_loan_id_key unique (id, loan_id)
);

create index if not exists pricing_scenarios_loan_id_idx on public.pricing_scenarios (loan_id, created_at);
create index if not exists pricing_scenarios_property_id_idx on public.pricing_scenarios (property_id);

create or replace trigger pricing_scenarios_set_updated_at
  before update on public.pricing_scenarios
  for each row execute function public.set_updated_at();

alter table public.pricing_scenarios enable row level security;

drop policy if exists "members see scenarios on permitted loans" on public.pricing_scenarios;
create policy "members see scenarios on permitted loans" on public.pricing_scenarios
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add scenarios on permitted loans" on public.pricing_scenarios;
create policy "members add scenarios on permitted loans" on public.pricing_scenarios
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members edit scenarios on permitted loans" on public.pricing_scenarios;
create policy "members edit scenarios on permitted loans" on public.pricing_scenarios
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members remove scenarios on permitted loans" on public.pricing_scenarios;
create policy "members remove scenarios on permitted loans" on public.pricing_scenarios
  for delete to authenticated using (public.can_see_loan(loan_id));

-- The scenario last used for the loan; deleting it just clears the choice.
alter table public.loans add column if not exists pricing_scenario_id uuid;
do $$ begin
  alter table public.loans
    add constraint loans_pricing_scenario_id_fkey
      foreign key (pricing_scenario_id, id) references public.pricing_scenarios (id, loan_id)
      on delete set null (pricing_scenario_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- loan_fees belong to a scenario
-- ---------------------------------------------------------------------------

alter table public.loan_fees add column if not exists pricing_scenario_id uuid;
-- Fee edits made before scenarios existed have no scenario to belong to (none
-- exist: the table was created empty the same day).
delete from public.loan_fees where pricing_scenario_id is null;
alter table public.loan_fees alter column pricing_scenario_id set not null;
alter table public.loan_fees drop constraint if exists loan_fees_one_per_fee;
do $$ begin
  alter table public.loan_fees
    add constraint loan_fees_pricing_scenario_id_fkey
      foreign key (pricing_scenario_id, loan_id) references public.pricing_scenarios (id, loan_id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.loan_fees add constraint loan_fees_one_per_fee unique (pricing_scenario_id, fee_key);
exception when duplicate_object or duplicate_table then null; end $$;

-- Fee settings now live on the scenario.
drop table if exists public.loan_fee_settings;

-- ---------------------------------------------------------------------------
-- loan_documents: which property and scenario a document is for
-- ---------------------------------------------------------------------------

alter table public.loan_documents
  add column if not exists property_id          uuid,
  add column if not exists pricing_scenario_id  uuid;
do $$ begin
  alter table public.loan_documents
    add constraint loan_documents_property_id_fkey
      foreign key (property_id, loan_id) references public.properties (id, loan_id) on delete set null (property_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.loan_documents
    add constraint loan_documents_pricing_scenario_id_fkey
      foreign key (pricing_scenario_id, loan_id) references public.pricing_scenarios (id, loan_id) on delete set null (pricing_scenario_id);
exception when duplicate_object then null; end $$;
create index if not exists loan_documents_property_id_idx on public.loan_documents (property_id);

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite pricing installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'loan_fees' and column_name = 'pricing_scenario_id')
       or (table_name = 'loans' and column_name = 'pricing_scenario_id')
       or (table_name = 'loan_documents' and column_name in ('property_id', 'pricing_scenario_id')))) as new_links;
