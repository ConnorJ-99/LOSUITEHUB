-- LOSuite: Product Search v2, step 1 (docs/plans/product-search-v2.md §3).
--
-- The lender catalog (shared by the whole company):
--   lenders               name, status (approved / pending / not signed up / inactive), channel, AE, portal
--   programs              lender, product family, lien, doc types, features, purposes, terms
--   matrix_versions       each import of a program's matrix; only the approved one is searched
--   program_matrix_cells  one row per cell of the lender's grid, with its source page;
--                         a blank cell ("—", "N/A") is stored as NOT OFFERED, never as 0
--   program_rules         everything that isn't a grid cell (DTI, seasoning, states...), with citations
--   overlays              company overlays on top of lender matrices (Texas §50(a)(6) is in code)
--   guideline_documents   the lender's PDFs (matrix, guidelines, bulletins), with fingerprints
--   guideline_passages    their text split by section heading, full-text searchable
-- Searches and borrower pricing:
--   product_searches      every search (for Recent searches and checking accuracy)
--   loan_program_options  programs added to a borrower file for pricing
--   loan_quotes           each lender's quote on a pricing scenario (TBD or a home)
--   loans.program_id / loans.chosen_quote_id   what was chosen (the loan stays the source of truth)
-- Owners and admins edit the catalog; everyone in the company can read it.
-- The word lists match src/lib/products/taxonomy.ts (a test checks).
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite product search installed").

do $$ begin create type public.product_family as enum ('conventional', 'fha', 'va', 'usda', 'jumbo', 'non_qm'); exception when duplicate_object then null; end $$;
do $$ begin create type public.product_lien as enum ('first', 'ces', 'heloc'); exception when duplicate_object then null; end $$;
do $$ begin create type public.product_doc_type as enum ('full_doc', 'bank_statement_12', 'bank_statement_24', 'form_1099', 'pnl_only', 'asset_depletion', 'dscr', 'wvoe', 'no_ratio'); exception when duplicate_object then null; end $$;
do $$ begin create type public.product_feature as enum ('dpa', 'itin', 'foreign_national', 'interest_only', 'non_warrantable_condo', 'manufactured', 'buydown', 'recent_credit_event', 'first_time_investor', 'str_income', 'homeready_possible', 'llc_vesting'); exception when duplicate_object then null; end $$;
do $$ begin create type public.matrix_purpose as enum ('purchase', 'rate_term', 'cash_out'); exception when duplicate_object then null; end $$;
do $$ begin create type public.matrix_property_type as enum ('sfr_pud', 'condo', 'non_warrantable_condo', 'two_to_four', 'manufactured', 'mixed_use'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lender_status as enum ('approved', 'pending', 'not_signed_up', 'inactive'); exception when duplicate_object then null; end $$;
do $$ begin create type public.lender_channel as enum ('wholesale', 'correspondent', 'non_delegated'); exception when duplicate_object then null; end $$;
do $$ begin create type public.rule_field as enum ('dti', 'reserves_months', 'mortgage_lates_12', 'mortgage_lates_24', 'bk_seasoning_months', 'fc_seasoning_months', 'state', 'citizenship', 'self_employed_years', 'loan_amount', 'fico', 'ltv', 'cltv', 'dscr', 'units', 'first_time_buyer', 'income_vs_ami'); exception when duplicate_object then null; end $$;
do $$ begin create type public.rule_op as enum ('<=', '>=', 'in', 'not_in', 'required', 'between'); exception when duplicate_object then null; end $$;
do $$ begin create type public.product_citizenship as enum ('us_citizen', 'permanent_resident', 'non_permanent_resident', 'itin', 'foreign_national'); exception when duplicate_object then null; end $$;
do $$ begin create type public.rule_severity as enum ('hard', 'verify'); exception when duplicate_object then null; end $$;
do $$ begin create type public.extracted_by as enum ('ai', 'manual'); exception when duplicate_object then null; end $$;
do $$ begin create type public.matrix_version_status as enum ('draft', 'approved', 'superseded'); exception when duplicate_object then null; end $$;
do $$ begin create type public.guideline_doc_type as enum ('matrix', 'guidelines', 'overlay_bulletin', 'rate_sheet'); exception when duplicate_object then null; end $$;
do $$ begin create type public.loan_amount_basis as enum ('this_lien', 'combined'); exception when duplicate_object then null; end $$;
do $$ begin create type public.overlay_scope as enum ('all', 'lender', 'program'); exception when duplicate_object then null; end $$;
do $$ begin create type public.program_option_status as enum ('shortlisted', 'quoted', 'chosen', 'removed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.quote_source as enum ('manual', 'quote_pdf'); exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- lenders
-- ---------------------------------------------------------------------------

create table if not exists public.lenders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null check (length(trim(name)) > 0),
  short_name       text,
  logo_path        text,
  status           public.lender_status not null default 'not_signed_up',
  channel          public.lender_channel not null default 'wholesale',
  ae_name          text,
  ae_phone         text,
  ae_email         text,
  portal_url       text,
  comp_notes       text,
  -- Two-letter states the lender lends in; null = not recorded.
  states           text[],
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lenders_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint lenders_name_unique unique (organization_id, name),
  constraint lenders_id_organization_id_key unique (id, organization_id)
);

-- ---------------------------------------------------------------------------
-- programs
-- ---------------------------------------------------------------------------

create table if not exists public.programs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  lender_id          uuid not null,
  name               text not null check (length(trim(name)) > 0),
  product_family     public.product_family not null,
  lien               public.product_lien not null,
  doc_types          public.product_doc_type[] not null check (cardinality(doc_types) > 0),
  features           public.product_feature[] not null default '{}',
  purposes           public.matrix_purpose[] not null default '{purchase,rate_term,cash_out}' check (cardinality(purposes) > 0),
  terms_months       smallint[],
  amortizations      public.amortization_type[],
  prepay_options     text[],
  -- 2nd liens: does the matrix's loan-amount tier use the new 2nd alone or 1st + 2nd?
  loan_amount_basis  public.loan_amount_basis not null default 'this_lien',
  description        text,
  active             boolean not null default true,
  last_verified_on   date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Deleting a lender deletes its programs (blocked while a program is on a borrower file).
  constraint programs_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade,
  constraint programs_name_unique unique (lender_id, name),
  constraint programs_id_organization_id_key unique (id, organization_id)
);

create index if not exists programs_organization_idx on public.programs (organization_id, lien, product_family);

-- ---------------------------------------------------------------------------
-- guideline documents and passages
-- ---------------------------------------------------------------------------

create table if not exists public.guideline_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lender_id        uuid not null,
  doc_type         public.guideline_doc_type not null,
  title            text not null check (length(trim(title)) > 0),
  -- Where the file lives in the private "guideline-files" bucket (set up in step 5).
  storage_path     text unique,
  version_label    text,
  effective_date   date,
  page_count       integer check (page_count > 0),
  sha256           text check (sha256 ~ '^[0-9a-f]{64}$'),
  current          boolean not null default true,
  uploaded_by      uuid default auth.uid(),
  uploaded_at      timestamptz not null default now(),
  constraint guideline_documents_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade,
  constraint guideline_documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles (id) on delete set null,
  -- The same file can't be uploaded twice for a lender.
  constraint guideline_documents_same_file unique (lender_id, sha256),
  constraint guideline_documents_id_organization_id_key unique (id, organization_id)
);

create table if not exists public.guideline_document_programs (
  document_id      uuid not null,
  program_id       uuid not null,
  organization_id  uuid not null,
  primary key (document_id, program_id),
  constraint guideline_document_programs_document_id_fkey
    foreign key (document_id, organization_id) references public.guideline_documents (id, organization_id) on delete cascade,
  constraint guideline_document_programs_program_id_fkey
    foreign key (program_id, organization_id) references public.programs (id, organization_id) on delete cascade
);

create table if not exists public.guideline_passages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  document_id      uuid not null,
  position         integer not null check (position >= 0),
  page             integer not null check (page > 0),
  section_number   text,
  heading          text,
  body             text not null check (length(trim(body)) > 0),
  search           tsvector generated always as (to_tsvector('english', coalesce(heading, '') || ' ' || body)) stored,
  constraint guideline_passages_document_id_fkey
    foreign key (document_id, organization_id) references public.guideline_documents (id, organization_id) on delete cascade,
  constraint guideline_passages_position_unique unique (document_id, position)
);

create index if not exists guideline_passages_search_idx on public.guideline_passages using gin (search);

-- ---------------------------------------------------------------------------
-- matrix versions and cells
-- ---------------------------------------------------------------------------

create table if not exists public.matrix_versions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  program_id          uuid not null,
  version             integer not null check (version > 0),
  status              public.matrix_version_status not null default 'draft',
  effective_date      date,
  source_document_id  uuid,
  extracted_by        public.extracted_by not null default 'manual',
  ai_run_id           uuid,
  notes               text,
  approved_by         uuid,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint matrix_versions_program_id_fkey
    foreign key (program_id, organization_id) references public.programs (id, organization_id) on delete cascade,
  constraint matrix_versions_source_document_id_fkey
    foreign key (source_document_id, organization_id) references public.guideline_documents (id, organization_id) on delete set null (source_document_id),
  constraint matrix_versions_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint matrix_versions_approved_by_fkey
    foreign key (approved_by) references public.profiles (id) on delete set null,
  constraint matrix_versions_version_unique unique (program_id, version),
  constraint matrix_versions_approval check (status = 'draft' or approved_at is not null),
  constraint matrix_versions_id_organization_id_key unique (id, organization_id)
);

-- Searches use the one approved version of each program.
create unique index if not exists matrix_versions_one_approved_idx on public.matrix_versions (program_id) where status = 'approved';

create table if not exists public.program_matrix_cells (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  matrix_version_id   uuid not null,
  occupancy           public.occupancy not null,
  -- A merged column header ("Purchase & R/T", "SFR/PUD & Condo") is one cell covering each listed value.
  property_types      public.matrix_property_type[] not null check (cardinality(property_types) > 0),
  purposes            public.matrix_purpose[] not null check (cardinality(purposes) > 0),
  doc_type            public.product_doc_type not null,
  units_min           smallint not null default 1 check (units_min between 1 and 4),
  units_max           smallint not null default 4 check (units_max between 1 and 4),
  fico_min            smallint not null check (fico_min between 300 and 850),
  fico_max            smallint not null default 850 check (fico_max between 300 and 850),
  loan_amount_min     numeric(14, 2) not null default 0 check (loan_amount_min >= 0),
  loan_amount_max     numeric(14, 2) check (loan_amount_max > 0),
  dscr_min            numeric(5, 2) check (dscr_min >= 0),
  citizenship         public.product_citizenship,
  -- A blank cell in the lender's grid ("—", "N/A") is stored with offered = false and no limits.
  offered             boolean not null default true,
  max_ltv             numeric(6, 3) check (max_ltv > 0 and max_ltv <= 100),
  max_cltv            numeric(6, 3) check (max_cltv > 0 and max_cltv <= 100),
  max_dti             numeric(5, 2) check (max_dti > 0 and max_dti <= 100),
  reserves_months     smallint check (reserves_months >= 0),
  notes               text,
  source_document_id  uuid,
  source_page         integer check (source_page > 0),
  extracted_by        public.extracted_by not null default 'manual',
  approved_by         uuid,
  approved_at         timestamptz,
  constraint program_matrix_cells_version_fkey
    foreign key (matrix_version_id, organization_id) references public.matrix_versions (id, organization_id) on delete cascade,
  constraint program_matrix_cells_source_document_id_fkey
    foreign key (source_document_id, organization_id) references public.guideline_documents (id, organization_id) on delete set null (source_document_id),
  constraint program_matrix_cells_approved_by_fkey
    foreign key (approved_by) references public.profiles (id) on delete set null,
  constraint program_matrix_cells_bands check (fico_min <= fico_max and units_min <= units_max and (loan_amount_max is null or loan_amount_min <= loan_amount_max)),
  -- Offered cells have a limit; not-offered cells have none (so "—" can never be read as 0).
  constraint program_matrix_cells_offered check (
    (offered and (max_ltv is not null or max_cltv is not null))
    or (not offered and max_ltv is null and max_cltv is null and max_dti is null)
  )
);

create index if not exists program_matrix_cells_version_idx on public.program_matrix_cells (matrix_version_id);

-- ---------------------------------------------------------------------------
-- program rules and company overlays
-- ---------------------------------------------------------------------------

create table if not exists public.program_rules (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  program_id          uuid not null,
  -- Set when the rule came with a matrix import (it is versioned with the cells).
  matrix_version_id   uuid,
  field               public.rule_field not null,
  op                  public.rule_op not null,
  -- A number, a list, {"min": .., "max": ..} for between, or null for required.
  value               jsonb,
  -- Only applies when... e.g. {"purposes": ["cash_out"]} or {"ltv_above": 95}.
  applies_when        jsonb,
  severity            public.rule_severity not null default 'hard',
  message             text not null check (length(trim(message)) > 0),
  source_document_id  uuid,
  source_page         integer check (source_page > 0),
  source_quote        text,
  extracted_by        public.extracted_by not null default 'manual',
  approved_by         uuid,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint program_rules_program_id_fkey
    foreign key (program_id, organization_id) references public.programs (id, organization_id) on delete cascade,
  constraint program_rules_version_fkey
    foreign key (matrix_version_id, organization_id) references public.matrix_versions (id, organization_id) on delete cascade,
  constraint program_rules_source_document_id_fkey
    foreign key (source_document_id, organization_id) references public.guideline_documents (id, organization_id) on delete set null (source_document_id),
  constraint program_rules_approved_by_fkey
    foreign key (approved_by) references public.profiles (id) on delete set null,
  constraint program_rules_value_shape check (
    (op = 'required' and value is null)
    or (op in ('<=', '>=') and jsonb_typeof(value) = 'number')
    or (op in ('in', 'not_in') and jsonb_typeof(value) = 'array')
    or (op = 'between' and jsonb_typeof(value) = 'object' and value ? 'min' and value ? 'max')
  )
);

create index if not exists program_rules_program_idx on public.program_rules (program_id);

create table if not exists public.overlays (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  scope            public.overlay_scope not null default 'all',
  lender_id        uuid,
  program_id       uuid,
  field            public.rule_field not null,
  op               public.rule_op not null,
  value            jsonb,
  applies_when     jsonb,
  severity         public.rule_severity not null default 'hard',
  message          text not null check (length(trim(message)) > 0),
  active           boolean not null default true,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint overlays_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint overlays_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade,
  constraint overlays_program_id_fkey
    foreign key (program_id, organization_id) references public.programs (id, organization_id) on delete cascade,
  constraint overlays_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint overlays_scope_target check (
    (scope = 'all' and lender_id is null and program_id is null)
    or (scope = 'lender' and lender_id is not null and program_id is null)
    or (scope = 'program' and program_id is not null)
  ),
  constraint overlays_value_shape check (
    (op = 'required' and value is null)
    or (op in ('<=', '>=') and jsonb_typeof(value) = 'number')
    or (op in ('in', 'not_in') and jsonb_typeof(value) = 'array')
    or (op = 'between' and jsonb_typeof(value) = 'object' and value ? 'min' and value ? 'max')
  )
);

-- ---------------------------------------------------------------------------
-- Catalog permissions: everyone in the company reads, owners and admins edit.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lenders', 'programs', 'guideline_documents', 'guideline_document_programs', 'guideline_passages', 'matrix_versions', 'program_matrix_cells', 'program_rules', 'overlays'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members see %1$s" on public.%1$I', t);
    execute format('create policy "members see %1$s" on public.%1$I for select to authenticated using (public.is_org_member(organization_id))', t);
    execute format('drop policy if exists "managers add %1$s" on public.%1$I', t);
    execute format('create policy "managers add %1$s" on public.%1$I for insert to authenticated with check (public.is_org_manager(organization_id))', t);
    execute format('drop policy if exists "managers edit %1$s" on public.%1$I', t);
    execute format('create policy "managers edit %1$s" on public.%1$I for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id))', t);
    execute format('drop policy if exists "managers remove %1$s" on public.%1$I', t);
    execute format('create policy "managers remove %1$s" on public.%1$I for delete to authenticated using (public.is_org_manager(organization_id))', t);
  end loop;
end $$;

create or replace trigger lenders_set_updated_at before update on public.lenders for each row execute function public.set_updated_at();
create or replace trigger programs_set_updated_at before update on public.programs for each row execute function public.set_updated_at();
create or replace trigger program_rules_set_updated_at before update on public.program_rules for each row execute function public.set_updated_at();
create or replace trigger overlays_set_updated_at before update on public.overlays for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- product_searches: each search, for Recent searches and accuracy checks
-- ---------------------------------------------------------------------------

create table if not exists public.product_searches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid default auth.uid(),
  -- The borrower file it was run for, if any; deleting the loan keeps the search.
  loan_id          uuid,
  source           text not null default 'form' check (source in ('form', 'assistant')),
  scenario         jsonb not null,
  searched_count   integer not null default 0 check (searched_count >= 0),
  not_searched_count integer not null default 0 check (not_searched_count >= 0),
  -- Eligible and ineligible program ids with the cell / rule each traced to.
  results          jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  constraint product_searches_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint product_searches_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete set null,
  constraint product_searches_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id),
  constraint product_searches_id_organization_id_key unique (id, organization_id)
);

create index if not exists product_searches_user_idx on public.product_searches (user_id, created_at desc);

alter table public.product_searches enable row level security;
drop policy if exists "users see their own searches" on public.product_searches;
create policy "users see their own searches" on public.product_searches
  for select to authenticated using (user_id = auth.uid() and public.is_org_member(organization_id));
drop policy if exists "users log their own searches" on public.product_searches;
create policy "users log their own searches" on public.product_searches
  for insert to authenticated with check (user_id = auth.uid() and public.is_org_member(organization_id) and (loan_id is null or public.can_see_loan(loan_id)));

-- ---------------------------------------------------------------------------
-- Borrower shortlist and quotes
-- ---------------------------------------------------------------------------

create table if not exists public.loan_program_options (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  program_id       uuid not null,
  search_id        uuid,
  status           public.program_option_status not null default 'shortlisted',
  sort_order       integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint loan_program_options_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  -- A program on a borrower file can't be deleted (retire it instead), so quote history is kept.
  constraint loan_program_options_program_id_fkey
    foreign key (program_id, organization_id) references public.programs (id, organization_id) on delete restrict,
  constraint loan_program_options_search_id_fkey
    foreign key (search_id, organization_id) references public.product_searches (id, organization_id) on delete set null (search_id),
  constraint loan_program_options_one_per_program unique (loan_id, program_id),
  constraint loan_program_options_id_loan_id_key unique (id, loan_id)
);

create table if not exists public.loan_quotes (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null,
  loan_id                uuid not null,
  option_id              uuid not null,
  -- The TBD scenario or the home this quote prices.
  pricing_scenario_id    uuid not null,
  rate                   numeric(6, 3) not null check (rate > 0 and rate <= 30),
  lock_days              smallint check (lock_days between 0 and 365),
  -- Points (+) or price/credit (−) as a percent of the loan.
  points_pct             numeric(6, 3) not null default 0 check (points_pct between -10 and 10),
  lender_credit          numeric(12, 2) not null default 0 check (lender_credit >= 0),
  -- Total closing costs including points, typed; or worked out from the scenario's fee sheet.
  closing_costs          numeric(12, 2) check (closing_costs >= 0),
  closing_costs_from_fee_sheet boolean not null default false,
  monthly_mi             numeric(10, 2) check (monthly_mi >= 0),
  quote_date             date not null default current_date,
  source                 public.quote_source not null default 'manual',
  -- The lender's quote PDF on the file, when uploaded.
  document_id            uuid,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint loan_quotes_option_id_fkey
    foreign key (option_id, loan_id) references public.loan_program_options (id, loan_id) on delete cascade,
  constraint loan_quotes_pricing_scenario_id_fkey
    foreign key (pricing_scenario_id, loan_id) references public.pricing_scenarios (id, loan_id) on delete cascade,
  constraint loan_quotes_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_quotes_document_id_fkey
    foreign key (document_id) references public.loan_documents (id) on delete set null,
  constraint loan_quotes_closing_costs check (closing_costs is not null or closing_costs_from_fee_sheet),
  constraint loan_quotes_one_per_scenario unique (option_id, pricing_scenario_id),
  constraint loan_quotes_id_loan_id_key unique (id, loan_id)
);

do $$
declare t text;
begin
  foreach t in array array['loan_program_options', 'loan_quotes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members see %1$s on permitted loans" on public.%1$I', t);
    execute format('create policy "members see %1$s on permitted loans" on public.%1$I for select to authenticated using (public.can_see_loan(loan_id))', t);
    execute format('drop policy if exists "members add %1$s on permitted loans" on public.%1$I', t);
    execute format('create policy "members add %1$s on permitted loans" on public.%1$I for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id))', t);
    execute format('drop policy if exists "members edit %1$s on permitted loans" on public.%1$I', t);
    execute format('create policy "members edit %1$s on permitted loans" on public.%1$I for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id))', t);
    execute format('drop policy if exists "members remove %1$s on permitted loans" on public.%1$I', t);
    execute format('create policy "members remove %1$s on permitted loans" on public.%1$I for delete to authenticated using (public.can_see_loan(loan_id))', t);
  end loop;
end $$;

create or replace trigger loan_program_options_set_updated_at before update on public.loan_program_options for each row execute function public.set_updated_at();
create or replace trigger loan_quotes_set_updated_at before update on public.loan_quotes for each row execute function public.set_updated_at();

-- What was chosen for the loan; deleting the program or quote just clears the choice.
alter table public.loans
  add column if not exists program_id       uuid,
  add column if not exists chosen_quote_id  uuid;
do $$ begin
  alter table public.loans add constraint loans_program_id_fkey
    foreign key (program_id, organization_id) references public.programs (id, organization_id) on delete set null (program_id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.loans add constraint loans_chosen_quote_id_fkey
    foreign key (chosen_quote_id, id) references public.loan_quotes (id, loan_id) on delete set null (chosen_quote_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite product search installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('lenders', 'programs', 'guideline_documents', 'guideline_document_programs', 'guideline_passages', 'matrix_versions',
                        'program_matrix_cells', 'program_rules', 'overlays', 'product_searches', 'loan_program_options', 'loan_quotes')) as new_tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans'
     and column_name in ('program_id', 'chosen_quote_id')) as loan_columns;
