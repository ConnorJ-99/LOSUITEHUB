-- MPS HQ: suggested conditions on each file (build plan Phase 8; plan
-- docs/plans/suggested-conditions.md, approved 2026-11-11).
--
-- One rule list in Settings feeds both the borrower document checklist and
-- the Conditions tab's suggestions:
--   document_rules      + "Applies when" filters (loan type, purpose,
--                         occupancy, property type, income documentation,
--                         Texas cash-out, entity vesting, VA exempt, a lender
--                         or program), who it's on (party), when it's needed
--                         (stage), whether it's per person or once per file
--                         (scope), and "use for" (checklist and conditions,
--                         or conditions only). Existing rules keep working as
--                         they do: no filters, per person, both.
--   starter rules       the Phase 8 condition rules, "conditions only",
--                       built in (editable, can be turned off)
--   loan_conditions     + source_key (the suggestion it came from, once per
--                         loan) and document_request_id (the matching request)
--   condition_dismissals  a suggestion dismissed on a file (undo = delete)
--   program_rules       three new optional fields: bank statement months,
--                       asset statement months, tax return years (typed by
--                       hand with a citation)
--   a trigger           a request marked received or reviewed moves its
--                       linked condition to received (one way only)
-- Suggestions themselves are worked out in the app and never stored.
-- Apply after the estimate shares script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ suggested conditions installed").

-- ---------------------------------------------------------------------------
-- Rules: Applies when, party, stage, scope, use for
-- ---------------------------------------------------------------------------

alter table public.document_rules
  add column if not exists use_for           text not null default 'both',
  add column if not exists scope             text not null default 'person',
  add column if not exists party             public.condition_party not null default 'borrower',
  add column if not exists stage             text not null default 'processing',
  add column if not exists mortgage_types    public.mortgage_type[],
  add column if not exists purposes          public.loan_purpose[],
  add column if not exists occupancies       public.occupancy[],
  add column if not exists property_types    public.property_type[],
  add column if not exists income_doc_types  public.income_doc_type[],
  add column if not exists texas_cash_out    boolean,
  add column if not exists entity_vesting    boolean,
  add column if not exists va_exempt         boolean,
  add column if not exists lender_id         uuid,
  add column if not exists program_id        uuid;

alter table public.document_rules drop constraint if exists document_rules_use_for_check;
alter table public.document_rules add constraint document_rules_use_for_check check (use_for in ('both', 'conditions'));
alter table public.document_rules drop constraint if exists document_rules_scope_check;
alter table public.document_rules add constraint document_rules_scope_check check (scope in ('person', 'file'));
alter table public.document_rules drop constraint if exists document_rules_stage_check;
alter table public.document_rules add constraint document_rules_stage_check check (stage in ('application', 'processing', 'before_closing'));
alter table public.document_rules drop constraint if exists document_rules_lender_id_fkey;
alter table public.document_rules add constraint document_rules_lender_id_fkey
  foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade;
alter table public.document_rules drop constraint if exists document_rules_program_id_fkey;
alter table public.document_rules add constraint document_rules_program_id_fkey
  foreign key (program_id) references public.programs (id) on delete cascade;

-- The Phase 8 starter rules: conditions only, built in. {months} and {years}
-- are filled from the selected program's rule when it has one.
create or replace function public.seed_condition_rules(org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.document_rules (organization_id, key, condition, short_text, full_text, kind, sort_order, built_in, use_for, scope, party, stage, purposes, mortgage_types, property_types, occupancies, income_doc_types, texas_cash_out, entity_vesting, va_exempt)
  values
    (org, 'cond_purchase_contract', 'everyone', 'executed contract and addenda', 'Fully executed purchase contract and all addenda', 'purchase_contract', 300, true, 'conditions', 'file', 'realtor', 'processing', '{purchase}', null, null, null, null, null, null, null),
    (org, 'cond_earnest_money', 'everyone', 'earnest money proof', 'Proof the earnest money cleared (cancelled check or wire confirmation) and a statement for the account it came from', 'bank_statement', 310, true, 'conditions', 'file', 'borrower', 'processing', '{purchase}', null, null, null, null, null, null, null),
    (org, 'cond_hoi_quote', 'everyone', 'homeowners insurance quote', 'Homeowners insurance quote and the agent''s name, phone and email', 'other', 320, true, 'conditions', 'file', 'borrower', 'processing', '{purchase}', null, null, null, null, null, null, null),
    (org, 'cond_refi_statement', 'everyone', 'current mortgage statement', 'The latest mortgage statement for the home being refinanced', 'mortgage_statement', 330, true, 'conditions', 'file', 'borrower', 'application', '{refinance_rate_term,refinance_cash_out,investment_dscr}', null, null, null, null, null, null, null),
    (org, 'cond_refi_dec_page', 'everyone', 'insurance declarations page', 'The homeowners insurance declarations page for the home being refinanced', 'other', 340, true, 'conditions', 'file', 'borrower', 'processing', '{refinance_rate_term,refinance_cash_out,investment_dscr}', null, null, null, null, null, null, null),
    (org, 'cond_payoff_auth', 'everyone', 'payoff authorization', 'Signed payoff authorization for the current mortgage', 'other', 350, true, 'conditions', 'file', 'borrower', 'processing', '{refinance_rate_term,refinance_cash_out,investment_dscr}', null, null, null, null, null, null, null),
    (org, 'cond_tx_12_day', 'everyone', 'confirm 12-day notice', 'Confirm the Texas 12-day notice was delivered and the earliest sign-off date', 'other', 360, true, 'conditions', 'file', 'processor_lo', 'application', null, null, null, null, null, true, null, null),
    (org, 'cond_tx_prior_equity', 'everyone', 'prior home-equity loan info', 'Details of any home-equity loan on this home in the last 12 months, if there was one', 'other', 370, true, 'conditions', 'file', 'borrower', 'processing', null, null, null, null, null, true, null, null),
    (org, 'cond_tx_survey', 'everyone', 'homestead survey', 'Survey of the homestead, if the title company requires one', 'other', 380, true, 'conditions', 'file', 'title', 'before_closing', null, null, null, null, null, true, null, null),
    (org, 'cond_first_lien', 'everyone', 'first-lien mortgage statement', 'The latest statement for the first mortgage on the home', 'mortgage_statement', 390, true, 'conditions', 'file', 'borrower', 'application', '{heloc,heloan}', null, null, null, null, null, null, null),
    (org, 'cond_va_coe', 'everyone', 'Certificate of Eligibility', 'VA Certificate of Eligibility', 'other', 400, true, 'conditions', 'person', 'processor_lo', 'application', null, '{va}', null, null, null, null, null, null),
    (org, 'cond_va_dd214', 'everyone', 'DD-214 or statement of service', 'DD-214, or a statement of service if still serving', 'other', 410, true, 'conditions', 'person', 'borrower', 'application', null, '{va}', null, null, null, null, null, null),
    (org, 'cond_va_exempt_letter', 'everyone', 'funding-fee exemption letter', 'VA disability award or funding-fee exemption letter', 'award_letter', 420, true, 'conditions', 'person', 'borrower', 'processing', null, '{va}', null, null, null, null, null, true),
    (org, 'cond_usda_household', 'everyone', 'household income', 'Income documents for every adult in the household, including anyone not on the loan', 'other', 430, true, 'conditions', 'file', 'borrower', 'processing', null, '{usda_rural}', null, null, null, null, null, null),
    (org, 'cond_condo_hoa', 'everyone', 'HOA contact for the questionnaire', 'HOA or management company contact, for the condo questionnaire', 'other', 440, true, 'conditions', 'file', 'title', 'processing', null, null, '{condo}', null, null, null, null, null),
    (org, 'cond_condo_master', 'everyone', 'master insurance policy', 'The condo association''s master insurance policy', 'other', 450, true, 'conditions', 'file', 'title', 'processing', null, null, '{condo}', null, null, null, null, null),
    (org, 'cond_rent_schedule', 'everyone', 'leases or rent schedule', 'Current leases for the property, or the appraiser''s rent schedule', 'lease', 460, true, 'conditions', 'file', 'borrower', 'processing', null, null, null, '{investment}', null, null, null, null),
    (org, 'cond_llc_docs', 'everyone', 'LLC documents', 'For the LLC: articles of organization, the operating agreement and the IRS EIN letter', 'other', 470, true, 'conditions', 'file', 'borrower', 'processing', null, null, null, null, null, null, true, null)
  on conflict (organization_id, key) do nothing;
$$;

revoke all on function public.seed_condition_rules(uuid) from public, anon, authenticated;

create or replace function public.seed_new_org_document_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_document_rules(new.id);
  perform public.seed_condition_rules(new.id);
  return new;
end;
$$;

select public.seed_condition_rules(id) from public.organizations;

-- ---------------------------------------------------------------------------
-- Conditions: where a suggestion came from, and its document request
-- ---------------------------------------------------------------------------

alter table public.loan_conditions
  add column if not exists source_key           text,
  add column if not exists document_request_id  uuid;

alter table public.loan_conditions drop constraint if exists loan_conditions_document_request_id_fkey;
alter table public.loan_conditions add constraint loan_conditions_document_request_id_fkey
  foreign key (document_request_id) references public.document_requests (id) on delete set null;
create unique index if not exists loan_conditions_source_key_unique on public.loan_conditions (loan_id, source_key) where source_key is not null;

create table if not exists public.condition_dismissals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  source_key       text not null check (length(trim(source_key)) > 0),
  dismissed_by     uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint condition_dismissals_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint condition_dismissals_dismissed_by_fkey
    foreign key (dismissed_by) references public.profiles (id) on delete set null,
  constraint condition_dismissals_once unique (loan_id, source_key)
);

alter table public.condition_dismissals enable row level security;
drop policy if exists "people on the file see dismissals" on public.condition_dismissals;
create policy "people on the file see dismissals" on public.condition_dismissals
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "people on the file dismiss" on public.condition_dismissals;
create policy "people on the file dismiss" on public.condition_dismissals
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "people on the file undo a dismissal" on public.condition_dismissals;
create policy "people on the file undo a dismissal" on public.condition_dismissals
  for delete to authenticated using (public.can_see_loan(loan_id));

-- A request marked received or reviewed moves its linked condition to
-- received, if it was still outstanding or requested. One way only.
create or replace function public.condition_follows_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('received', 'reviewed') and old.status is distinct from new.status then
    update public.loan_conditions
       set status = 'received'
     where document_request_id = new.id
       and status in ('outstanding', 'requested');
  end if;
  return new;
end;
$$;

revoke all on function public.condition_follows_request() from public, anon;
drop trigger if exists document_requests_condition_follows on public.document_requests;
create trigger document_requests_condition_follows after update of status on public.document_requests
  for each row execute function public.condition_follows_request();

-- ---------------------------------------------------------------------------
-- Program rules: statement months and tax return years (with a citation)
-- ---------------------------------------------------------------------------

alter type public.rule_field add value if not exists 'bank_statement_months';
alter type public.rule_field add value if not exists 'asset_statement_months';
alter type public.rule_field add value if not exists 'tax_return_years';

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ suggested conditions installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'document_rules'
     and column_name in ('use_for', 'scope', 'party', 'stage', 'mortgage_types', 'purposes', 'occupancies', 'property_types', 'income_doc_types', 'texas_cash_out', 'entity_vesting', 'va_exempt', 'lender_id', 'program_id')) as rule_columns,
  (select count(*) from public.document_rules where key like 'cond\_%') as starter_rules,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loan_conditions' and column_name in ('source_key', 'document_request_id')) as condition_columns,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'condition_dismissals') as dismissals,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'rule_field' and e.enumlabel in ('bank_statement_months', 'asset_statement_months', 'tax_return_years')) as program_fields;
