-- MPS HQ: custom document requests and borrower upload links (UI pass
-- Part 3; plan docs/plans/document-requests.md, approved 2026-11-11).
--
-- Built on what's there (no second system):
--   document_requests          the Documents tab checklist rows ARE the request
--                              items; they gain instructions, a catalog key, an
--                              optional condition, the upload link they went
--                              out on, a due date and a reject reason. Status:
--                              requested → received (uploaded) → reviewed
--                              (accepted), or the new rejected (back on the
--                              borrower's page), or waived.
--   loan_documents             + document_request_id: an upload made for an item
--                              (one item can have several files)
--   document_catalog           the company's list of documents to ask for
--                              (Settings → Document catalog), seeded; items that
--                              match a checklist rule use the rule's key
--   document_upload_links      one link per borrower per send: a 64-character
--                              token stored only as a hash, 14 days by default,
--                              the email-check session (hashed) and when sent
--   document_link_events       every email check, open and upload (the
--                              guessing limit and the record)
--   document_request_presets   saved item lists ("W-2 starter"…)
-- The borrower page (/u/{link}) talks only to the document-upload Edge
-- Function (service role). Nothing is sent from here: drafts go to the
-- Action Queue. Apply after the suggested conditions script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ document upload links installed").

-- ---------------------------------------------------------------------------
-- Upload links
-- ---------------------------------------------------------------------------

create table if not exists public.document_upload_links (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  loan_id             uuid not null,
  contact_id          uuid not null,
  -- sha-256 of the token in the link (the token itself is never stored).
  token_hash          text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at          timestamptz not null default now() + interval '14 days',
  revoked_at          timestamptz,
  due_on              date,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  first_opened_at     timestamptz,
  last_opened_at      timestamptz,
  session_hash        text,
  session_expires_at  timestamptz,
  constraint document_upload_links_token_key unique (token_hash),
  constraint document_upload_links_expiry check (expires_at > created_at and expires_at <= created_at + interval '90 days'),
  constraint document_upload_links_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint document_upload_links_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint document_upload_links_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index if not exists document_upload_links_loan_idx on public.document_upload_links (loan_id, created_at desc);

alter table public.document_upload_links enable row level security;
drop policy if exists "people on the file see upload links" on public.document_upload_links;
create policy "people on the file see upload links" on public.document_upload_links
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "people on the file make upload links" on public.document_upload_links;
create policy "people on the file make upload links" on public.document_upload_links
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "people on the file update upload links" on public.document_upload_links;
create policy "people on the file update upload links" on public.document_upload_links
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));

-- In the app only revoking, the due date and "sent" change; opens and sessions come from the Edge Function.
create or replace function public.guard_document_upload_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
    (new.token_hash, new.loan_id, new.contact_id, new.expires_at, new.first_opened_at, new.last_opened_at, new.session_hash, new.session_expires_at)
    is distinct from
    (old.token_hash, old.loan_id, old.contact_id, old.expires_at, old.first_opened_at, old.last_opened_at, old.session_hash, old.session_expires_at)
  ) then
    raise exception 'An upload link can only be revoked or have its due date changed. Send a new link instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists document_upload_links_guard on public.document_upload_links;
create trigger document_upload_links_guard before update on public.document_upload_links
  for each row execute function public.guard_document_upload_link();

create table if not exists public.document_link_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  link_id          uuid not null,
  kind             text not null check (kind in ('email_ok', 'email_wrong', 'locked', 'opened', 'upload', 'expired')),
  created_at       timestamptz not null default now(),
  constraint document_link_events_link_id_fkey
    foreign key (link_id) references public.document_upload_links (id) on delete cascade,
  constraint document_link_events_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade
);

create index if not exists document_link_events_link_idx on public.document_link_events (link_id, created_at desc);
alter table public.document_link_events enable row level security;
drop policy if exists "people on the file see link events" on public.document_link_events;
create policy "people on the file see link events" on public.document_link_events
  for select to authenticated using (exists (select 1 from public.document_upload_links l where l.id = link_id and public.can_see_loan(l.loan_id)));
revoke insert, update, delete on public.document_link_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Request items: the existing checklist rows, extended
-- ---------------------------------------------------------------------------

alter type public.document_request_status add value if not exists 'rejected';

alter table public.document_requests
  add column if not exists instructions   text,
  add column if not exists catalog_key    text,
  add column if not exists condition_id   uuid,
  add column if not exists link_id        uuid,
  add column if not exists due_on         date,
  add column if not exists reject_reason  text,
  add column if not exists rejected_at    timestamptz;

alter table public.document_requests drop constraint if exists document_requests_condition_id_fkey;
alter table public.document_requests add constraint document_requests_condition_id_fkey
  foreign key (condition_id) references public.loan_conditions (id) on delete set null;
alter table public.document_requests drop constraint if exists document_requests_link_id_fkey;
alter table public.document_requests add constraint document_requests_link_id_fkey
  foreign key (link_id) references public.document_upload_links (id) on delete set null;

-- A condition follows its items: the request a suggestion linked (Phase 8),
-- or, now, every item linked to the condition. Once they're all in
-- (received or accepted), an outstanding or requested condition moves to
-- Received. One way only; it never clears a condition.
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
    if new.condition_id is not null and not exists (
      select 1 from public.document_requests r
       where r.condition_id = new.condition_id and r.id <> new.id and r.status not in ('received', 'reviewed', 'waived')
    ) then
      update public.loan_conditions
         set status = 'received'
       where id = new.condition_id
         and status in ('outstanding', 'requested');
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.condition_follows_request() from public, anon;

-- Uploads made for an item (several files per item).
alter table public.loan_documents add column if not exists document_request_id uuid;
alter table public.loan_documents drop constraint if exists loan_documents_document_request_id_fkey;
alter table public.loan_documents add constraint loan_documents_document_request_id_fkey
  foreign key (document_request_id) references public.document_requests (id) on delete set null;
create index if not exists loan_documents_request_idx on public.loan_documents (document_request_id);

-- ---------------------------------------------------------------------------
-- The document catalog (Settings) and saved presets
-- ---------------------------------------------------------------------------

create table if not exists public.document_catalog (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  key              text not null check (key ~ '^[a-z0-9_]+$'),
  category         text not null check (category in ('income', 'assets', 'credit', 'property', 'other')),
  label            text not null check (length(trim(label)) > 0),
  instructions     text not null default '',
  period           text,
  kind             public.document_kind not null default 'other',
  sort_order       integer not null default 100,
  active           boolean not null default true,
  built_in         boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint document_catalog_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint document_catalog_key_unique unique (organization_id, key)
);

drop trigger if exists document_catalog_set_updated_at on public.document_catalog;
create trigger document_catalog_set_updated_at before update on public.document_catalog
  for each row execute function public.set_updated_at();

alter table public.document_catalog enable row level security;
drop policy if exists "members see the catalog" on public.document_catalog;
create policy "members see the catalog" on public.document_catalog
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add catalog items" on public.document_catalog;
create policy "managers add catalog items" on public.document_catalog
  for insert to authenticated with check (public.is_org_manager(organization_id) and not built_in);
drop policy if exists "managers edit catalog items" on public.document_catalog;
create policy "managers edit catalog items" on public.document_catalog
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
drop policy if exists "managers remove their catalog items" on public.document_catalog;
create policy "managers remove their catalog items" on public.document_catalog
  for delete to authenticated using (public.is_org_manager(organization_id) and not built_in);

-- The starter catalog. Keys shared with checklist rules (paystubs, w2s,
-- bank_statements…) mark the same document, so a request and a suggestion
-- are recognized as one item.
create or replace function public.seed_document_catalog(org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.document_catalog (organization_id, key, category, label, instructions, period, kind, sort_order, built_in)
  values
    (org, 'paystubs', 'income', 'Pay stubs', 'Your most recent pay stubs covering the last 30 days, from each job.', '30 days', 'paystub', 10, true),
    (org, 'w2s', 'income', 'W-2s', 'W-2s from every employer for the last 2 years.', '2 years', 'w2', 20, true),
    (org, 'forms_1099', 'income', '1099s', '1099s for the last 2 years.', '2 years', 'form_1099', 30, true),
    (org, 'tax_returns', 'income', 'Tax returns (1040s)', 'Your personal tax returns (1040s) for the last 2 years, all pages and schedules.', '2 years', 'tax_return', 40, true),
    (org, 'business_returns', 'income', 'Business tax returns', 'Business tax returns (1120S or 1065 with K-1s) for the last 2 years, all pages.', '2 years', 'business_return', 50, true),
    (org, 'pl', 'income', 'Year-to-date P&L', 'A year-to-date profit and loss statement for your business.', 'Year to date', 'profit_loss', 60, true),
    (org, 'award', 'income', 'Award or benefit letter', 'Your current award letter (Social Security, pension or VA benefits).', 'Current year', 'award_letter', 70, true),
    (org, 'voe_contact', 'income', 'Employer contact for verification', 'The name, phone and email of someone at your employer (HR or payroll) who can verify your job.', null, 'other', 80, true),
    (org, 'bank_statements', 'assets', 'Bank statements', 'Your last 2 months of statements for each bank account, all pages (even blank ones).', '2 months', 'bank_statement', 110, true),
    (org, 'investment_statements', 'assets', 'Retirement or brokerage statements', 'Your most recent statement for each retirement or investment account, all pages.', 'Latest', 'investment_statement', 120, true),
    (org, 'gift_letter', 'assets', 'Gift letter', 'The signed gift letter (I''ll send you the form) from the person giving the gift.', null, 'gift_letter', 130, true),
    (org, 'gift_proof', 'assets', 'Proof of gift funds', 'Proof the gift moved: the donor''s statement showing it leaving and yours showing it arrive, or the wire to title.', null, 'bank_statement', 140, true),
    (org, 'cond_earnest_money', 'assets', 'Earnest money proof', 'Proof the earnest money cleared (cancelled check or wire confirmation) and a statement for the account it came from.', null, 'bank_statement', 150, true),
    (org, 'large_deposit_loe', 'assets', 'Letter about large deposits', 'A short signed letter explaining where each large deposit came from, with proof if you have it.', null, 'explanation_letter', 160, true),
    (org, 'id', 'credit', 'Driver''s license or ID', 'A clear photo of the front of your driver''s license or other government ID.', null, 'photo_id', 210, true),
    (org, 'ss_card', 'credit', 'Social Security card', 'A photo of your Social Security card, only if your lender asks for it.', null, 'other', 220, true),
    (org, 'credit_inquiry_loe', 'credit', 'Letter about credit inquiries', 'A short signed letter explaining each recent credit inquiry and whether it opened a new account.', null, 'explanation_letter', 230, true),
    (org, 'divorce_decree', 'credit', 'Divorce decree', 'Your full divorce decree, including any settlement agreement.', null, 'divorce_decree', 240, true),
    (org, 'support_order', 'credit', 'Child support order', 'The court order for child support or alimony.', null, 'divorce_decree', 250, true),
    (org, 'bankruptcy', 'credit', 'Bankruptcy discharge', 'Your bankruptcy discharge papers, with the schedule of debts.', null, 'bankruptcy_papers', 260, true),
    (org, 'cond_purchase_contract', 'property', 'Executed contract and addenda', 'The fully signed purchase contract and every addendum.', null, 'purchase_contract', 310, true),
    (org, 'cond_hoi_quote', 'property', 'Homeowners insurance', 'Your homeowners insurance quote or declarations page, with the agent''s name, phone and email.', null, 'other', 320, true),
    (org, 'cond_condo_hoa', 'property', 'HOA information', 'The HOA or management company''s name, phone and email, and your monthly dues.', null, 'other', 330, true),
    (org, 'leases', 'property', 'Lease agreements', 'The current signed lease for each home you rent out.', null, 'lease', 340, true),
    (org, 'home_statements', 'property', 'Mortgage statements for homes you own', 'The latest mortgage statement for each home you own.', 'Latest', 'mortgage_statement', 350, true),
    (org, 'loe', 'other', 'Letter of explanation', 'A short signed letter explaining:', null, 'explanation_letter', 410, true)
  on conflict (organization_id, key) do nothing;
$$;

revoke all on function public.seed_document_catalog(uuid) from public, anon, authenticated;

create or replace function public.seed_new_org_document_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_document_rules(new.id);
  perform public.seed_condition_rules(new.id);
  perform public.seed_document_catalog(new.id);
  return new;
end;
$$;

select public.seed_document_catalog(id) from public.organizations;

create table if not exists public.document_request_presets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null check (length(trim(name)) > 0),
  -- [{ "key": "paystubs" } | { "label": "...", "instructions": "..." }]
  items            jsonb not null check (jsonb_typeof(items) = 'array'),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint document_request_presets_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint document_request_presets_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint document_request_presets_name_unique unique (organization_id, name)
);

alter table public.document_request_presets enable row level security;
drop policy if exists "members see presets" on public.document_request_presets;
create policy "members see presets" on public.document_request_presets
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "members add presets" on public.document_request_presets;
create policy "members add presets" on public.document_request_presets
  for insert to authenticated with check (public.is_org_member(organization_id));
drop policy if exists "makers and managers remove presets" on public.document_request_presets;
create policy "makers and managers remove presets" on public.document_request_presets
  for delete to authenticated using (created_by = auth.uid() or public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ document upload links installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('document_upload_links', 'document_link_events', 'document_catalog', 'document_request_presets')) as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'document_requests'
     and column_name in ('instructions', 'catalog_key', 'condition_id', 'link_id', 'due_on', 'reject_reason', 'rejected_at')) as item_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loan_documents' and column_name = 'document_request_id') as upload_column,
  (select count(*) from public.document_catalog where built_in) > 0 as catalog_seeded,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_request_status' and e.enumlabel = 'rejected') as rejected_status;
