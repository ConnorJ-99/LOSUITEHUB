-- MPS HQ: your role on each file (Connor, 2026-11-16).
--
-- A person's company role (owner, admin, loan officer, processor) still runs
-- the company-wide pages. On a file, what you can do follows your role ON
-- THAT FILE, file_role(loan):
--   'admin'      the company's Admin login (sees every file)
--   'lo'         the file's assigned loan officer
--   'processor'  on the file's team (the Processor slot) but not its loan officer
--   null         none of these (you can't see the file)
-- A file's processor works the whole file but can't change its loan officer,
-- move it to Lost or Closed, delete it, or see the revenue and comp on it,
-- and only drafts messages for the loan officer to approve (draft_for_lo).
-- The comp columns on loans are no longer readable directly by a login;
-- screens read them through loan_comp_rows(), which leaves out files you
-- process. A later script that adds a column to loans must end with
-- "select public.grant_loan_columns();" so logins can read the new column.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ file roles installed").

-- ---------------------------------------------------------------------------
-- 1. file_role(loan)
-- ---------------------------------------------------------------------------

create or replace function public.file_role(loan uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when l.id is null or not public.is_org_member(l.organization_id) then null
    when public.sees_all_files(l.organization_id) then 'admin'
    when l.assigned_lo_id = auth.uid() then 'lo'
    when exists (select 1 from public.loan_team_members t where t.loan_id = l.id and t.profile_id = auth.uid()) then 'processor'
    else null
  end
  from (select 1) one
  left join public.loans l on l.id = loan;
$$;

revoke all on function public.file_role(uuid) from public, anon;
grant execute on function public.file_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. What a file's processor can't do (checked on every change, any screen)
-- ---------------------------------------------------------------------------

create or replace function public.guard_loan_file_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- The SQL Editor and service jobs aren't limited.
  end if;
  if public.file_role(old.id) is distinct from 'processor' then
    return new;
  end if;
  if new.assigned_lo_id is distinct from old.assigned_lo_id then
    raise exception 'Only this file''s loan officer or an admin can change its loan officer.';
  end if;
  if new.stage is distinct from old.stage and new.stage::text in ('lost', 'closed') then
    raise exception 'Only this file''s loan officer or an admin can move it to %.', case when new.stage::text = 'lost' then 'Lost' else 'Closed' end;
  end if;
  if (new.revenue_type, new.revenue_value, new.comp_plan_id) is distinct from (old.revenue_type, old.revenue_value, old.comp_plan_id) then
    raise exception 'Only this file''s loan officer or an admin can change its revenue.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_loan_file_role() from public, anon, authenticated;
drop trigger if exists loans_guard_file_role on public.loans;
create trigger loans_guard_file_role before update of assigned_lo_id, stage, revenue_type, revenue_value, comp_plan_id on public.loans
  for each row execute function public.guard_loan_file_role();

-- reassign_loan: the file's loan officer or an admin (never its processor).
create or replace function public.reassign_loan(p_loan_id uuid, p_lo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select l.organization_id into v_org from public.loans l where l.id = p_loan_id and public.can_see_loan(l.id);
  if v_org is null or public.file_role(p_loan_id) not in ('lo', 'admin') then
    raise exception 'This file can''t be reassigned. Only its loan officer or an admin can do that.';
  end if;
  if p_lo_id is not null and not exists (
    select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = p_lo_id
  ) then
    raise exception 'That loan officer isn''t in this company.';
  end if;
  update public.loans set assigned_lo_id = p_lo_id where id = p_loan_id;
end;
$$;

revoke all on function public.reassign_loan(uuid, uuid) from public;
grant execute on function public.reassign_loan(uuid, uuid) to authenticated;

-- delete_lead: the file's loan officer or an admin (by file role).
create or replace function public.delete_lead(p_loan_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan    public.loans;
  v_people  uuid[];
  v_removed integer;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if v_loan.id is null
    or not public.has_org_role(v_loan.organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[])
    or coalesce(public.file_role(p_loan_id), '') not in ('lo', 'admin') then
    raise exception 'This file can''t be deleted. Only its loan officer or an admin can delete it.';
  end if;
  select array_agg(contact_id) into v_people from public.loan_borrowers where loan_id = p_loan_id;
  update public.lead_submissions set handled_at = now(), handled_by = auth.uid()
  where loan_id = p_loan_id and handled_at is null;
  delete from public.loans where id = p_loan_id;
  get diagnostics v_removed = row_count;
  delete from public.contacts c
  where c.id = any (coalesce(v_people, '{}'))
    and not public.contact_has_loans(c.id);
  return v_removed;
end;
$$;

revoke all on function public.delete_lead(uuid) from public;
grant execute on function public.delete_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Revenue and comp: not readable directly; loan_comp_rows() checks the file role
-- ---------------------------------------------------------------------------

-- Logins read every loans column except these. Run again after adding a column to loans.
create or replace function public.grant_loan_columns()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cols text;
  v_n integer;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position), count(*)
  into v_cols, v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'loans'
    and column_name not in ('revenue_type', 'revenue_value', 'comp_plan_id', 'lead_source_type', 'comp_base_mode', 'comp_base_bps',
      'comp_split_pct', 'comp_member_type', 'comp_snapshot_at', 'comp_confirmed_at', 'comp_confirmed_by', 'comp_paid_on');
  revoke select on public.loans from anon, authenticated;
  execute format('grant select (%s) on public.loans to authenticated', v_cols);
  return v_n;
end;
$$;

revoke all on function public.grant_loan_columns() from public, anon, authenticated;
select public.grant_loan_columns();

-- The revenue and comp of the files you can see, except files you process.
-- p_loan_ids null = every such file.
create or replace function public.loan_comp_rows(p_loan_ids uuid[] default null)
returns table (
  loan_id                uuid,
  revenue_type           text,
  revenue_value          numeric,
  comp_plan_id           uuid,
  lead_source_type       text,
  comp_base_mode         text,
  comp_base_bps          numeric,
  comp_split_pct         numeric,
  comp_member_type       text,
  comp_snapshot_at       timestamptz,
  comp_confirmed_at      timestamptz,
  comp_confirmed_by_name text,
  comp_paid_on           date
)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.revenue_type::text, l.revenue_value, l.comp_plan_id, l.lead_source_type, l.comp_base_mode, l.comp_base_bps,
    l.comp_split_pct, l.comp_member_type, l.comp_snapshot_at, l.comp_confirmed_at,
    coalesce(nullif(trim(p.full_name), ''), p.email), l.comp_paid_on
  from public.loans l
  left join public.profiles p on p.id = l.comp_confirmed_by
  where (p_loan_ids is null or l.id = any (p_loan_ids))
    and public.can_see_loan(l.id)
    and public.file_role(l.id) in ('lo', 'admin');
$$;

revoke all on function public.loan_comp_rows(uuid[]) from public, anon;
grant execute on function public.loan_comp_rows(uuid[]) to authenticated;

-- The change log hides revenue and comp changes from a file's processor.
drop policy if exists "members see changes on loans they can see" on public.loan_change_log;
create policy "members see changes on loans they can see" on public.loan_change_log
  for select to authenticated using (
    public.can_see_loan(loan_id)
    and (field not in ('revenue_type', 'revenue_value', 'comp_plan_id', 'lead_source_type', 'comp_base_mode', 'comp_base_bps',
           'comp_split_pct', 'comp_member_type', 'comp_confirmed_at', 'comp_paid_on')
         or public.file_role(loan_id) in ('lo', 'admin')));

-- close_loan reads the lead source, so it now runs as the database owner, with the same checks.
create or replace function public.close_loan(p_loan_id uuid, p_closing_date date, p_funding_date date, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  s record;
  v_source text;
  v_member text;
begin
  if p_closing_date is null or p_funding_date is null then raise exception 'Enter both the closed and funded dates.'; end if;
  if p_funding_date < p_closing_date then raise exception 'The funded date can''t be before the closed date.'; end if;
  select id, organization_id, assigned_lo_id, lead_source_type into l from public.loans where id = p_loan_id and public.can_see_loan(id);
  if not found then raise exception 'You do not have permission to change this loan.'; end if;
  if public.file_role(p_loan_id) = 'processor' then
    raise exception 'Only this file''s loan officer or an admin can move it to Closed.';
  end if;

  select base_mode, base_bps, company_split_pct, self_split_pct into s from public.comp_settings where organization_id = l.organization_id;
  v_source := coalesce(l.lead_source_type, public.default_lead_source(l.id));
  select comp_type into v_member from public.organization_members where organization_id = l.organization_id and user_id = l.assigned_lo_id;

  perform set_config('mps.change_reason', coalesce(p_reason, ''), true);
  perform set_config('mps.comp_snapshot', 'on', true);
  update public.loans set
    stage = 'closed', closing_date = p_closing_date, funding_date = p_funding_date, lost_reason = null,
    lead_source_type = v_source,
    comp_base_mode = coalesce(s.base_mode, 'revenue'),
    comp_base_bps = case when coalesce(s.base_mode, 'revenue') = 'loan_bps' then s.base_bps end,
    comp_split_pct = case when v_source = 'company' then coalesce(s.company_split_pct, 35.25) else coalesce(s.self_split_pct, 70.25) end,
    comp_member_type = coalesce(v_member, 'commission'),
    comp_snapshot_at = now()
  where id = p_loan_id;
  if not found then raise exception 'You do not have permission to change this loan.'; end if;
  perform set_config('mps.comp_snapshot', '', true);
  perform set_config('mps.change_reason', '', true);
end;
$$;

revoke all on function public.close_loan(uuid, date, date, text) from public, anon;
grant execute on function public.close_loan(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A processor's message = a draft for the loan officer to approve
-- ---------------------------------------------------------------------------

create index if not exists action_items_processor_draft_idx on public.action_items (loan_id) where source = 'processor_draft';

-- Saves the message to the file's Action Queue for its loan officer; nothing
-- is sent. The same key (a double click) returns the same draft.
create or replace function public.draft_for_lo(
  p_loan_id       uuid,
  p_contact_id    uuid,
  p_channel       public.message_channel,
  p_subject       text,
  p_body          text,
  p_document_ids  uuid[],
  p_client_key    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_id      uuid;
  v_key     text := 'processor:' || auth.uid() || ':' || coalesce(nullif(trim(p_client_key), ''), gen_random_uuid()::text);
  v_person  record;
  v_me      text;
  v_docs    uuid[] := coalesce(p_document_ids, '{}');
  v_subject text := case when p_channel = 'email' then nullif(trim(coalesce(p_subject, '')), '') else null end;
begin
  select organization_id into v_org from public.loans where id = p_loan_id;
  if v_org is null or not public.can_see_loan(p_loan_id) then
    raise exception 'That file was not found, or it is not yours.';
  end if;
  if not exists (select 1 from public.loan_borrowers where loan_id = p_loan_id and contact_id = p_contact_id) then
    raise exception 'That person is not on this file.';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Write a message first.';
  end if;
  if p_channel <> 'email' and cardinality(v_docs) > 0 then
    raise exception 'Documents go by email only, never by text.';
  end if;
  if p_channel = 'email' and v_subject is null then
    raise exception 'An email needs a subject.';
  end if;
  select first_name, phone, email into v_person from public.contacts where id = p_contact_id;
  select coalesce(nullif(trim(full_name), ''), email) into v_me from public.profiles where id = auth.uid();

  insert into public.action_items (organization_id, loan_id, kind, title, payload, status, due_on, created_by, source, source_key)
  values (
    v_org, p_loan_id, 'draft_message',
    left(coalesce(v_me, 'Your processor') || ' drafted a ' || case when p_channel = 'text' then 'text' else 'email' end || ' to ' || coalesce(nullif(trim(v_person.first_name), ''), 'the client'), 200),
    jsonb_build_object(
      'channel', p_channel, 'to', case when p_channel = 'text' then v_person.phone else v_person.email end,
      'subject', v_subject, 'body', trim(p_body), 'contactId', p_contact_id,
      'documentIds', to_jsonb(v_docs), 'draftedBy', auth.uid(), 'draftedByName', v_me),
    'pending', (now() at time zone 'America/Chicago')::date, auth.uid(), 'processor_draft', v_key)
  on conflict (organization_id, source_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.action_items where organization_id = v_org and source_key = v_key;
  end if;
  return v_id;
end;
$$;

revoke all on function public.draft_for_lo(uuid, uuid, public.message_channel, text, text, uuid[], text) from public, anon;
grant execute on function public.draft_for_lo(uuid, uuid, public.message_channel, text, text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ file roles installed' as result,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('file_role', 'loan_comp_rows', 'draft_for_lo', 'grant_loan_columns')) as functions,
  (select count(*) from pg_trigger where tgname = 'loans_guard_file_role') as triggers,
  (select count(*) from information_schema.column_privileges where table_schema = 'public' and table_name = 'loans' and grantee = 'authenticated' and privilege_type = 'SELECT' and column_name = 'revenue_value') as comp_readable;
