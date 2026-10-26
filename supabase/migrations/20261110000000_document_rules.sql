-- LOSuite: documents, part 7b (checklist rules and request tracking).
--
-- document_rules: the document checklist as rules each company can edit in
-- Settings ("Self-employed → 2 years of tax returns"). Every company starts
-- with LOSuite's starter list; built-in rules can be reworded or turned off,
-- custom ones can also be deleted.
-- document_requests: what's been asked for on a file and where it stands:
-- requested → received → reviewed (or waived), linked to the uploaded
-- document that satisfied it.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite document rules installed").

do $$ begin
  create type public.document_condition as enum (
    'everyone', 'wage_earner', 'self_employed', 'bank_statement_income', 'form_1099_income', 'asset_based_income',
    'award_income', 'support_income', 'bank_accounts', 'investment_accounts', 'gift',
    'bankruptcy', 'foreclosure', 'late_or_collection', 'owns_home', 'rental_or_dscr'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.document_request_status as enum ('requested', 'received', 'reviewed', 'waived');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- document_rules
-- ---------------------------------------------------------------------------

create table if not exists public.document_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  key              text not null check (key ~ '^[a-z0-9_]+$'),
  condition        public.document_condition not null,
  -- Short wording for texts ("pay stubs (last 30 days)") and full wording for
  -- emails. {income} becomes the income type for award letters; {each_job}
  -- becomes " from each job" when there's more than one job.
  short_text       text not null check (length(trim(short_text)) > 0),
  full_text        text not null check (length(trim(full_text)) > 0),
  -- The document type that satisfies it.
  kind             public.document_kind not null default 'other',
  sort_order       integer not null default 100,
  active           boolean not null default true,
  built_in         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint document_rules_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint document_rules_key_unique unique (organization_id, key)
);

create or replace trigger document_rules_set_updated_at
  before update on public.document_rules
  for each row execute function public.set_updated_at();

-- LOSuite's starter checklist. Existing rules (and Connor's edits) are kept.
create or replace function public.seed_document_rules(org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.document_rules (organization_id, key, condition, short_text, full_text, kind, sort_order, built_in)
  values
    (org, 'id',                     'everyone',              'a photo of your ID', 'A photo of your driver''s license or other ID', 'photo_id', 10, true),
    (org, 'bank_statements_income', 'bank_statement_income', 'business bank statements (12-24 months)', '12 to 24 months of business bank statements, all pages', 'bank_statement', 20, true),
    (org, 'business_proof',         'bank_statement_income', 'a CPA letter or business license', 'A CPA letter or business license showing at least 2 years in business', 'other', 30, true),
    (org, 'forms_1099',             'form_1099_income',      '1099s (2 years)', '1099s for the last 2 years', 'form_1099', 40, true),
    (org, 'asset_statements',       'asset_based_income',    'investment/retirement statements (3 months)', 'The last 3 months of statements for your investment and retirement accounts', 'investment_statement', 50, true),
    (org, 'paystubs',               'wage_earner',           'pay stubs (last 30 days)', 'Pay stubs covering the last 30 days{each_job}', 'paystub', 60, true),
    (org, 'w2s',                    'wage_earner',           'W-2s (2 years)', 'W-2s for the last 2 years', 'w2', 70, true),
    (org, 'tax_returns',            'self_employed',         'tax returns (2 years)', 'Personal tax returns for the last 2 years, all pages and schedules', 'tax_return', 80, true),
    (org, 'business_returns',       'self_employed',         'business returns (2 years)', 'Business tax returns for the last 2 years (1120S or 1065 with K-1s) if you own 25% or more', 'business_return', 90, true),
    (org, 'pl',                     'self_employed',         'a year-to-date P&L', 'A year-to-date profit and loss statement', 'profit_loss', 100, true),
    (org, 'award',                  'award_income',          '{income} award letter', 'Your {income} award letter', 'award_letter', 110, true),
    (org, 'support_order',          'support_income',        'divorce decree or support order', 'The divorce decree or court order, and proof of the last 6 months of payments received', 'divorce_decree', 120, true),
    (org, 'bank_statements',        'bank_accounts',         'bank statements (2 months)', 'The last 2 months of statements for each bank account, all pages', 'bank_statement', 130, true),
    (org, 'investment_statements',  'investment_accounts',   'investment/retirement statements', 'The latest statement for each investment or retirement account', 'investment_statement', 140, true),
    (org, 'gift_letter',            'gift',                  'a gift letter', 'A signed gift letter (I''ll send you the form) and proof of the transfer', 'gift_letter', 150, true),
    (org, 'bankruptcy',             'bankruptcy',            'bankruptcy discharge papers', 'Your bankruptcy discharge papers', 'bankruptcy_papers', 160, true),
    (org, 'foreclosure',            'foreclosure',           'foreclosure/short sale papers', 'The closing or completion papers for the foreclosure, short sale or deed in lieu', 'other', 170, true),
    (org, 'explanation',            'late_or_collection',    'a short letter about the late payment', 'A short letter explaining the late payment or collection', 'explanation_letter', 180, true),
    (org, 'home_statements',        'owns_home',             'mortgage statements and insurance for homes you own', 'For each home you own: the latest mortgage statement and the homeowners insurance declarations page', 'mortgage_statement', 190, true),
    (org, 'leases',                 'rental_or_dscr',        'current leases', 'A copy of the current lease for each rented home', 'lease', 200, true)
  on conflict (organization_id, key) do nothing;
$$;

create or replace function public.seed_new_org_document_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_document_rules(new.id);
  return new;
end;
$$;

create or replace trigger organizations_seed_document_rules
  after insert on public.organizations
  for each row execute function public.seed_new_org_document_rules();

select public.seed_document_rules(id) from public.organizations;

alter table public.document_rules enable row level security;

drop policy if exists "members see document rules" on public.document_rules;
create policy "members see document rules" on public.document_rules
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add document rules" on public.document_rules;
create policy "managers add document rules" on public.document_rules
  for insert to authenticated with check (public.is_org_manager(organization_id) and not built_in);
drop policy if exists "managers edit document rules" on public.document_rules;
create policy "managers edit document rules" on public.document_rules
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
-- Built-in rules are turned off, not deleted.
drop policy if exists "managers remove custom document rules" on public.document_rules;
create policy "managers remove custom document rules" on public.document_rules
  for delete to authenticated using (public.is_org_manager(organization_id) and not built_in);

-- ---------------------------------------------------------------------------
-- document_requests
-- ---------------------------------------------------------------------------

create table if not exists public.document_requests (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  -- Whose it is; null for file-wide items (homes they own, leases).
  contact_id       uuid,
  -- Which rule it came from (e.g. "paystubs", "award_social_security"), or a custom key.
  rule_key         text not null check (length(trim(rule_key)) > 0),
  label            text not null check (length(trim(label)) > 0),
  kind             public.document_kind not null default 'other',
  status           public.document_request_status not null default 'requested',
  requested_at     timestamptz not null default now(),
  received_at      timestamptz,
  reviewed_at      timestamptz,
  -- The uploaded document that satisfied it.
  document_id      uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its requests.
  constraint document_requests_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint document_requests_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id),
  constraint document_requests_document_id_fkey
    foreign key (document_id) references public.loan_documents (id) on delete set null,
  constraint document_requests_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint document_requests_received_has_date
    check (status not in ('received', 'reviewed') or received_at is not null),
  constraint document_requests_reviewed_has_date
    check (status <> 'reviewed' or reviewed_at is not null)
);

-- One request per item per person per file.
create unique index if not exists document_requests_one_per_item
  on public.document_requests (loan_id, coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid), rule_key);
create index if not exists document_requests_loan_id_idx on public.document_requests (loan_id);

create or replace trigger document_requests_set_updated_at
  before update on public.document_requests
  for each row execute function public.set_updated_at();

alter table public.document_requests enable row level security;

drop policy if exists "members see requests on permitted loans" on public.document_requests;
create policy "members see requests on permitted loans" on public.document_requests
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add requests on permitted loans" on public.document_requests;
create policy "members add requests on permitted loans" on public.document_requests
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members update requests on permitted loans" on public.document_requests;
create policy "members update requests on permitted loans" on public.document_requests
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members remove requests on permitted loans" on public.document_requests;
create policy "members remove requests on permitted loans" on public.document_requests
  for delete to authenticated using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite document rules installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from public.document_rules) as starter_rules;
