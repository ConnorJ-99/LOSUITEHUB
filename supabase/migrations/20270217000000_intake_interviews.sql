-- MPS HQ: Loan Officer Assistant, step 4: the intake interview (Connor, 2026-11-17).
--
-- intake_interviews: one guided call per file, run by the file's LO, an
-- admin, or the file's LO Assistant (only for a loan officer they assist),
-- and submitted to the file's loan officer for review. Answers are kept by
-- section (call, goal, credit, assets, income, changes, handoff) and saved as
-- the interviewer types. Fact-gathering only: nothing here decides anything.
--
--   draft      being filled in (autosaved)
--   submitted  sent to the loan officer (read only until they act)
--   returned   sent back with a question (open for edits again)
--   accepted   the loan officer accepted it (step 5)
--
-- Who sees one: its interviewer, the file's loan officer, and admins.
-- Answers change only while it's a draft or returned, by its interviewer, the
-- loan officer or an admin. The status moves only through submit_intake()
-- (and step 5's review functions). Submitting puts "Intake ready: Maria TEST
-- from Jamie" on the loan officer's Today and sends them a notification.
--
-- Needs 20270215000000_loa_files.sql first. Safe to run more than once. A full
-- run ends with a confirmation row ("MPS HQ intake interviews installed").

create table if not exists public.intake_interviews (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  loan_id              uuid not null,
  lo_user_id           uuid references public.profiles (id) on delete set null,
  interviewer_user_id  uuid default auth.uid() references public.profiles (id) on delete set null,
  status               text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'accepted')),
  answers              jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  summary              jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
  partial_reason       text,
  submitted_at         timestamptz,
  reviewed_at          timestamptz,
  reviewed_by          uuid references public.profiles (id) on delete set null,
  review_note          text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint intake_interviews_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade
);

-- One open interview per file (an accepted one can be followed by a new one).
create unique index if not exists intake_interviews_one_open on public.intake_interviews (loan_id) where status <> 'accepted';
create index if not exists intake_interviews_lo_idx on public.intake_interviews (lo_user_id, status);

drop trigger if exists intake_interviews_set_updated_at on public.intake_interviews;
create trigger intake_interviews_set_updated_at before update on public.intake_interviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Who may run one on a file: its LO, an admin, or its LO Assistant for an LO they assist
-- ---------------------------------------------------------------------------

create or replace function public.may_run_intake(p_loan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case public.file_role(p_loan_id)
    when 'lo' then true
    when 'admin' then true
    when 'loa' then exists (
      select 1 from public.loans l
      join public.loa_assignments a on a.organization_id = l.organization_id and a.loa_user_id = auth.uid() and a.lo_user_id = l.assigned_lo_id
      where l.id = p_loan_id)
    else false
  end;
$$;

revoke all on function public.may_run_intake(uuid) from public, anon;
grant execute on function public.may_run_intake(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.intake_interviews enable row level security;

drop policy if exists "people on the interview see it" on public.intake_interviews;
create policy "people on the interview see it" on public.intake_interviews
  for select to authenticated using (
    public.is_org_member(organization_id)
    and (public.sees_all_files(organization_id)
      or interviewer_user_id = auth.uid()
      or exists (select 1 from public.loans l where l.id = loan_id and l.assigned_lo_id = auth.uid())));

drop policy if exists "people who may run one start it" on public.intake_interviews;
create policy "people who may run one start it" on public.intake_interviews
  for insert to authenticated with check (
    public.is_org_member(organization_id) and interviewer_user_id = auth.uid() and status = 'draft' and public.may_run_intake(loan_id));

drop policy if exists "people on the interview edit it" on public.intake_interviews;
create policy "people on the interview edit it" on public.intake_interviews
  for update to authenticated using (
    public.is_org_member(organization_id)
    and (public.sees_all_files(organization_id)
      or interviewer_user_id = auth.uid()
      or exists (select 1 from public.loans l where l.id = loan_id and l.assigned_lo_id = auth.uid())))
  with check (public.is_org_member(organization_id));

drop policy if exists "people on the interview delete a draft" on public.intake_interviews;
create policy "people on the interview delete a draft" on public.intake_interviews
  for delete to authenticated using (
    status = 'draft'
    and (public.sees_all_files(organization_id) or interviewer_user_id = auth.uid()
      or exists (select 1 from public.loans l where l.id = loan_id and l.assigned_lo_id = auth.uid())));

grant select, insert, update, delete on public.intake_interviews to authenticated;

-- ---------------------------------------------------------------------------
-- Guard: the loan officer is the file's; status and review fields change only through the functions
-- ---------------------------------------------------------------------------

create or replace function public.guard_intake_interview()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select assigned_lo_id into new.lo_user_id from public.loans where id = new.loan_id;
    new.status := 'draft';
    new.summary := null;
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
    return new;
  end if;
  if auth.uid() is null or coalesce(current_setting('mps.intake_change', true), '') = 'on' then
    return new; -- The SQL Editor, service jobs and the intake functions.
  end if;
  if (new.status, new.summary, new.submitted_at, new.reviewed_at, new.reviewed_by, new.review_note, new.partial_reason, new.loan_id, new.lo_user_id, new.interviewer_user_id, new.organization_id)
     is distinct from (old.status, old.summary, old.submitted_at, old.reviewed_at, old.reviewed_by, old.review_note, old.partial_reason, old.loan_id, old.lo_user_id, old.interviewer_user_id, old.organization_id) then
    raise exception 'Use Submit (or the review buttons) to change an intake interview''s status.';
  end if;
  if new.answers is distinct from old.answers and old.status not in ('draft', 'returned') then
    raise exception 'This intake was submitted. The loan officer can send it back for changes.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_intake_interview() from public, anon, authenticated;
drop trigger if exists intake_interviews_guard on public.intake_interviews;
create trigger intake_interviews_guard before insert or update on public.intake_interviews
  for each row execute function public.guard_intake_interview();

-- ---------------------------------------------------------------------------
-- Notification kinds
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission', 'estimate_picked', 'portal_request', 'portal_upload', 'application_submitted', 'nurture_reply', 'lead_added', 'stage_request', 'intake_submitted', 'intake_returned'));

-- ---------------------------------------------------------------------------
-- submit_intake: send it to the loan officer (a partial one needs a reason)
-- ---------------------------------------------------------------------------

create or replace function public.submit_intake(p_id uuid, p_partial_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v          public.intake_interviews%rowtype;
  v_lo       uuid;
  v_me       text;
  v_borrower text;
begin
  select * into v from public.intake_interviews where id = p_id;
  if v.id is null or not (v.interviewer_user_id = auth.uid() or public.may_run_intake(v.loan_id)) then
    raise exception 'That intake interview was not found, or it is not yours.';
  end if;
  if v.status not in ('draft', 'returned') then
    raise exception 'This intake was already submitted.';
  end if;
  if p_partial_reason is not null and length(trim(p_partial_reason)) = 0 then
    raise exception 'Say why it''s partial.';
  end if;
  select assigned_lo_id into v_lo from public.loans where id = v.loan_id;
  if v_lo is null then
    raise exception 'This file has no loan officer to send it to.';
  end if;

  perform set_config('mps.intake_change', 'on', true);
  update public.intake_interviews
  set status = 'submitted', submitted_at = now(), lo_user_id = v_lo, partial_reason = nullif(trim(coalesce(p_partial_reason, '')), ''),
      review_note = case when v.status = 'returned' then review_note else null end
  where id = p_id;
  perform set_config('mps.intake_change', '', true);

  -- The loan officer hears about it, unless they ran it themselves.
  if v_lo is distinct from auth.uid() then
    select coalesce(nullif(trim(display_name), ''), nullif(split_part(trim(coalesce(full_name, '')), ' ', 1), ''), email) into v_me from public.profiles where id = auth.uid();
    select nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') into v_borrower
    from public.loan_borrowers lb join public.contacts c on c.id = lb.contact_id
    where lb.loan_id = v.loan_id order by (lb.role::text = 'primary') desc limit 1;
    insert into public.action_items (organization_id, loan_id, kind, title, payload, status, due_on, created_by, source, source_key)
    values (
      v.organization_id, v.loan_id, 'task_suggestion',
      left('Intake ready: ' || coalesce(v_borrower, 'a borrower') || ' from ' || coalesce(v_me, 'your assistant'), 200),
      jsonb_build_object('title', left('Review the intake for ' || coalesce(v_borrower, 'the borrower'), 200),
        'dueOn', (now() at time zone 'America/Chicago')::date, 'forUserId', v_lo, 'intakeId', p_id,
        'partial', p_partial_reason is not null),
      'pending', (now() at time zone 'America/Chicago')::date, auth.uid(), 'intake',
      'intake:' || p_id || ':' || extract(epoch from now())::bigint)
    on conflict (organization_id, source_key) do nothing;
    perform public.notify_user(v.organization_id, v_lo, 'intake_submitted',
      'Intake ready: ' || coalesce(v_borrower, 'a borrower'), 'From ' || coalesce(v_me, 'your assistant') || case when p_partial_reason is not null then ' (partial)' else '' end,
      '/loans/' || v.loan_id || '/intake', md5(p_id::text || clock_timestamp()::text)::uuid);
  end if;
end;
$$;

revoke all on function public.submit_intake(uuid, text) from public, anon;
grant execute on function public.submit_intake(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ intake interviews installed' as result,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'intake_interviews') as policies,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('may_run_intake', 'submit_intake', 'guard_intake_interview')) as functions,
  (select count(*) from pg_trigger where tgname in ('intake_interviews_guard', 'intake_interviews_set_updated_at')) as triggers;
