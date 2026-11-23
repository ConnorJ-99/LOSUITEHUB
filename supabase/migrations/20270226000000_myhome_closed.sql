-- MPS HQ: MyHome, closed view Step A (plan docs/plans/myhome.md; Connor
-- 2026-11-20: the closed view before Nurture, built in Steps A–C, and "My
-- closing documents" = the documents he publishes on the closed file).
--
-- 1. properties.estimated_value_on: the day someone last set the home's
--    estimated value, so MyHome can say "Connor's estimate, Nov 2026" (and,
--    in Step B, whether his figure is newer than the index estimate). Set by
--    trigger whenever estimated_value changes, unless the same save sets the
--    date itself. Older values keep no date.
-- 2. Publishing on closed files: any document on a CLOSED file can be
--    published to the borrower (MyHome's "My closing documents"). Open files
--    still publish only letters and estimate PDFs. The check constraint
--    becomes a trigger, because it now depends on the file's stage.
-- 3. Notification kind myhome_request: a borrower asks for something in
--    MyHome (check my value now; refi and equity checks in Step C).
-- 4. myhome_ask(account, loan, kind): the ask itself, service role only (the
--    myhome Edge Function). The person must be a borrower on the file and it
--    must be closed. A myhome_events row, a note on the file and the loan
--    officer's notice; asking the same thing again within a day only returns
--    the first ask.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome closed view installed").

-- ---------------------------------------------------------------------------
-- 1. When a home's estimated value was set
-- ---------------------------------------------------------------------------

alter table public.properties add column if not exists estimated_value_on date;

create or replace function public.properties_value_dated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estimated_value is distinct from old.estimated_value and new.estimated_value_on is not distinct from old.estimated_value_on then
    new.estimated_value_on := case when new.estimated_value is null then null else (now() at time zone 'America/Chicago')::date end;
  end if;
  return new;
end;
$$;

revoke all on function public.properties_value_dated() from public, anon, authenticated;
drop trigger if exists properties_value_dated on public.properties;
create trigger properties_value_dated before update of estimated_value, estimated_value_on on public.properties
  for each row execute function public.properties_value_dated();

create or replace function public.properties_value_dated_new()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estimated_value is not null and new.estimated_value_on is null then
    new.estimated_value_on := (now() at time zone 'America/Chicago')::date;
  end if;
  return new;
end;
$$;

revoke all on function public.properties_value_dated_new() from public, anon, authenticated;
drop trigger if exists properties_value_dated_new on public.properties;
create trigger properties_value_dated_new before insert on public.properties
  for each row execute function public.properties_value_dated_new();

-- ---------------------------------------------------------------------------
-- 2. What can be published: letters and estimates on any file, anything on a closed one
-- ---------------------------------------------------------------------------

alter table public.loan_documents drop constraint if exists loan_documents_publishable_check;

create or replace function public.loan_documents_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null or new.kind is distinct from old.kind)
     and new.kind not in ('preapproval_letter', 'fee_worksheet', 'loan_comparison')
     and not exists (select 1 from public.loans l where l.id = new.loan_id and l.stage = 'closed') then
    raise exception 'Only letters and estimates can be published on an open file. Any document can be published once the file is Closed.';
  end if;
  return new;
end;
$$;

revoke all on function public.loan_documents_publish_guard() from public, anon, authenticated;
drop trigger if exists loan_documents_publish_guard on public.loan_documents;
create trigger loan_documents_publish_guard before insert or update of published_at, kind on public.loan_documents
  for each row execute function public.loan_documents_publish_guard();

-- ---------------------------------------------------------------------------
-- 3. The loan officer's notice
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission', 'estimate_picked', 'portal_request', 'portal_upload', 'application_submitted', 'nurture_reply', 'lead_added', 'stage_request', 'intake_submitted', 'intake_returned', 'myhome_request'));

-- ---------------------------------------------------------------------------
-- 4. Asks from a closed file
-- ---------------------------------------------------------------------------

create or replace function public.myhome_ask(p_account uuid, p_loan uuid, p_kind text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  v_loan public.loans;
  v_event text;
  v_prior timestamptz;
  v_name text;
  v_home text;
  v_what text;
  v_id uuid;
  v_at timestamptz;
begin
  if p_kind not in ('value_check', 'refi_check', 'equity_check') then
    raise exception 'Unknown request.';
  end if;
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then
    raise exception 'This MyHome account is not on.';
  end if;
  select * into v_loan from public.loans where id = p_loan and organization_id = a.organization_id;
  if v_loan.id is null or not exists (select 1 from public.loan_borrowers lb where lb.loan_id = p_loan and lb.contact_id = a.contact_id) then
    raise exception 'That loan is not yours.';
  end if;
  if v_loan.stage <> 'closed' then
    raise exception 'This loan has not closed.';
  end if;

  v_event := p_kind || '_requested';
  select max(e.created_at) into v_prior from public.myhome_events e
  where e.account_id = a.id and e.loan_id = p_loan and e.kind = v_event and e.handled_at is null and e.created_at > now() - interval '1 day';
  if v_prior is not null then
    return v_prior;
  end if;

  insert into public.myhome_events (organization_id, account_id, contact_id, loan_id, kind)
  values (a.organization_id, a.id, a.contact_id, p_loan, v_event)
  returning id, created_at into v_id, v_at;

  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = a.contact_id;
  select p.address_line into v_home from public.properties p where p.id = v_loan.subject_property_id;
  v_what := case p_kind
    when 'value_check' then 'asked you to check their home''s value'
    when 'refi_check' then 'asked you to check their refinance options'
    else 'asked you to check their equity / HELOC options' end;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (a.organization_id, a.contact_id, p_loan, 'note',
    coalesce(v_name, 'The borrower') || ' ' || v_what || coalesce(' for ' || v_home, '') || ' (MyHome).');
  perform public.notify_user(a.organization_id, v_loan.assigned_lo_id, 'myhome_request',
    coalesce(v_name, 'A borrower') || ' ' || v_what, v_home, '/loans/' || p_loan::text, v_id);
  return v_at;
end;
$$;

revoke all on function public.myhome_ask(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.myhome_ask(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ MyHome closed view installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'properties' and column_name = 'estimated_value_on') as columns,
  (select count(*) from pg_trigger where tgname in ('properties_value_dated', 'properties_value_dated_new', 'loan_documents_publish_guard')) as triggers,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'myhome_ask') as functions,
  (select count(*) from pg_constraint where conname = 'loan_documents_publishable_check') as old_check;
