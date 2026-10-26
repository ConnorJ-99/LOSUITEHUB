-- LOSuite: fees, part 8a (the fee worksheet's data).
--
-- fee_templates: the company's standard fee list (Settings), by section,
-- with fixed or %-of-loan/value amounts, which loans they apply to, who
-- pays and whether they count in the APR.
-- loan_fees: what was changed on one file: an edited fee (override of the
-- calculated amount, with reset) or a fee added by hand.
-- loan_fee_settings: the file's points, lender credit, prepaid days and
-- months, escrow reserve months, aggregate adjustment, and how each payment
-- line is figured (calculated or typed; monthly, annual or % of value).
-- New loan fields: funding and first payment dates, impound waiver,
-- qualifying rate, buydown, supplemental insurance and an "other" payment.
-- Everything else on the worksheet (loan amount, rate, value, taxes, HOI,
-- HOA, MI, liens) uses the fields LOSuite already has.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite fees installed").

do $$ begin create type public.fee_section as enum ('A', 'B', 'C', 'E', 'F', 'G', 'H'); exception when duplicate_object then null; end $$;
do $$ begin create type public.fee_paid_by as enum ('B', 'S', 'L', 'O'); exception when duplicate_object then null; end $$;
do $$ begin create type public.fee_amount_type as enum ('fixed', 'pct_loan', 'pct_value'); exception when duplicate_object then null; end $$;
do $$ begin create type public.impound_waiver as enum ('none', 'taxes', 'insurance', 'all'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_factor as enum ('monthly', 'annual', 'pct_of_value'); exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- New loan fields
-- ---------------------------------------------------------------------------

alter table public.loans
  add column if not exists estimated_funding_date          date,
  add column if not exists first_payment_date              date,
  add column if not exists impound_waiver                  public.impound_waiver not null default 'none',
  add column if not exists qualifying_rate                 numeric(6, 3) check (qualifying_rate >= 0 and qualifying_rate <= 30),
  add column if not exists buydown                         text check (buydown in ('1-0', '2-1', '3-2-1')),
  add column if not exists supplemental_insurance_monthly  numeric(10, 2) check (supplemental_insurance_monthly >= 0),
  add column if not exists other_payment_monthly           numeric(10, 2) check (other_payment_monthly >= 0),
  add column if not exists other_payment_label             text;

-- ---------------------------------------------------------------------------
-- fee_templates (Settings)
-- ---------------------------------------------------------------------------

create table if not exists public.fee_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  key              text not null check (key ~ '^[a-z0-9_]+$'),
  -- F and G (prepaids and escrows) are calculated, not listed.
  section          public.fee_section not null check (section in ('A', 'B', 'C', 'E', 'H')),
  name             text not null check (length(trim(name)) > 0),
  amount_type      public.fee_amount_type not null default 'fixed',
  amount           numeric(12, 3) not null default 0 check (amount >= 0),
  -- Null = every purpose / every loan type.
  purposes         public.loan_purpose[],
  mortgage_types   public.mortgage_type[],
  paid_by          public.fee_paid_by not null default 'B',
  apr              boolean not null default false,
  paid_to          text,
  sort_order       integer not null default 100,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fee_templates_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint fee_templates_key_unique unique (organization_id, key)
);

create or replace trigger fee_templates_set_updated_at
  before update on public.fee_templates
  for each row execute function public.set_updated_at();

alter table public.fee_templates enable row level security;

drop policy if exists "members see fee templates" on public.fee_templates;
create policy "members see fee templates" on public.fee_templates
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add fee templates" on public.fee_templates;
create policy "managers add fee templates" on public.fee_templates
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit fee templates" on public.fee_templates;
create policy "managers edit fee templates" on public.fee_templates
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
drop policy if exists "managers remove fee templates" on public.fee_templates;
create policy "managers remove fee templates" on public.fee_templates
  for delete to authenticated using (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- loan_fees: edits and added fees on one file
-- ---------------------------------------------------------------------------

create table if not exists public.loan_fees (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  -- The calculated fee it overrides (a fee list key, "points", "prepaid_interest"...), or "custom_..." for an added fee.
  fee_key          text not null check (length(trim(fee_key)) > 0),
  section          public.fee_section not null,
  name             text not null check (length(trim(name)) > 0),
  -- Null = keep the calculated amount.
  at_closing       numeric(12, 2),
  before_closing   numeric(12, 2),
  paid_by          public.fee_paid_by not null default 'B',
  apr              boolean not null default false,
  paid_to          text,
  is_custom        boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its fee edits.
  constraint loan_fees_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_fees_one_per_fee unique (loan_id, fee_key),
  constraint loan_fees_custom_key check (is_custom = (fee_key like 'custom_%'))
);

create or replace trigger loan_fees_set_updated_at
  before update on public.loan_fees
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- loan_fee_settings: one row per file
-- ---------------------------------------------------------------------------

create table if not exists public.loan_fee_settings (
  loan_id                 uuid primary key,
  organization_id         uuid not null,
  points_pct              numeric(6, 3) not null default 0 check (points_pct >= 0 and points_pct <= 10),
  lender_credit           numeric(12, 2) not null default 0 check (lender_credit >= 0),
  -- Null = worked out from the funding (or closing) date.
  prepaid_interest_days   smallint check (prepaid_interest_days between 0 and 60),
  -- Null = the default for the loan purpose.
  hoi_prepaid_months      smallint check (hoi_prepaid_months between 0 and 24),
  tax_prepaid_months      smallint check (tax_prepaid_months between 0 and 24),
  hoi_reserve_months      smallint check (hoi_reserve_months between 0 and 24),
  tax_reserve_months      smallint check (tax_reserve_months between 0 and 24),
  mi_reserve_months       smallint check (mi_reserve_months between 0 and 24),
  aggregate_adjustment    numeric(12, 2) not null default 0,
  -- How each payment line is figured: calculated (true) or typed (false), and the unit typed values are in.
  hoi_is_calc             boolean not null default true,
  hoi_factor              public.payment_factor not null default 'annual',
  taxes_is_calc           boolean not null default true,
  taxes_factor            public.payment_factor not null default 'annual',
  supplemental_factor     public.payment_factor not null default 'monthly',
  mi_is_calc              boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint loan_fee_settings_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade
);

create or replace trigger loan_fee_settings_set_updated_at
  before update on public.loan_fee_settings
  for each row execute function public.set_updated_at();

alter table public.loan_fees enable row level security;
alter table public.loan_fee_settings enable row level security;

drop policy if exists "members see fees on permitted loans" on public.loan_fees;
create policy "members see fees on permitted loans" on public.loan_fees
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add fees on permitted loans" on public.loan_fees;
create policy "members add fees on permitted loans" on public.loan_fees
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members edit fees on permitted loans" on public.loan_fees;
create policy "members edit fees on permitted loans" on public.loan_fees
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members remove fees on permitted loans" on public.loan_fees;
create policy "members remove fees on permitted loans" on public.loan_fees
  for delete to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "members see fee settings on permitted loans" on public.loan_fee_settings;
create policy "members see fee settings on permitted loans" on public.loan_fee_settings
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add fee settings on permitted loans" on public.loan_fee_settings;
create policy "members add fee settings on permitted loans" on public.loan_fee_settings
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members edit fee settings on permitted loans" on public.loan_fee_settings;
create policy "members edit fee settings on permitted loans" on public.loan_fee_settings
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite fees installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans'
     and column_name in ('estimated_funding_date', 'first_payment_date', 'impound_waiver', 'qualifying_rate', 'buydown',
                         'supplemental_insurance_monthly', 'other_payment_monthly', 'other_payment_label')) as loan_columns;
