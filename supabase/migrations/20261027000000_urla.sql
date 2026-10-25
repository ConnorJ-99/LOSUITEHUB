-- LOSuite Phase 3a: the 1003 (Uniform Residential Loan Application) data.
--
-- Person facts (identity, addresses, jobs, other income) live on the
-- contact and carry over to future loans. Application facts (assets,
-- liabilities, declarations, demographics) live on the loan.
-- No Social Security numbers are stored anywhere (CLAUDE.md decisions log).
-- Account numbers are last 4 digits only.
-- Apply to the DEV Supabase project only. Safe to run more than once: each
-- step skips what already exists. A full run ends with a confirmation row
-- ("LOSuite part 3a installed"); if you do not see it, the whole script did not run.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.citizenship as enum ('us_citizen', 'permanent_resident_alien', 'non_permanent_resident_alien');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.marital_status as enum ('married', 'separated', 'unmarried');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.address_kind as enum ('current', 'former', 'mailing');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.housing_kind as enum ('no_primary_expense', 'own', 'rent');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.employment_status as enum ('current', 'previous');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.other_income_type as enum (
  'alimony', 'automobile_allowance', 'boarder_income', 'capital_gains', 'child_support', 'disability',
  'foster_care', 'housing_or_parsonage', 'interest_and_dividends', 'mortgage_credit_certificate',
  'mortgage_differential', 'notes_receivable', 'public_assistance', 'retirement', 'royalty',
  'separate_maintenance', 'social_security', 'trust', 'unemployment', 'va_compensation', 'other'
);
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.asset_type as enum (
  -- 2a: bank, retirement and other accounts
  'checking', 'savings', 'money_market', 'certificate_of_deposit', 'mutual_fund', 'stocks', 'stock_options',
  'bonds', 'retirement', 'bridge_loan_proceeds', 'individual_development_account', 'trust_account',
  'cash_value_life_insurance',
  -- 2b: other assets and credits
  'proceeds_real_estate_sale', 'proceeds_non_real_estate_sale', 'secured_borrowed_funds',
  'unsecured_borrowed_funds', 'other_liquid', 'earnest_money', 'employer_assistance', 'lot_equity',
  'relocation_funds', 'rent_credit', 'sweat_equity', 'trade_equity', 'other_credit',
  -- 4d: gifts and grants
  'gift_cash', 'gift_equity', 'grant'
);
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.gift_source as enum (
  'relative', 'unmarried_partner', 'employer', 'religious_nonprofit', 'community_nonprofit',
  'federal_agency', 'state_agency', 'local_agency', 'lender', 'other'
);
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.liability_type as enum (
  -- 2c
  'revolving', 'installment', 'open_30_day', 'lease', 'other',
  -- 2d: other liabilities and expenses
  'alimony', 'child_support', 'separate_maintenance', 'job_related_expenses', 'other_expense'
);
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.mortgage_type as enum ('conventional', 'fha', 'va', 'usda_rural', 'other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.amortization_type as enum ('fixed', 'arm');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.estate_type as enum ('fee_simple', 'leasehold');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.reo_disposition as enum ('retain', 'pending_sale', 'sold');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.prior_property_usage as enum ('primary', 'fha_secondary', 'second_home', 'investment');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.prior_title_held as enum ('sole', 'joint_with_spouse', 'joint_with_other');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.hmda_ethnicity as enum (
  'hispanic_or_latino', 'mexican', 'puerto_rican', 'cuban', 'other_hispanic',
  'not_hispanic_or_latino', 'not_provided'
);
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.hmda_race as enum (
  'american_indian_or_alaska_native', 'asian', 'asian_indian', 'chinese', 'filipino', 'japanese', 'korean',
  'vietnamese', 'other_asian', 'black_or_african_american', 'native_hawaiian_or_pacific_islander',
  'native_hawaiian', 'guamanian_or_chamorro', 'samoan', 'other_pacific_islander', 'white', 'not_provided'
);
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.hmda_sex as enum ('female', 'male', 'not_provided');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.application_method as enum ('face_to_face', 'telephone', 'fax_or_mail', 'email_or_internet');
exception when duplicate_object then null;
end $$;

-- Other real estate owned, for section 3 of the 1003. (A new enum value
-- can't be used in the same transaction it's added in, so nothing below uses it.)
alter type public.property_status add value if not exists 'owned';

-- ---------------------------------------------------------------------------
-- Person facts on contacts (section 1a and section 7)
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists middle_name                 text,
  add column if not exists suffix                      text,
  add column if not exists date_of_birth               date,
  add column if not exists citizenship                 public.citizenship,
  add column if not exists marital_status              public.marital_status,
  add column if not exists dependents_count            smallint check (dependents_count >= 0),
  add column if not exists dependents_ages             text,
  add column if not exists home_phone                  text,
  add column if not exists work_phone                  text,
  add column if not exists work_phone_ext              text,
  add column if not exists military_service            boolean,
  add column if not exists military_active_duty        boolean not null default false,
  add column if not exists military_service_expires_on date,
  add column if not exists military_retired            boolean not null default false,
  add column if not exists military_reserve_only       boolean not null default false,
  add column if not exists military_surviving_spouse   boolean not null default false;

-- ---------------------------------------------------------------------------
-- contact_addresses: current, former and mailing addresses
-- ---------------------------------------------------------------------------

create table if not exists public.contact_addresses (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  contact_id         uuid not null,
  kind               public.address_kind not null default 'current',
  address_line       text not null check (length(trim(address_line)) > 0),
  unit               text,
  city               text,
  state              text check (state ~ '^[A-Z]{2}$'),
  zip                text,
  country            text not null default 'US',
  housing            public.housing_kind,
  monthly_rent       numeric(10, 2) check (monthly_rent >= 0),
  months_at_address  smallint check (months_at_address >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Deleting the person deletes their addresses.
  constraint contact_addresses_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade
);

create index if not exists contact_addresses_contact_id_idx on public.contact_addresses (contact_id);
-- One current address and one mailing address per person.
create unique index if not exists contact_addresses_one_current_idx on public.contact_addresses (contact_id) where kind = 'current';
create unique index if not exists contact_addresses_one_mailing_idx on public.contact_addresses (contact_id) where kind = 'mailing';

create or replace trigger contact_addresses_set_updated_at
  before update on public.contact_addresses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- employments: current and previous jobs (sections 1b, 1c, 1d)
-- ---------------------------------------------------------------------------

create table if not exists public.employments (
  id                         uuid primary key default gen_random_uuid(),
  organization_id            uuid not null,
  contact_id                 uuid not null,
  status                     public.employment_status not null default 'current',
  -- Order within the person's jobs; the first current job is the primary one (1b).
  sort_order                 smallint not null default 0,
  employer_name              text not null check (length(trim(employer_name)) > 0),
  employer_phone             text,
  address_line               text,
  unit                       text,
  city                       text,
  state                      text check (state ~ '^[A-Z]{2}$'),
  zip                        text,
  position_title             text,
  start_date                 date,
  end_date                   date,
  months_in_line_of_work     smallint check (months_in_line_of_work >= 0),
  employed_by_party          boolean not null default false,
  is_self_employed           boolean not null default false,
  ownership_25_or_more       boolean,
  -- Gross monthly income by type. Previous jobs use base_income for their gross monthly income.
  base_income                numeric(12, 2) check (base_income >= 0),
  overtime_income            numeric(12, 2) check (overtime_income >= 0),
  bonus_income               numeric(12, 2) check (bonus_income >= 0),
  commission_income          numeric(12, 2) check (commission_income >= 0),
  military_entitlements      numeric(12, 2) check (military_entitlements >= 0),
  other_employment_income    numeric(12, 2) check (other_employment_income >= 0),
  -- Self-employed monthly income or loss (can be negative).
  self_employed_income       numeric(12, 2),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint employments_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint employments_dates_in_order check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists employments_contact_id_idx on public.employments (contact_id);

create or replace trigger employments_set_updated_at
  before update on public.employments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- other_incomes: income from other sources (section 1e)
-- ---------------------------------------------------------------------------

create table if not exists public.other_incomes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  income_type      public.other_income_type not null,
  description      text,
  monthly_amount   numeric(12, 2) not null check (monthly_amount >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint other_incomes_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade
);

create index if not exists other_incomes_contact_id_idx on public.other_incomes (contact_id);

create or replace trigger other_incomes_set_updated_at
  before update on public.other_incomes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- assets: accounts, other assets and credits, gifts (sections 2a, 2b, 4d)
-- ---------------------------------------------------------------------------

create table if not exists public.assets (
  id                uuid primary key default gen_random_uuid(),
  loan_id           uuid not null,
  -- The borrower who owns it; must be a borrower on this loan.
  contact_id        uuid not null,
  is_joint          boolean not null default false,
  asset_type        public.asset_type not null,
  institution_name  text,
  account_last4     text check (account_last4 ~ '^[0-9]{4}$'),
  amount            numeric(14, 2) not null check (amount >= 0),
  gift_source       public.gift_source,
  gift_deposited    boolean,
  description       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Removing the borrower from the loan (or deleting the loan) removes their assets.
  constraint assets_loan_borrower_fkey
    foreign key (loan_id, contact_id) references public.loan_borrowers (loan_id, contact_id) on delete cascade
);

create index if not exists assets_loan_id_idx on public.assets (loan_id);

create or replace trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- liabilities: debts and other obligations (sections 2c, 2d)
-- Mortgages are not here: they are property_liens on the property they secure.
-- ---------------------------------------------------------------------------

create table if not exists public.liabilities (
  id                uuid primary key default gen_random_uuid(),
  loan_id           uuid not null,
  contact_id        uuid not null,
  is_joint          boolean not null default false,
  liability_type    public.liability_type not null,
  creditor_name     text,
  account_last4     text check (account_last4 ~ '^[0-9]{4}$'),
  unpaid_balance    numeric(14, 2) check (unpaid_balance >= 0),
  monthly_payment   numeric(12, 2) not null default 0 check (monthly_payment >= 0),
  months_remaining  smallint check (months_remaining >= 0),
  to_be_paid_off    boolean not null default false,
  description       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint liabilities_loan_borrower_fkey
    foreign key (loan_id, contact_id) references public.loan_borrowers (loan_id, contact_id) on delete cascade
);

create index if not exists liabilities_loan_id_idx on public.liabilities (loan_id);

create or replace trigger liabilities_set_updated_at
  before update on public.liabilities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- borrower_declarations: section 5 declarations and section 8 demographics,
-- one row per borrower per loan. Null means "not answered yet".
-- ---------------------------------------------------------------------------

create table if not exists public.borrower_declarations (
  loan_id                              uuid not null,
  contact_id                           uuid not null,
  -- 5a
  will_occupy_as_primary               boolean,
  owned_property_past_3_years          boolean,
  prior_property_usage                 public.prior_property_usage,
  prior_title_held                     public.prior_title_held,
  family_relationship_with_seller      boolean,
  borrowing_undisclosed_money          boolean,
  undisclosed_money_amount             numeric(14, 2) check (undisclosed_money_amount >= 0),
  applying_other_mortgage              boolean,
  applying_new_credit                  boolean,
  subject_to_priority_lien             boolean,
  -- 5b
  cosigner_or_guarantor                boolean,
  outstanding_judgments                boolean,
  delinquent_federal_debt              boolean,
  party_to_lawsuit                     boolean,
  deed_in_lieu_past_7_years            boolean,
  short_sale_past_7_years              boolean,
  foreclosure_past_7_years             boolean,
  bankruptcy_past_7_years              boolean,
  bankruptcy_chapter_7                 boolean not null default false,
  bankruptcy_chapter_11                boolean not null default false,
  bankruptcy_chapter_12                boolean not null default false,
  bankruptcy_chapter_13                boolean not null default false,
  -- 8: demographic information (HMDA)
  ethnicities                          public.hmda_ethnicity[] not null default '{}',
  ethnicity_other_text                 text,
  races                                public.hmda_race[] not null default '{}',
  race_tribe_text                      text,
  race_other_asian_text                text,
  race_other_pacific_islander_text     text,
  sexes                                public.hmda_sex[] not null default '{}',
  application_method                   public.application_method,
  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now(),
  primary key (loan_id, contact_id),
  constraint borrower_declarations_loan_borrower_fkey
    foreign key (loan_id, contact_id) references public.loan_borrowers (loan_id, contact_id) on delete cascade
);

create or replace trigger borrower_declarations_set_updated_at
  before update on public.borrower_declarations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lender loan information on loans (sections 4 and L)
-- ---------------------------------------------------------------------------

alter table public.loans
  add column if not exists mortgage_type            public.mortgage_type,
  add column if not exists amortization_type        public.amortization_type not null default 'fixed',
  add column if not exists title_names              text,
  add column if not exists title_manner             text,
  add column if not exists estate_type              public.estate_type not null default 'fee_simple',
  add column if not exists has_balloon              boolean not null default false,
  add column if not exists has_interest_only        boolean not null default false,
  add column if not exists has_negative_amortization boolean not null default false,
  add column if not exists has_prepayment_penalty   boolean not null default false,
  add column if not exists improvements_amount      numeric(14, 2) check (improvements_amount >= 0),
  add column if not exists estimated_closing_costs  numeric(14, 2) check (estimated_closing_costs >= 0),
  add column if not exists prepaid_items_amount     numeric(14, 2) check (prepaid_items_amount >= 0),
  add column if not exists discount_points_amount   numeric(14, 2) check (discount_points_amount >= 0),
  add column if not exists seller_credits           numeric(14, 2) check (seller_credits >= 0),
  add column if not exists lender_credits           numeric(14, 2) check (lender_credits >= 0);

-- ---------------------------------------------------------------------------
-- Real estate owned (section 3) on properties and liens
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists unit_count       smallint check (unit_count between 1 and 4),
  add column if not exists reo_disposition  public.reo_disposition,
  add column if not exists reo_occupancy    public.occupancy;

alter table public.property_liens
  add column if not exists to_be_paid_off  boolean not null default false,
  add column if not exists credit_limit    numeric(14, 2) check (credit_limit >= 0),
  add column if not exists mortgage_type   public.mortgage_type;

-- ---------------------------------------------------------------------------
-- Loan originator information (section 9)
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists address_line  text,
  add column if not exists city          text,
  add column if not exists state         text check (state ~ '^[A-Z]{2}$'),
  add column if not exists zip           text,
  add column if not exists phone         text;

alter table public.profiles
  add column if not exists phone          text,
  add column if not exists state_license  text;

-- ---------------------------------------------------------------------------
-- add_borrower: put a person (new or existing) on a loan as a co-borrower,
-- in one step. Runs with the caller's permissions.
-- ---------------------------------------------------------------------------

create or replace function public.add_borrower(
  p_loan_id              uuid,
  p_first_name           text,
  p_last_name            text,
  p_email                text,
  p_phone                text,
  p_existing_contact_id  uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_contact_id uuid := p_existing_contact_id;
begin
  select organization_id into v_org from public.loans where id = p_loan_id;
  if v_org is null then
    raise exception 'Loan not found or not permitted';
  end if;

  if v_contact_id is null then
    insert into public.contacts (organization_id, first_name, last_name, email, phone)
    values (v_org, trim(p_first_name), coalesce(trim(p_last_name), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
    returning id into v_contact_id;
  end if;

  insert into public.loan_borrowers (loan_id, contact_id, organization_id, role)
  values (p_loan_id, v_contact_id, v_org, 'co_borrower');

  return v_contact_id;
end;
$$;

grant execute on function public.add_borrower to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.contact_addresses enable row level security;
alter table public.employments enable row level security;
alter table public.other_incomes enable row level security;
alter table public.assets enable row level security;
alter table public.liabilities enable row level security;
alter table public.borrower_declarations enable row level security;

-- Person facts follow the person.
drop policy if exists "members see addresses of permitted people" on public.contact_addresses;
create policy "members see addresses of permitted people" on public.contact_addresses
  for select to authenticated using (public.can_see_contact(contact_id));
drop policy if exists "members add addresses to permitted people" on public.contact_addresses;
create policy "members add addresses to permitted people" on public.contact_addresses
  for insert to authenticated with check (public.can_see_contact(contact_id) and public.is_org_member(organization_id));
drop policy if exists "members edit addresses of permitted people" on public.contact_addresses;
create policy "members edit addresses of permitted people" on public.contact_addresses
  for update to authenticated using (public.can_see_contact(contact_id)) with check (public.can_see_contact(contact_id));
drop policy if exists "members delete addresses of permitted people" on public.contact_addresses;
create policy "members delete addresses of permitted people" on public.contact_addresses
  for delete to authenticated using (public.can_see_contact(contact_id));

drop policy if exists "members see jobs of permitted people" on public.employments;
create policy "members see jobs of permitted people" on public.employments
  for select to authenticated using (public.can_see_contact(contact_id));
drop policy if exists "members add jobs to permitted people" on public.employments;
create policy "members add jobs to permitted people" on public.employments
  for insert to authenticated with check (public.can_see_contact(contact_id) and public.is_org_member(organization_id));
drop policy if exists "members edit jobs of permitted people" on public.employments;
create policy "members edit jobs of permitted people" on public.employments
  for update to authenticated using (public.can_see_contact(contact_id)) with check (public.can_see_contact(contact_id));
drop policy if exists "members delete jobs of permitted people" on public.employments;
create policy "members delete jobs of permitted people" on public.employments
  for delete to authenticated using (public.can_see_contact(contact_id));

drop policy if exists "members see other income of permitted people" on public.other_incomes;
create policy "members see other income of permitted people" on public.other_incomes
  for select to authenticated using (public.can_see_contact(contact_id));
drop policy if exists "members add other income to permitted people" on public.other_incomes;
create policy "members add other income to permitted people" on public.other_incomes
  for insert to authenticated with check (public.can_see_contact(contact_id) and public.is_org_member(organization_id));
drop policy if exists "members edit other income of permitted people" on public.other_incomes;
create policy "members edit other income of permitted people" on public.other_incomes
  for update to authenticated using (public.can_see_contact(contact_id)) with check (public.can_see_contact(contact_id));
drop policy if exists "members delete other income of permitted people" on public.other_incomes;
create policy "members delete other income of permitted people" on public.other_incomes
  for delete to authenticated using (public.can_see_contact(contact_id));

-- Application facts follow the loan.
drop policy if exists "members see assets on permitted loans" on public.assets;
create policy "members see assets on permitted loans" on public.assets
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add assets to permitted loans" on public.assets;
create policy "members add assets to permitted loans" on public.assets
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit assets on permitted loans" on public.assets;
create policy "members edit assets on permitted loans" on public.assets
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members delete assets on permitted loans" on public.assets;
create policy "members delete assets on permitted loans" on public.assets
  for delete to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "members see liabilities on permitted loans" on public.liabilities;
create policy "members see liabilities on permitted loans" on public.liabilities
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add liabilities to permitted loans" on public.liabilities;
create policy "members add liabilities to permitted loans" on public.liabilities
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit liabilities on permitted loans" on public.liabilities;
create policy "members edit liabilities on permitted loans" on public.liabilities
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members delete liabilities on permitted loans" on public.liabilities;
create policy "members delete liabilities on permitted loans" on public.liabilities
  for delete to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "members see declarations on permitted loans" on public.borrower_declarations;
create policy "members see declarations on permitted loans" on public.borrower_declarations
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add declarations to permitted loans" on public.borrower_declarations;
create policy "members add declarations to permitted loans" on public.borrower_declarations
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit declarations on permitted loans" on public.borrower_declarations;
create policy "members edit declarations on permitted loans" on public.borrower_declarations
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members delete declarations on permitted loans" on public.borrower_declarations;
create policy "members delete declarations on permitted loans" on public.borrower_declarations
  for delete to authenticated using (public.can_see_loan(loan_id));

-- Section 9 needs to read the company's details; owners/admins already edit
-- organizations (foundation migration). Users can already edit their own profile.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite part 3a installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables;
