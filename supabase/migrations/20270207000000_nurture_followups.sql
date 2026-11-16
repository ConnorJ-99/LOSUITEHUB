-- MPS HQ: Buyer Recovery & Nurture, Steps 6–8 (Connor, 2026-11-16; plan
-- docs/plans/buyer-nurture.md).
--
-- 6. Milestone drafts. Every 15 minutes the timer (run_nurture_followups)
--    drafts, for each Nurture file with an approved plan, at most ONE waiting
--    Action Queue item (source 'nurture_milestone', key
--    nurture:<milestone or plan>:<kind>, each kind once):
--      roadmap   a few days after the roadmap was sent (Plan Delivered)
--      check_in  on a milestone's check-in date (3 days before its target)
--      due       on or after its target date
--      overdue   N days after its target (high priority)
--      reassess  every action milestone is done: ask for a review (high)
--    None while one is waiting, after a recent message either way or a recent
--    nurture draft (the "quiet days"), when Paused / Ready for Prequal / on
--    hold / opted out of both channels, in test mode for non-TEST people, or
--    when the file isn't in Nurture. Texts are reworded once by AI (the
--    assistant's nurture_due task, Sonnet 5.5) with a template fallback.
--    Nothing is sent: Connor sends from the queue. Off until turned on in
--    Settings → Lead follow-ups (lead_followup_settings.nurture_enabled).
-- 7. Replies. A message from a Nurture borrower dismisses a waiting nurture
--    draft, makes (or refreshes) one queued nurture_updates row, wakes a
--    Paused file to Working on Plan, and notifies the loan officer
--    (nurture_reply). The assistant reads queued updates (which milestone,
--    what they reported, a suggested next step) and records them as
--    UNVERIFIED; it never completes a milestone. Only a person verifies an
--    update (verify_nurture_update, which can also tick the milestone as that
--    person). Without the AI key the reply still shows, unread, for Connor.
-- 8. Reassess for Prequalification (reassess_nurture): the file goes back to
--    New lead (contacted), never Pre-Qualified; the nurture fields clear (the
--    existing trigger), waiting nurture drafts are dismissed, the plan stays
--    locked, and lead follow-ups take over.
-- Also: a milestone ticked done by a person moves the file to Working on
-- Plan, or Ready for Reassessment once every action milestone is done.
--
-- Needs the same Supabase Vault entries as the upload-analysis timer
-- (losuite_project_url, ghl_webhook_secret, losuite_anon_key) for the AI
-- parts; without them drafts are still made and replies still show.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ nurture follow-ups installed").

-- ---------------------------------------------------------------------------
-- 1. Settings (on the lead follow-ups row, its own section in Settings)
-- ---------------------------------------------------------------------------

alter table public.lead_followup_settings
  add column if not exists nurture_enabled       boolean not null default false,
  add column if not exists nurture_roadmap_days  smallint not null default 3,
  add column if not exists nurture_overdue_days  smallint not null default 3,
  add column if not exists nurture_quiet_days    smallint not null default 4;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_followup_settings_nurture_days_check') then
    alter table public.lead_followup_settings add constraint lead_followup_settings_nurture_days_check
      check (nurture_roadmap_days between 1 and 30 and nurture_overdue_days between 1 and 30 and nurture_quiet_days between 0 and 30);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. What the borrower reported (unverified until a person verifies it)
-- ---------------------------------------------------------------------------

create table if not exists public.nurture_updates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  contact_id       uuid references public.contacts (id) on delete set null,
  milestone_id     uuid references public.readiness_milestones (id) on delete set null,
  -- The newest message of the reply it came from (null when typed by the loan officer).
  message_id       uuid references public.messages (id) on delete set null,
  source           text not null default 'reply' check (source in ('reply', 'typed')),
  status           text not null default 'queued' check (status in ('queued', 'unverified', 'verified', 'dismissed')),
  kind             text check (kind is null or kind in ('progress', 'reported_done', 'question', 'setback', 'other')),
  summary          text check (summary is null or length(summary) <= 1000),
  suggested_next   text check (suggested_next is null or length(suggested_next) <= 500),
  confidence       text check (confidence is null or confidence in ('high', 'medium', 'low')),
  ai_run_id        uuid references public.ai_runs (id) on delete set null,
  attempts         smallint not null default 0,
  claimed_at       timestamptz,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  verified_by      uuid references public.profiles (id) on delete set null,
  verified_at      timestamptz,
  constraint nurture_updates_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint nurture_updates_verified_recorded check (status <> 'verified' or verified_at is not null)
);
create index if not exists nurture_updates_loan_idx on public.nurture_updates (loan_id, created_at desc);
create index if not exists nurture_updates_queued_idx on public.nurture_updates (created_at) where status = 'queued';

drop trigger if exists nurture_updates_set_updated_at on public.nurture_updates;
create trigger nurture_updates_set_updated_at before update on public.nurture_updates
  for each row execute function public.set_updated_at();

alter table public.nurture_updates enable row level security;
drop policy if exists "file members see nurture updates" on public.nurture_updates;
create policy "file members see nurture updates" on public.nurture_updates for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "file members add nurture updates" on public.nurture_updates;
create policy "file members add nurture updates" on public.nurture_updates for insert to authenticated with check (public.can_see_loan(loan_id) and source = 'typed');
drop policy if exists "file members change nurture updates" on public.nurture_updates;
create policy "file members change nurture updates" on public.nurture_updates for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));

-- The AI (service role) only fills in a queued reading; only a person verifies.
create or replace function public.guard_nurture_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_person boolean := auth.uid() is not null and current_user <> 'service_role';
begin
  if tg_op = 'INSERT' then
    if new.status = 'verified' then raise exception 'An update is verified after it is added.'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'verified' then
      if not v_person then raise exception 'Only the loan officer can verify an update.'; end if;
      new.verified_at := now();
      new.verified_by := auth.uid();
    elsif new.status = 'unverified' and old.status <> 'queued' and not v_person then
      raise exception 'Only the loan officer can change a decided update.';
    elsif new.status = 'queued' and old.status <> 'queued' then
      raise exception 'An update that was read can''t go back to the queue.';
    end if;
    if new.status <> 'verified' then
      new.verified_at := null;
      new.verified_by := null;
    end if;
  elsif not v_person and old.status <> 'queued' then
    raise exception 'Only the loan officer can change a decided update.';
  end if;
  if (new.loan_id, new.organization_id, new.source, new.created_at) is distinct from (old.loan_id, old.organization_id, old.source, old.created_at) then
    raise exception 'That part of an update can''t change.';
  end if;
  return new;
end;
$$;

drop trigger if exists nurture_updates_guard on public.nurture_updates;
create trigger nurture_updates_guard before insert or update on public.nurture_updates
  for each row execute function public.guard_nurture_update();

-- Verify (and optionally tick the milestone as done, as this person).
create or replace function public.verify_nurture_update(p_id uuid, p_milestone_done boolean default false)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  u public.nurture_updates;
begin
  if auth.uid() is null then raise exception 'Only the loan officer can verify an update.'; end if;
  select * into u from public.nurture_updates where id = p_id;
  if u.id is null then raise exception 'You do not have permission to change this file.'; end if;
  update public.nurture_updates set status = 'verified' where id = p_id;
  if p_milestone_done and u.milestone_id is not null then
    update public.readiness_milestones set status = 'done' where id = u.milestone_id and status <> 'done';
  end if;
end;
$$;

revoke all on function public.verify_nurture_update(uuid, boolean) from public, anon;
grant execute on function public.verify_nurture_update(uuid, boolean) to authenticated;

-- The assistant takes up to N queued replies at a time (tried 3 times, then left for Connor).
create or replace function public.claim_nurture_updates(p_limit integer default 5)
returns setof public.nurture_updates
language sql
security definer
set search_path = ''
as $$
  update public.nurture_updates u set claimed_at = now(), attempts = u.attempts + 1
  where u.id in (
    select x.id from public.nurture_updates x
    where x.status = 'queued' and x.source = 'reply' and x.attempts < 3
      and (x.claimed_at is null or x.claimed_at < now() - interval '10 minutes')
    order by x.created_at
    limit greatest(1, least(p_limit, 10))
    for update skip locked
  )
  returning u.*;
$$;

revoke all on function public.claim_nurture_updates(integer) from public, anon, authenticated;
grant execute on function public.claim_nurture_updates(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Notification kind for a Nurture borrower's reply
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission', 'estimate_picked', 'portal_request', 'portal_upload', 'application_submitted', 'nurture_reply'));

-- ---------------------------------------------------------------------------
-- 4. A message from a Nurture borrower
-- ---------------------------------------------------------------------------

create or replace function public.nurture_reply_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  v_id uuid;
  v_name text;
begin
  if new.direction <> 'inbound' or new.contact_id is null then return null; end if;
  -- A bare STOP / unsubscribe is an opt-out, not an update.
  if new.body ~* '^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]*\s*$' then return null; end if;
  for l in
    select ln.id, ln.organization_id, ln.assigned_lo_id, ln.nurture_stage
    from public.loans ln join public.loan_borrowers b on b.loan_id = ln.id
    where b.contact_id = new.contact_id and ln.stage::text = 'nurture'
  loop
    update public.action_items set status = 'dismissed', decided_at = now(), skipped_reason = 'borrower_replied'
    where loan_id = l.id and source = 'nurture_milestone' and status = 'pending';
    -- One queued update per file: later messages before it's read just move it to the newest.
    update public.nurture_updates set message_id = new.id, contact_id = new.contact_id
    where loan_id = l.id and status = 'queued' and source = 'reply'
    returning id into v_id;
    if v_id is null then
      insert into public.nurture_updates (organization_id, loan_id, contact_id, message_id, source, status, created_by)
      values (l.organization_id, l.id, new.contact_id, new.id, 'reply', 'queued', null)
      returning id into v_id;
    end if;
    if l.nurture_stage = 'paused' then
      update public.loans set nurture_stage = 'working' where id = l.id;
    end if;
    select trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = new.contact_id;
    perform public.notify_user(l.organization_id, l.assigned_lo_id, 'nurture_reply',
      'Nurture reply: ' || coalesce(nullif(v_name, ''), 'a borrower'),
      left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 160),
      '/loans/' || l.id::text, v_id);
    v_id := null;
  end loop;
  return null;
end;
$$;

revoke all on function public.nurture_reply_received() from public, anon, authenticated;
drop trigger if exists messages_nurture_reply on public.messages;
create trigger messages_nurture_reply after insert on public.messages
  for each row execute function public.nurture_reply_received();

-- ---------------------------------------------------------------------------
-- 5. Waiting drafts go stale; stages follow the milestones a person ticks
-- ---------------------------------------------------------------------------

create or replace function public.nurture_draft_decided()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'nurture_milestone' and old.status = 'pending' and new.status in ('approved', 'edited') and new.sent_at is null then
    new.sent_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists action_items_nurture_decided on public.action_items;
create trigger action_items_nurture_decided before update of status on public.action_items
  for each row execute function public.nurture_draft_decided();

create or replace function public.nurture_loan_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.stage is distinct from old.stage and new.stage::text <> 'nurture')
     or (new.nurture_stage is distinct from old.nurture_stage and new.nurture_stage in ('paused', 'ready_prequal')) then
    update public.action_items set status = 'dismissed', decided_at = now(),
      skipped_reason = case when new.stage::text <> 'nurture' then 'no_longer_in_nurture' else 'nurture_' || new.nurture_stage end
    where loan_id = new.id and source = 'nurture_milestone' and status = 'pending';
  end if;
  return null;
end;
$$;

revoke all on function public.nurture_loan_changed() from public, anon, authenticated;
drop trigger if exists loans_nurture_changed on public.loans;
create trigger loans_nurture_changed after update on public.loans
  for each row execute function public.nurture_loan_changed();

create or replace function public.readiness_milestone_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open integer;
begin
  if new.status = old.status then return null; end if;
  if new.status = 'done' then
    update public.action_items set status = 'dismissed', decided_at = now(), skipped_reason = 'milestone_done'
    where loan_id = new.loan_id and source = 'nurture_milestone' and status = 'pending'
      and payload->'nurture'->>'milestoneId' = new.id::text;
  end if;
  if not exists (select 1 from public.readiness_plans p where p.id = new.plan_id and p.status = 'approved') then return null; end if;
  select count(*) into v_open from public.readiness_milestones m
  where m.plan_id = new.plan_id and m.action_id is not null and m.status <> 'done';
  if new.status = 'done' and v_open = 0 then
    update public.loans set nurture_stage = 'ready_reassess'
    where id = new.loan_id and stage::text = 'nurture' and nurture_stage in ('plan_generated', 'plan_delivered', 'working', 'waiting_milestone');
  elsif new.status = 'done' then
    update public.loans set nurture_stage = 'working'
    where id = new.loan_id and stage::text = 'nurture' and nurture_stage in ('plan_generated', 'plan_delivered', 'waiting_milestone');
  end if;
  return null;
end;
$$;

revoke all on function public.readiness_milestone_changed() from public, anon, authenticated;
drop trigger if exists readiness_milestones_changed on public.readiness_milestones;
create trigger readiness_milestones_changed after update of status on public.readiness_milestones
  for each row execute function public.readiness_milestone_changed();

-- A new plan version replaces the old one's waiting drafts.
create or replace function public.readiness_plan_superseded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'superseded' and old.status = 'approved' then
    update public.action_items set status = 'dismissed', decided_at = now(), skipped_reason = 'plan_revised'
    where loan_id = new.loan_id and source = 'nurture_milestone' and status = 'pending'
      and payload->'nurture'->>'planId' = new.id::text;
  end if;
  return null;
end;
$$;

revoke all on function public.readiness_plan_superseded() from public, anon, authenticated;
drop trigger if exists readiness_plans_superseded on public.readiness_plans;
create trigger readiness_plans_superseded after update of status on public.readiness_plans
  for each row execute function public.readiness_plan_superseded();

-- ---------------------------------------------------------------------------
-- 6. One file: draft its nurture follow-up if one is due (returns what happened)
-- ---------------------------------------------------------------------------

create or replace function public.draft_nurture_followup(p_loan_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  s public.lead_followup_settings%rowtype;
  pl record;
  m record;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_last_out timestamptz;
  v_last_in timestamptz;
  v_last_item timestamptz;
  v_quiet_since date;
  v_kind text;
  v_key text;
  v_channel text;
  v_first text;
  v_lo text;
  v_lo_full text;
  v_name text;
  v_title text;
  v_when text;
  v_body text;
  v_subject text;
  v_reason text;
  v_priority text := 'normal';
  v_id uuid;
  v_mid uuid;
  v_measure text;
  v_target date;
  v_action text;
begin
  select ln.id, ln.organization_id, ln.stage::text as stage, ln.nurture_stage, ln.on_hold_at, ln.assigned_lo_id, ln.nurture_target,
         c.id as contact_id, c.first_name, c.last_name, c.phone, c.email,
         c.sms_consent, c.email_consent, c.sms_opted_out_at, c.email_opted_out_at,
         p.full_name, p.email as lo_email
    into l
  from public.loans ln
  join public.loan_borrowers lb on lb.loan_id = ln.id and lb.role = 'primary'
  join public.contacts c on c.id = lb.contact_id
  left join public.profiles p on p.id = ln.assigned_lo_id
  where ln.id = p_loan_id;
  if not found then return 'no borrower'; end if;
  select * into s from public.lead_followup_settings where organization_id = l.organization_id;
  if not found or not s.nurture_enabled then return 'nurture drafts are off'; end if;
  if l.stage <> 'nurture' then return 'not in Nurture'; end if;
  if l.nurture_stage in ('paused', 'ready_prequal') then return 'nurture stage ' || l.nurture_stage; end if;
  if l.on_hold_at is not null then return 'on hold'; end if;
  if l.assigned_lo_id is null then return 'no loan officer'; end if;
  if exists (select 1 from public.messaging_settings ms where ms.organization_id = l.organization_id and ms.inbound_mode = 'test_only')
     and (coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) !~* '\mtest\M' then
    return 'test mode (TEST people only)';
  end if;
  if exists (select 1 from public.action_items a where a.loan_id = l.id and a.source = 'nurture_milestone' and a.status = 'pending') then
    return 'one is already waiting';
  end if;
  if exists (select 1 from public.send_approvals a where a.loan_id = l.id and a.send_at > now() and a.used_at is null and a.voided_at is null) then
    return 'a message is scheduled';
  end if;
  select id, version, goal into pl from public.readiness_plans where loan_id = l.id and status = 'approved';
  if pl.id is null then return 'no approved plan'; end if;

  -- Quiet days: no draft right after any message either way or the last nurture draft.
  select greatest(
    (select max(x.sent_at) from public.messages x where x.direction = 'outbound' and x.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id)),
    (select max(n.created_at) from public.notes n where n.kind::text in ('call', 'text', 'email', 'meeting') and n.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id))
  ) into v_last_out;
  select max(x.sent_at) into v_last_in from public.messages x
  where x.direction = 'inbound' and x.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id);
  select max(a.created_at) into v_last_item from public.action_items a where a.loan_id = l.id and a.source = 'nurture_milestone';
  v_quiet_since := (greatest(v_last_out, v_last_in, v_last_item) at time zone 'America/Chicago')::date;
  if v_quiet_since is not null and v_quiet_since + s.nurture_quiet_days > v_today then
    return 'talked recently';
  end if;

  -- What's due, most important first.
  if exists (select 1 from public.readiness_milestones x where x.plan_id = pl.id and x.action_id is not null)
     and not exists (select 1 from public.readiness_milestones x where x.plan_id = pl.id and x.action_id is not null and x.status <> 'done') then
    v_kind := 'reassess';
    v_key := 'nurture:' || pl.id || ':reassess';
    v_priority := 'high';
    v_reason := 'Every milestone on the plan is marked done: ask for a review.';
  elsif l.nurture_stage = 'plan_delivered'
     and (v_last_out is null or (v_last_out at time zone 'America/Chicago')::date + s.nurture_roadmap_days <= v_today) then
    v_kind := 'roadmap';
    v_key := 'nurture:' || pl.id || ':roadmap';
    v_reason := 'The roadmap went out ' || coalesce(((v_today - (v_last_out at time zone 'America/Chicago')::date))::text || ' days ago', 'a while ago') || ' with no reply.';
  end if;
  if v_kind is not null and exists (select 1 from public.action_items a where a.organization_id = l.organization_id and a.source_key = v_key) then
    v_kind := null; -- Already asked once.
  end if;

  if v_kind is null then
    select x.id, x.title, x.measure, x.target_date, x.follow_up_date, ra.title as action_title, k.kind, k.rank
      into m
    from public.readiness_milestones x
    join public.readiness_actions ra on ra.id = x.action_id
    cross join lateral (
      select case
        when v_today >= x.target_date + s.nurture_overdue_days then 'overdue'
        when v_today >= x.target_date then 'due'
        when v_today >= coalesce(x.follow_up_date, x.target_date - 3) then 'check_in'
      end as kind,
      case
        when v_today >= x.target_date + s.nurture_overdue_days then 3
        when v_today >= x.target_date then 2
        when v_today >= coalesce(x.follow_up_date, x.target_date - 3) then 1
        else 0
      end as rank
    ) k
    where x.plan_id = pl.id and x.status = 'outstanding' and x.target_date is not null and k.rank > 0
      -- Not one they've just reported on.
      and not exists (select 1 from public.nurture_updates u where u.milestone_id = x.id and u.status in ('queued', 'unverified') and u.created_at > now() - interval '14 days')
      -- Each kind once, and never a softer one after a firmer one.
      and not exists (
        select 1 from public.action_items a
        where a.organization_id = l.organization_id and a.source = 'nurture_milestone'
          and a.payload->'nurture'->>'milestoneId' = x.id::text
          and case a.payload->'nurture'->>'kind' when 'overdue' then 3 when 'due' then 2 when 'check_in' then 1 else 0 end >= k.rank
      )
    order by k.rank desc, x.target_date, x.sort_order
    limit 1;
    if m.id is null then return 'nothing due'; end if;
    v_kind := m.kind;
    v_key := 'nurture:' || m.id || ':' || m.kind;
    v_title := m.title;
    v_mid := m.id;
    v_measure := m.measure;
    v_target := m.target_date;
    v_action := m.action_title;
    v_when := to_char(m.target_date, 'Mon FMDD');
    if v_kind = 'overdue' then v_priority := 'high'; end if;
    v_reason := case v_kind
      when 'check_in' then 'Check-in: "' || m.title || '" is due ' || v_when || '.'
      when 'due' then '"' || m.title || '" was due ' || v_when || '.'
      else '"' || m.title || '" is ' || (v_today - m.target_date) || ' days past its target (' || v_when || ').'
    end;
  end if;

  v_channel := case
    when l.sms_consent is true and l.sms_opted_out_at is null and l.phone is not null then 'text'
    when l.email_consent is true and l.email_opted_out_at is null and l.email is not null then 'email'
    when l.sms_consent is not false and l.sms_opted_out_at is null and l.phone is not null then 'text'
    when l.email_consent is not false and l.email_opted_out_at is null and l.email is not null then 'email'
  end;
  if v_channel is null then return 'no way to reach them (opted out or no phone/email)'; end if;

  v_name := trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, ''));
  v_first := coalesce(nullif(trim(l.first_name), ''), 'there');
  v_lo_full := coalesce(nullif(trim(l.full_name), ''), split_part(l.lo_email, '@', 1), 'your loan officer');
  v_lo := coalesce(nullif(split_part(trim(l.full_name), ' ', 1), ''), split_part(l.lo_email, '@', 1), 'your loan officer');
  v_body := case v_kind
    when 'roadmap' then 'Hey ' || v_first || ', it''s ' || v_lo || '. Did you get a chance to look over your roadmap? Happy to walk through any of it with you.'
    when 'check_in' then 'Hey ' || v_first || ', it''s ' || v_lo || '. Quick check-in on your plan: next up is "' || v_title || '" by ' || v_when || '. How''s it going?'
    when 'due' then 'Hey ' || v_first || ', "' || v_title || '" was on your plan for ' || v_when || '. How did it go? Send me an update when you can.'
    when 'overdue' then 'Hey ' || v_first || ', checking in on "' || v_title || '" from your plan. No pressure. If things changed, we can adjust the plan together.'
    else 'Hey ' || v_first || ', it''s ' || v_lo || '. Nice work on your plan. Let''s set up a quick review of your updated info to see where things stand. When works for you?'
  end;
  if v_channel = 'email' then
    v_subject := case v_kind when 'roadmap' then 'Your roadmap' when 'reassess' then 'Time for a review' else 'Checking in on your plan' end;
    v_body := regexp_replace(v_body, '^Hey [^,]*, ', '');
    v_body := regexp_replace(v_body, '^it''s [^.]*\. ', '');
    v_body := 'Hi ' || v_first || ',' || E'\n\n' || upper(left(v_body, 1)) || substr(v_body, 2) || E'\n\n' || 'Thanks,' || E'\n' || v_lo_full;
  end if;

  insert into public.action_items (organization_id, loan_id, kind, title, payload, sources, source_key, source, priority, due_on, created_by)
  values (l.organization_id, l.id, 'draft_message', 'Nurture follow-up: ' || v_name,
    jsonb_build_object(
      'channel', v_channel,
      'to', v_name || ' (borrower)',
      'subject', v_subject,
      'body', v_body,
      'contactId', l.contact_id,
      'nurture', jsonb_build_object(
        'kind', v_kind, 'planId', pl.id, 'planVersion', pl.version, 'goal', pl.goal,
        'milestoneId', v_mid, 'milestoneTitle', v_title, 'measure', v_measure, 'targetDate', v_target, 'actionTitle', v_action,
        'nurtureStage', l.nurture_stage, 'target', l.nurture_target, 'lastContactAt', v_last_out, 'reason', v_reason)
    ),
    '[]'::jsonb, v_key, 'nurture_milestone', v_priority, v_today, null)
  on conflict (organization_id, source_key) do nothing
  returning id into v_id;
  return case when v_id is null then 'already drafted' else 'drafted' end;
end;
$$;

revoke all on function public.draft_nurture_followup(uuid) from public, anon, authenticated;

create or replace function public.draft_nurture_followups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select ln.id from public.loans ln
    join public.lead_followup_settings s on s.organization_id = ln.organization_id and s.nurture_enabled
    where ln.stage::text = 'nurture'
  loop
    begin
      if public.draft_nurture_followup(r.id) = 'drafted' then n := n + 1; end if;
    exception when others then
      raise warning 'nurture follow-up for % skipped: %', r.id, sqlerrm; -- One bad file never stops the rest.
    end;
  end loop;
  return n;
end;
$$;

revoke all on function public.draft_nurture_followups() from public, anon, authenticated;

-- The timer: draft, then ask the assistant to read replies and word texts (when there's work).
create or replace function public.run_nurture_followups()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drafted integer;
  v_url text;
  v_key text;
  v_anon text;
  v_request bigint;
begin
  v_drafted := public.draft_nurture_followups();
  if not exists (select 1 from public.nurture_updates u where u.status = 'queued' and u.source = 'reply' and u.attempts < 3)
     and not exists (
       select 1 from public.action_items a
       where a.source = 'nurture_milestone' and a.status = 'pending' and a.kind = 'draft_message'
         and a.payload->>'worded' is null and a.payload->>'channel' = 'text' and a.created_at > now() - interval '2 days'
     ) then
    return 'Drafted ' || v_drafted || '; nothing for the assistant.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'losuite_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ghl_webhook_secret' limit 1;
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'losuite_anon_key' limit 1;
  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_key), '') = '' or coalesce(trim(v_anon), '') = '' then
    return 'Drafted ' || v_drafted || '; the assistant was not asked: add losuite_project_url, ghl_webhook_secret and losuite_anon_key in Supabase Vault first.';
  end if;
  select net.http_post(
    url := rtrim(trim(v_url), '/') || '/functions/v1/assistant?key=' || trim(v_key),
    body := jsonb_build_object('task', 'nurture_due'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || trim(v_anon)),
    timeout_milliseconds := 120000
  ) into v_request;
  return 'Drafted ' || v_drafted || '; asked the assistant (request ' || v_request || ').';
end;
$$;

revoke all on function public.run_nurture_followups() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reassess for Prequalification: back to New lead (contacted)
-- ---------------------------------------------------------------------------

create or replace function public.reassess_nurture(p_loan_id uuid, p_note text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l record;
  v_done integer;
  v_all integer;
  v_contact uuid;
begin
  if auth.uid() is null then raise exception 'Only a signed-in person can reassess a file.'; end if;
  select id, organization_id, stage::text as stage into l from public.loans where id = p_loan_id;
  if l.id is null then raise exception 'You do not have permission to change this file.'; end if;
  if l.stage <> 'nurture' then raise exception 'This file is not in Nurture.'; end if;
  select count(*) filter (where m.status = 'done'), count(*) into v_done, v_all
  from public.readiness_milestones m join public.readiness_plans p on p.id = m.plan_id
  where p.loan_id = l.id and p.status = 'approved';
  perform set_config('mps.change_reason', 'Reassessed for prequalification', true);
  update public.loans set stage = 'contacted' where id = l.id;
  select b.contact_id into v_contact from public.loan_borrowers b where b.loan_id = l.id and b.role = 'primary' limit 1;
  if v_contact is not null then
    insert into public.notes (organization_id, contact_id, loan_id, kind, body)
    values (l.organization_id, v_contact, l.id, 'note',
      'Reassessed for prequalification: back to New lead.' ||
      case when v_all > 0 then ' Plan milestones done: ' || v_done || ' of ' || v_all || '.' else '' end ||
      coalesce(' ' || nullif(trim(p_note), ''), ''));
  end if;
end;
$$;

revoke all on function public.reassess_nurture(uuid, text) from public, anon;
grant execute on function public.reassess_nurture(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The timer: every 15 minutes
-- ---------------------------------------------------------------------------

select cron.unschedule('mpshq-nurture-drafts') where exists (select 1 from cron.job where jobname = 'mpshq-nurture-drafts');
select cron.schedule('mpshq-nurture-drafts', '*/15 * * * *', 'select public.run_nurture_followups()');

select
  'MPS HQ nurture follow-ups installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'nurture_updates') as updates_table,
  (select count(*) from cron.job where jobname = 'mpshq-nurture-drafts') as timer,
  (select coalesce(bool_or(nurture_enabled), false) from public.lead_followup_settings) as turned_on;
