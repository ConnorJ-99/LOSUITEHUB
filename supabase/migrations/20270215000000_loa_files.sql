-- MPS HQ: Loan Officer Assistant, step 2 (Connor, 2026-11-17).
--
-- An LO Assistant is attached to a file the way a processor is: one more slot
-- on the file's team (loan_team_members.role = 'loa'). Being on the team is
-- what lets them see the file (on_loan_team), so an LOA only sees files where
-- they are the LO, the attached LOA or the attached processor.
--
-- file_role(loan) now also returns 'loa'. An LOA works the file like a
-- processor (and can't change its loan officer, move it to Lost or Closed,
-- delete it, or see revenue and comp) and can't move its stage at all: they
-- ask the loan officer with request_stage_change().
--
-- add_lead_for_lo(loan, lo, notify) hands a lead you just added to another
-- loan officer: owners and admins to anyone; an LOA only to the loan officers
-- they assist (loa_assignments), and they are attached as the file's LOA.
-- With notify, the loan officer gets an Action Queue item ("New lead added
-- by Jamie") and a notification (kind lead_added, pushed).
--
-- Needs 20270214000000_loa_roles.sql first. Safe to run more than once. A full
-- run ends with a confirmation row ("MPS HQ LO assistant files installed").

alter type public.team_role add value if not exists 'loa';

-- ---------------------------------------------------------------------------
-- 1. file_role(loan): 'admin', 'lo', 'loa', 'processor' or null
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
    when exists (select 1 from public.loan_team_members t where t.loan_id = l.id and t.profile_id = auth.uid() and t.role::text = 'loa') then 'loa'
    when exists (select 1 from public.loan_team_members t where t.loan_id = l.id and t.profile_id = auth.uid()) then 'processor'
    else null
  end
  from (select 1) one
  left join public.loans l on l.id = loan;
$$;

revoke all on function public.file_role(uuid) from public, anon;
grant execute on function public.file_role(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. What a file's processor or LOA can't do
-- ---------------------------------------------------------------------------

create or replace function public.guard_loan_file_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new; -- The SQL Editor and service jobs aren't limited.
  end if;
  v_role := public.file_role(old.id);
  if v_role is null or v_role not in ('processor', 'loa') then
    return new;
  end if;
  if new.assigned_lo_id is distinct from old.assigned_lo_id then
    raise exception 'Only this file''s loan officer or an admin can change its loan officer.';
  end if;
  if v_role = 'loa' and new.stage is distinct from old.stage then
    raise exception 'An LO Assistant can''t move a file''s stage. Use "Request stage change" to ask the loan officer.';
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

-- ---------------------------------------------------------------------------
-- 3. Notification kinds: a lead added for you, a stage change asked for
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission', 'estimate_picked', 'portal_request', 'portal_upload', 'application_submitted', 'nurture_reply', 'lead_added', 'stage_request'));

-- ---------------------------------------------------------------------------
-- 4. add_lead_for_lo: hand a lead you just added to another loan officer
-- ---------------------------------------------------------------------------

create or replace function public.add_lead_for_lo(p_loan_id uuid, p_lo_id uuid, p_notify boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_admin    boolean;
  v_loa      boolean;
  v_me       text;
  v_borrower text;
begin
  select organization_id into v_org from public.loans where id = p_loan_id;
  if v_org is null or coalesce(public.file_role(p_loan_id), '') not in ('lo', 'admin') then
    raise exception 'That file was not found, or it is not yours to hand over.';
  end if;
  if p_lo_id is null or not exists (select 1 from public.organization_members where organization_id = v_org and user_id = p_lo_id) then
    raise exception 'That loan officer isn''t in this company.';
  end if;
  if p_lo_id = auth.uid() then
    return;
  end if;
  v_admin := public.has_org_role(v_org, array['owner', 'admin']::public.org_role[]);
  v_loa := exists (select 1 from public.loa_assignments where organization_id = v_org and loa_user_id = auth.uid() and lo_user_id = p_lo_id);
  if not v_admin and not v_loa then
    raise exception 'You can only add leads for the loan officers you assist.';
  end if;

  -- The LOA stays on the file (like a processor), so they can keep working it.
  if v_loa then
    insert into public.loan_team_members (organization_id, loan_id, role, profile_id)
    values (v_org, p_loan_id, 'loa', auth.uid())
    on conflict (loan_id, role) do update set profile_id = excluded.profile_id, name = null, company = null, email = null, phone = null;
  end if;
  update public.loans set assigned_lo_id = p_lo_id where id = p_loan_id;

  if coalesce(p_notify, true) then
    select coalesce(nullif(trim(display_name), ''), nullif(split_part(trim(coalesce(full_name, '')), ' ', 1), ''), email) into v_me from public.profiles where id = auth.uid();
    select nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') into v_borrower
    from public.loan_borrowers lb join public.contacts c on c.id = lb.contact_id
    where lb.loan_id = p_loan_id order by (lb.role::text = 'primary') desc limit 1;
    insert into public.action_items (organization_id, loan_id, kind, title, payload, status, due_on, created_by, source, source_key)
    values (
      v_org, p_loan_id, 'task_suggestion',
      left('New lead added by ' || coalesce(v_me, 'your assistant') || ': ' || coalesce(v_borrower, 'a new borrower'), 200),
      jsonb_build_object('title', left('Call ' || coalesce(v_borrower, 'the new lead') || ' (added by ' || coalesce(v_me, 'your assistant') || ')', 200),
        'dueOn', (now() at time zone 'America/Chicago')::date, 'forUserId', p_lo_id, 'addedBy', auth.uid(), 'addedByName', v_me),
      'pending', (now() at time zone 'America/Chicago')::date, auth.uid(), 'loa_lead', 'loa-lead:' || p_loan_id)
    on conflict (organization_id, source_key) do nothing;
    perform public.notify_user(v_org, p_lo_id, 'lead_added', 'New lead added by ' || coalesce(v_me, 'your assistant'), coalesce(v_borrower, 'A new borrower'), '/loans/' || p_loan_id, p_loan_id);
  end if;
end;
$$;

revoke all on function public.add_lead_for_lo(uuid, uuid, boolean) from public, anon;
grant execute on function public.add_lead_for_lo(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. request_stage_change: an LOA asks the loan officer to move the file
-- ---------------------------------------------------------------------------

create or replace function public.request_stage_change(p_loan_id uuid, p_stage text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan     record;
  v_me       text;
  v_borrower text;
  v_label    text := initcap(replace(coalesce(p_stage, ''), '_', ' '));
begin
  select id, organization_id, assigned_lo_id, stage::text as stage into v_loan from public.loans where id = p_loan_id;
  if v_loan.id is null or public.file_role(p_loan_id) is distinct from 'loa' then
    raise exception 'Only this file''s LO Assistant asks for a stage change; others move it themselves.';
  end if;
  if v_loan.assigned_lo_id is null then
    raise exception 'This file has no loan officer to ask.';
  end if;
  if p_stage is null or p_stage = v_loan.stage then
    raise exception 'Pick a different stage.';
  end if;
  select coalesce(nullif(trim(display_name), ''), nullif(split_part(trim(coalesce(full_name, '')), ' ', 1), ''), email) into v_me from public.profiles where id = auth.uid();
  select nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') into v_borrower
  from public.loan_borrowers lb join public.contacts c on c.id = lb.contact_id
  where lb.loan_id = p_loan_id order by (lb.role::text = 'primary') desc limit 1;
  insert into public.action_items (organization_id, loan_id, kind, title, payload, status, due_on, created_by, source, source_key)
  values (
    v_loan.organization_id, p_loan_id, 'task_suggestion',
    left(coalesce(v_me, 'Your assistant') || ' asks to move ' || coalesce(v_borrower, 'a file') || ' to ' || v_label, 200),
    jsonb_build_object('title', left('Move ' || coalesce(v_borrower, 'the file') || ' to ' || v_label || coalesce(' (' || nullif(trim(p_note), '') || ')', ''), 200),
      'dueOn', (now() at time zone 'America/Chicago')::date, 'forUserId', v_loan.assigned_lo_id, 'stageRequest', p_stage,
      'requestedBy', auth.uid(), 'requestedByName', v_me, 'note', nullif(trim(coalesce(p_note, '')), '')),
    'pending', (now() at time zone 'America/Chicago')::date, auth.uid(), 'stage_request',
    'stage-request:' || p_loan_id || ':' || p_stage || ':' || (now() at time zone 'America/Chicago')::date)
  on conflict (organization_id, source_key) do nothing;
  perform public.notify_user(v_loan.organization_id, v_loan.assigned_lo_id, 'stage_request',
    coalesce(v_me, 'Your assistant') || ' asks to move a file to ' || v_label, coalesce(v_borrower, 'A file'), '/loans/' || p_loan_id,
    md5(p_loan_id::text || p_stage || clock_timestamp()::text)::uuid);
end;
$$;

revoke all on function public.request_stage_change(uuid, text, text) from public, anon;
grant execute on function public.request_stage_change(uuid, text, text) to authenticated;

-- close_loan: an LOA can't close a file either.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'close_loan' and pronamespace = 'public'::regnamespace
             and prosrc like '%file_role(p_loan_id) = ''processor''%') then
    execute replace(
      pg_get_functiondef('public.close_loan(uuid, date, date, text)'::regprocedure),
      'public.file_role(p_loan_id) = ''processor''',
      'public.file_role(p_loan_id) in (''processor'', ''loa'')');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ LO assistant files installed' as result,
  (select count(*) from pg_enum where enumtypid = 'public.team_role'::regtype and enumlabel = 'loa') as loa_slot,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('file_role', 'add_lead_for_lo', 'request_stage_change')) as functions,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'close_loan' and prosrc like '%''loa''%') as close_guard;
