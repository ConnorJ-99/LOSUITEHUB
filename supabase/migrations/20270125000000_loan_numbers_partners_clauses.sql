-- MPS HQ partner requests, steps 1–3 (Connor, 2026-11-13).
--
-- 1. Loan numbers: loans.lender_loan_number, loans.title_file_number and the
--    lender picked on the file (loans.lender_id, for files without a program;
--    a program's lender still wins). arive_loan_number already exists.
-- 2. Insurance agents and title partners: partner kind 'insurance', team role
--    'insurance_agent', shared fields (role, more emails, office address,
--    preferred, email_domain worked out from the email), insurance fields
--    (agency, carriers, license #, lines) and title fields (escrow officer,
--    processor, underwriter, wire_verify_phone, last wire instructions).
--    partners.email_via_gmail: on by default for title and insurance, off for
--    everyone else. A Gmail partner is never linked to GoHighLevel and is
--    never texted (the database refuses both).
-- 3. Mortgagee clauses on lenders (name, address, insurance email / fax,
--    notes) and a per-loan override (loans.mortgagee_clause_override).
--
-- Safe to re-run. Ends with a confirmation row.

alter type public.partner_kind add value if not exists 'insurance';
alter type public.team_role add value if not exists 'insurance_agent';

-- ---------------------------------------------------------------------------
-- 1. Loan numbers
-- ---------------------------------------------------------------------------

alter table public.loans
  add column if not exists lender_loan_number        text,
  add column if not exists title_file_number         text,
  add column if not exists lender_id                 uuid,
  add column if not exists mortgagee_clause_override text;

do $$ begin
  alter table public.loans add constraint loans_lender_loan_number_check check (lender_loan_number is null or length(trim(lender_loan_number)) between 1 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.loans add constraint loans_title_file_number_check check (title_file_number is null or length(trim(title_file_number)) between 1 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.loans add constraint loans_mortgagee_clause_override_check check (mortgagee_clause_override is null or length(mortgagee_clause_override) <= 1000);
exception when duplicate_object then null; end $$;
-- Deleting a lender leaves the file without a picked lender.
do $$ begin
  alter table public.loans add constraint loans_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete set null (lender_id);
exception when duplicate_object then null; end $$;

-- Search and email matching look loans up by these numbers (letters and digits only).
create index if not exists loans_lender_loan_number_idx on public.loans (organization_id, (lower(regexp_replace(lender_loan_number, '[^A-Za-z0-9]', '', 'g')))) where lender_loan_number is not null;
create index if not exists loans_title_file_number_idx on public.loans (organization_id, (lower(regexp_replace(title_file_number, '[^A-Za-z0-9]', '', 'g')))) where title_file_number is not null;
create index if not exists loans_arive_loan_number_key_idx on public.loans (organization_id, (lower(regexp_replace(arive_loan_number, '[^A-Za-z0-9]', '', 'g')))) where arive_loan_number is not null;

-- ---------------------------------------------------------------------------
-- 2. Insurance and title partners
-- ---------------------------------------------------------------------------

alter table public.partners
  add column if not exists role                          text,
  add column if not exists extra_emails                  text[] not null default '{}',
  add column if not exists office_address                text,
  add column if not exists preferred                     boolean not null default false,
  add column if not exists email_via_gmail               boolean,
  -- Insurance agents
  add column if not exists agency                        text,
  add column if not exists carriers                      text[] not null default '{}',
  add column if not exists license_number                text,
  add column if not exists insurance_lines               text[] not null default '{}',
  -- Title / escrow
  add column if not exists escrow_officer_name           text,
  add column if not exists escrow_officer_email          text,
  add column if not exists processor_name                text,
  add column if not exists processor_email               text,
  add column if not exists title_underwriter             text,
  -- Typed by a person only, never filled from an email (wire fraud).
  add column if not exists wire_verify_phone             text,
  add column if not exists last_wire_instructions_doc_id uuid;

-- The company's email domain, for matching new emails from the same office.
-- Public mailboxes (gmail, yahoo…) never count.
do $$ begin
  alter table public.partners add column email_domain text generated always as (
    case
      when split_part(lower(trim(coalesce(email, ''))), '@', 2) in ('', 'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'att.net', 'sbcglobal.net', 'comcast.net')
        then null
      else split_part(lower(trim(email)), '@', 2)
    end
  ) stored;
exception when duplicate_column then null; end $$;
create index if not exists partners_email_domain_idx on public.partners (organization_id, email_domain) where email_domain is not null;

do $$ begin
  alter table public.partners add constraint partners_insurance_lines_check check (insurance_lines <@ array['home', 'auto', 'flood', 'umbrella']::text[]);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.partners add constraint partners_extra_emails_check check (cardinality(extra_emails) <= 10);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.partners add constraint partners_last_wire_doc_fkey
    foreign key (last_wire_instructions_doc_id) references public.loan_documents (id) on delete set null;
exception when duplicate_object then null; end $$;

-- Title and insurance email through Gmail unless someone turns it off.
update public.partners set email_via_gmail = (kind::text in ('title', 'insurance')) where email_via_gmail is null;
-- No default: a partner saved without a choice gets one by kind (below).
alter table public.partners alter column email_via_gmail drop default;

create or replace function public.partner_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.email_via_gmail is null then
    new.email_via_gmail := new.kind::text in ('title', 'insurance');
  end if;
  -- The wire callback number is typed by a person, never by a server process reading an email.
  if coalesce(current_setting('request.jwt.claims', true), '') <> ''
     and coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'role', '') = 'service_role'
     and new.wire_verify_phone is distinct from (case when tg_op = 'UPDATE' then old.wire_verify_phone end) then
    new.wire_verify_phone := case when tg_op = 'UPDATE' then old.wire_verify_phone end;
  end if;
  -- Gmail partners stay out of GoHighLevel.
  if new.email_via_gmail and (
       (new.ghl_contact_id is not null and new.ghl_contact_id is distinct from (case when tg_op = 'UPDATE' then old.ghl_contact_id end))
    or (new.ghl_opportunity_id is not null and new.ghl_opportunity_id is distinct from (case when tg_op = 'UPDATE' then old.ghl_opportunity_id end))) then
    raise exception '% emails through Gmail, so MPS HQ keeps them out of GoHighLevel.', new.name;
  end if;
  return new;
end;
$$;
revoke all on function public.partner_defaults() from public;
do $$ begin
  revoke all on function public.partner_defaults() from anon, authenticated;
exception when undefined_object then null; end $$;

drop trigger if exists partners_defaults on public.partners;
create trigger partners_defaults
  before insert or update on public.partners
  for each row execute function public.partner_defaults();

-- New team role: insurance agent (an insurance partner).
create or replace function public.partner_kind_for_role(p_role public.team_role)
returns public.partner_kind
language plpgsql
immutable
set search_path = ''
as $$
begin
  return case p_role::text
    when 'buyer_agent' then 'realtor'
    when 'listing_agent' then 'realtor'
    when 'title' then 'title'
    when 'escrow_officer' then 'title'
    when 'insurance_agent' then 'insurance'
  end::public.partner_kind;
end;
$$;
revoke all on function public.partner_kind_for_role(public.team_role) from public;
do $$ begin
  revoke all on function public.partner_kind_for_role(public.team_role) from anon, authenticated;
exception when undefined_object then null; end $$;

-- Gmail partners have no texting: a text approval for one is refused.
create or replace function public.guard_gmail_partner_send()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.partner_id is not null then
    select name into v_name from public.partners where id = new.partner_id and email_via_gmail;
    if found then
      raise exception '% emails through Gmail, so MPS HQ doesn''t send to them through GoHighLevel.', v_name;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_gmail_partner_send() from public;
do $$ begin
  revoke all on function public.guard_gmail_partner_send() from anon, authenticated;
exception when undefined_object then null; end $$;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'send_approvals' and column_name = 'partner_id') then
    drop trigger if exists send_approvals_gmail_partner on public.send_approvals;
    create trigger send_approvals_gmail_partner before insert on public.send_approvals
      for each row execute function public.guard_gmail_partner_send();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Mortgagee clauses on lenders
-- ---------------------------------------------------------------------------

alter table public.lenders
  add column if not exists clause_name           text,
  add column if not exists clause_address_line1  text,
  add column if not exists clause_address_line2  text,
  add column if not exists clause_city           text,
  add column if not exists clause_state          text,
  add column if not exists clause_zip            text,
  add column if not exists insurance_email       text,
  add column if not exists insurance_fax         text,
  add column if not exists clause_notes          text;

do $$ begin
  alter table public.lenders add constraint lenders_clause_state_check check (clause_state is null or clause_state ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ loan numbers, insurance & title partners and mortgagee clauses installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('lender_loan_number', 'title_file_number', 'lender_id', 'mortgagee_clause_override')) as loan_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'partners' and column_name in ('email_via_gmail', 'email_domain', 'wire_verify_phone', 'insurance_lines', 'escrow_officer_email')) as partner_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'lenders' and column_name like 'clause_%') as clause_columns,
  (select count(*) from public.partners where email_via_gmail) as gmail_partners,
  (select count(*) from public.partners where email_via_gmail and ghl_contact_id is not null) as gmail_partners_already_in_ghl;
