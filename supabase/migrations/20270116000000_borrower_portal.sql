-- MPS HQ: the borrower portal (Connor, 2026-11-12; plan docs/plans/borrower-portal.md).
--
-- The document upload link (/u/{token}) grows into a borrower portal: status,
-- documents, published letters and estimates, and "request numbers for a home".
--
-- 1. document_upload_links.kind: 'request' (a one-off document request, as
--    before: only the sha-256 of its token is kept) or 'portal' (one live
--    link per borrower per file). A portal link also keeps its token, readable
--    only by people who can see the file, so "Copy link" always works; the
--    database checks that the token matches its hash.
-- 2. loan_documents.published_at / published_by: "Publish to borrower" on a
--    pre-approval letter or an estimate PDF. Nothing shows in the portal
--    unless it's published.
-- 3. portal_property_requests: a home the borrower asked for numbers on.
--    Added only by submit_portal_request() (the document-upload Edge
--    Function, service role), which adds the home to the file and works out
--    whether the price or loan amount is over the saved Approval Limits.
--    People on the file move it Requested → In progress; publishing a letter
--    or estimate for that home marks it Ready.
-- 4. messaging_settings.portal_stage_messages: the one line shown under each
--    portal step (Settings → Borrower portal).
-- 5. Notifications: portal_request (a home request) and portal_upload (a
--    borrower uploaded a document), to the file's loan officer.
-- Apply after the loan limits script. Safe to run more than once. A full run
-- ends with a confirmation row ("MPS HQ borrower portal installed").

-- ---------------------------------------------------------------------------
-- 1. Portal links
-- ---------------------------------------------------------------------------

alter table public.document_upload_links
  add column if not exists kind  text not null default 'request',
  add column if not exists token text;

alter table public.document_upload_links drop constraint if exists document_upload_links_kind_check;
alter table public.document_upload_links add constraint document_upload_links_kind_check check (
  (kind = 'request' and token is null)
  or (kind = 'portal' and token ~ '^[0-9a-f]{64}$' and token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex'))
);

-- What the portal records about a link: also a PDF download and a home request.
alter table public.document_link_events drop constraint if exists document_link_events_kind_check;
alter table public.document_link_events add constraint document_link_events_kind_check
  check (kind in ('email_ok', 'email_wrong', 'locked', 'opened', 'upload', 'expired', 'pdf', 'home_request'));

-- One live portal link per borrower per file (Renew turns the old one off first).
create unique index if not exists document_upload_links_one_portal
  on public.document_upload_links (loan_id, contact_id) where kind = 'portal' and revoked_at is null;

-- In the app only revoking, the due date and "sent" change; opens and sessions come from the Edge Function.
create or replace function public.guard_document_upload_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
    (new.token_hash, new.token, new.kind, new.loan_id, new.contact_id, new.expires_at, new.first_opened_at, new.last_opened_at, new.session_hash, new.session_expires_at)
    is distinct from
    (old.token_hash, old.token, old.kind, old.loan_id, old.contact_id, old.expires_at, old.first_opened_at, old.last_opened_at, old.session_hash, old.session_expires_at)
  ) then
    raise exception 'An upload link can only be revoked or have its due date changed. Send a new link instead.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Publish to borrower
-- ---------------------------------------------------------------------------

alter table public.loan_documents
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid;

do $$ begin
  alter table public.loan_documents add constraint loan_documents_published_by_fkey
    foreign key (published_by) references public.profiles (id) on delete set null;
exception when duplicate_object then null; end $$;

-- Only letters and estimate PDFs can be published.
alter table public.loan_documents drop constraint if exists loan_documents_publishable_check;
alter table public.loan_documents add constraint loan_documents_publishable_check
  check (published_at is null or kind in ('preapproval_letter', 'fee_worksheet', 'loan_comparison'));

create index if not exists loan_documents_published_idx on public.loan_documents (loan_id) where published_at is not null;

-- ---------------------------------------------------------------------------
-- 3. Home requests from the portal
-- ---------------------------------------------------------------------------

create table if not exists public.portal_property_requests (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  loan_id              uuid not null,
  contact_id           uuid not null,
  -- The home it added to the file; deleting the home keeps the request.
  property_id          uuid,
  link_id              uuid,
  address_line         text not null check (length(trim(address_line)) between 1 and 200),
  city                 text check (city is null or length(city) <= 100),
  state                text not null default 'TX' check (state ~ '^[A-Z]{2}$'),
  zip                  text check (zip is null or zip ~ '^[0-9]{5}$'),
  price                numeric(14, 2) not null check (price > 0 and price < 100000000),
  -- The down payment the borrower asked for: dollars or a percent (one of them).
  down_payment_amount  numeric(14, 2) check (down_payment_amount >= 0),
  down_payment_pct     numeric(6, 3) check (down_payment_pct >= 0 and down_payment_pct <= 100),
  wants_letter         boolean not null default false,
  wants_estimate       boolean not null default false,
  notes                text check (notes is null or length(notes) <= 1000),
  -- The Approval Limits when it came in, and how far over them it is (0 = within).
  max_price            numeric(14, 2),
  max_loan_amount      numeric(14, 2),
  loan_amount          numeric(14, 2),
  over_price           numeric(14, 2) not null default 0,
  over_loan_amount     numeric(14, 2) not null default 0,
  status               text not null default 'requested' check (status in ('requested', 'in_progress', 'ready', 'closed')),
  started_at           timestamptz,
  ready_at             timestamptz,
  ready_document_id    uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint portal_property_requests_down_check check (not (down_payment_amount is not null and down_payment_pct is not null)),
  constraint portal_property_requests_wants_check check (wants_letter or wants_estimate),
  constraint portal_property_requests_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint portal_property_requests_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint portal_property_requests_property_id_fkey
    foreign key (property_id) references public.properties (id) on delete set null,
  constraint portal_property_requests_link_id_fkey
    foreign key (link_id) references public.document_upload_links (id) on delete set null,
  constraint portal_property_requests_ready_document_id_fkey
    foreign key (ready_document_id) references public.loan_documents (id) on delete set null
);

create index if not exists portal_property_requests_loan_idx on public.portal_property_requests (loan_id, created_at desc);
create index if not exists portal_property_requests_open_idx on public.portal_property_requests (organization_id) where status in ('requested', 'in_progress');

create or replace trigger portal_property_requests_set_updated_at
  before update on public.portal_property_requests
  for each row execute function public.set_updated_at();

alter table public.portal_property_requests enable row level security;
drop policy if exists "people on the file see portal requests" on public.portal_property_requests;
create policy "people on the file see portal requests" on public.portal_property_requests
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "people on the file update portal requests" on public.portal_property_requests;
create policy "people on the file update portal requests" on public.portal_property_requests
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
revoke insert, delete on public.portal_property_requests from anon, authenticated;

-- In the app only the status (and when it started) changes; what the borrower asked for never does.
create or replace function public.guard_portal_property_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and (
    (new.loan_id, new.contact_id, new.property_id, new.link_id, new.address_line, new.city, new.state, new.zip, new.price, new.down_payment_amount, new.down_payment_pct,
     new.wants_letter, new.wants_estimate, new.notes, new.max_price, new.max_loan_amount, new.loan_amount, new.over_price, new.over_loan_amount, new.created_at)
    is distinct from
    (old.loan_id, old.contact_id, old.property_id, old.link_id, old.address_line, old.city, old.state, old.zip, old.price, old.down_payment_amount, old.down_payment_pct,
     old.wants_letter, old.wants_estimate, old.notes, old.max_price, old.max_loan_amount, old.loan_amount, old.over_price, old.over_loan_amount, old.created_at)
  ) then
    raise exception 'A borrower''s home request can only change status.';
  end if;
  if new.status = 'in_progress' and old.status = 'requested' then
    new.started_at := coalesce(new.started_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists portal_property_requests_guard on public.portal_property_requests;
create trigger portal_property_requests_guard before update on public.portal_property_requests
  for each row execute function public.guard_portal_property_request();

-- The portal's "Request numbers": adds the home to the file (tagged in the
-- request), checks it against the Approval Limits, notifies the loan officer.
-- Only the service role (the document-upload Edge Function) runs it.
create or replace function public.submit_portal_request(
  p_link uuid, p_address text, p_city text, p_state text, p_zip text, p_price numeric,
  p_down_amount numeric, p_down_pct numeric, p_wants_letter boolean, p_wants_estimate boolean, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.document_upload_links;
  v_loan public.loans;
  v_amount numeric;
  v_property uuid;
  v_id uuid;
  v_name text;
  v_over text;
  v_req public.portal_property_requests;
begin
  select * into l from public.document_upload_links where id = p_link;
  if l.id is null or l.kind <> 'portal' or l.revoked_at is not null or l.expires_at <= now() then
    raise exception 'This portal link is not open.';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter the price.';
  end if;
  if p_down_amount is not null and p_down_pct is not null then
    raise exception 'Enter the down payment in dollars or as a percent, not both.';
  end if;
  select * into v_loan from public.loans where id = l.loan_id;
  v_amount := case
    when p_down_amount is not null then greatest(p_price - p_down_amount, 0)
    when p_down_pct is not null then round(p_price * (1 - p_down_pct / 100), 2)
  end;

  insert into public.properties (organization_id, loan_id, address_line, city, state, zip, status, list_price, created_by)
  values (l.organization_id, l.loan_id, trim(p_address), nullif(trim(p_city), ''), upper(coalesce(nullif(trim(p_state), ''), 'TX')), nullif(trim(p_zip), ''), 'interested', p_price, null)
  returning id into v_property;

  insert into public.portal_property_requests (
    organization_id, loan_id, contact_id, property_id, link_id, address_line, city, state, zip, price,
    down_payment_amount, down_payment_pct, wants_letter, wants_estimate, notes,
    max_price, max_loan_amount, loan_amount, over_price, over_loan_amount
  ) values (
    l.organization_id, l.loan_id, l.contact_id, v_property, l.id, trim(p_address), nullif(trim(p_city), ''), upper(coalesce(nullif(trim(p_state), ''), 'TX')), nullif(trim(p_zip), ''), p_price,
    p_down_amount, p_down_pct, coalesce(p_wants_letter, false), coalesce(p_wants_estimate, false), nullif(trim(p_notes), ''),
    v_loan.preapproval_max_price, v_loan.preapproval_max_loan_amount, v_amount,
    case when v_loan.preapproval_max_price is not null then greatest(p_price - v_loan.preapproval_max_price, 0) else 0 end,
    case when v_loan.preapproval_max_loan_amount is not null and v_amount is not null then greatest(v_amount - v_loan.preapproval_max_loan_amount, 0) else 0 end
  ) returning * into v_req;
  v_id := v_req.id;

  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = l.contact_id;
  v_over := case
    when v_req.over_price > 0 then ' · Over approved max by $' || to_char(v_req.over_price, 'FM999,999,999')
    when v_req.over_loan_amount > 0 then ' · Over approved loan amount by $' || to_char(v_req.over_loan_amount, 'FM999,999,999')
    else '' end;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (l.organization_id, l.contact_id, l.loan_id, 'note',
    coalesce(v_name, 'The borrower') || ' requested numbers for ' || trim(p_address) || ' at $' || to_char(p_price, 'FM999,999,999') || ' (borrower portal)' || v_over || '.');
  perform public.notify_user(l.organization_id, v_loan.assigned_lo_id, 'portal_request',
    coalesce(v_name, 'A borrower') || ' requested numbers for ' || trim(p_address), ltrim(v_over, ' ·'), '/loans/' || l.loan_id::text || '?tab=properties', v_id);
  return v_id;
end;
$$;

revoke all on function public.submit_portal_request(uuid, text, text, text, text, numeric, numeric, numeric, boolean, boolean, text) from public, anon, authenticated;

-- Publishing a letter or estimate for a requested home marks the request Ready.
create or replace function public.portal_document_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.published_at is not null and old.published_at is null and new.property_id is not null then
    update public.portal_property_requests
      set status = 'ready', ready_at = now(), ready_document_id = new.id
      where loan_id = new.loan_id and property_id = new.property_id and status in ('requested', 'in_progress');
  end if;
  return new;
end;
$$;

revoke all on function public.portal_document_published() from public, anon, authenticated;
drop trigger if exists loan_documents_portal_published on public.loan_documents;
create trigger loan_documents_portal_published after update of published_at on public.loan_documents
  for each row execute function public.portal_document_published();

-- ---------------------------------------------------------------------------
-- 4. Portal step messages
-- ---------------------------------------------------------------------------

alter table public.messaging_settings add column if not exists portal_stage_messages jsonb not null default '{}'::jsonb;
alter table public.messaging_settings drop constraint if exists messaging_settings_portal_stage_messages_check;
alter table public.messaging_settings add constraint messaging_settings_portal_stage_messages_check check (jsonb_typeof(portal_stage_messages) = 'object');

-- ---------------------------------------------------------------------------
-- 5. Notifications
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission', 'estimate_picked', 'portal_request', 'portal_upload'));

-- A borrower's upload (the Edge Function, so no signed-in user) tells the file's loan officer, once per item.
create or replace function public.document_request_uploaded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lo uuid;
  v_name text;
begin
  if auth.uid() is not null or new.status <> 'received' or old.status = 'received' then
    return new;
  end if;
  select assigned_lo_id into v_lo from public.loans where id = new.loan_id;
  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = new.contact_id;
  perform public.notify_user(new.organization_id, v_lo, 'portal_upload', coalesce(v_name, 'A borrower') || ' uploaded ' || new.label, null, '/loans/' || new.loan_id::text || '?tab=documents', new.id);
  return new;
end;
$$;

revoke all on function public.document_request_uploaded() from public, anon, authenticated;
drop trigger if exists document_requests_uploaded on public.document_requests;
create trigger document_requests_uploaded after update of status on public.document_requests
  for each row execute function public.document_request_uploaded();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ borrower portal installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'document_upload_links' and column_name in ('kind', 'token')) as link_columns,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loan_documents' and column_name in ('published_at', 'published_by')) as publish_columns,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'portal_property_requests') as request_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'portal_property_requests') as request_policies,
  (select count(*) from pg_trigger where tgname in ('portal_property_requests_guard', 'loan_documents_portal_published', 'document_requests_uploaded')) as triggers,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messaging_settings' and column_name = 'portal_stage_messages') as stage_messages;
