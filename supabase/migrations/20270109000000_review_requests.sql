-- MPS HQ: review requests after closing (build plan Phase 6).
--
-- Every closed loan gets a review request DRAFTED into the Action Queue,
-- never sent on its own: it goes out only when someone presses Send, through
-- the usual approval, consent and sending-hours checks.
--   review_settings      one row per company (owners and admins edit): the
--                        company review link (required to turn it on), an
--                        optional second link ("or here"), days after funding
--                        (3), one follow-up after N days (on, 7), the text and
--                        email wording, and drafts_from (loans funded before
--                        it get no automatic draft: no backfill)
--   profiles.review_link an LO's own review link, used instead of the company's
--   loans.review_*       status (not_requested, drafted, requested,
--                        follow_up_sent, received, skipped), when it was
--                        requested, when it was received, and "Don't ask for a
--                        review" with a note; every change is in loan_change_log
--   draft_review_requests()  the daily job (pg_cron, 8 AM Central): drafts the
--                        first request (funding + N days, or closing when there's
--                        no funding date; skip off; not asked; consent on text,
--                        else email; the person not asked on another loan in 12
--                        months) under source_key review:<loan>, and the one
--                        follow-up under review-followup:<loan>. A key can never
--                        draft twice, so a loan is asked at most twice.
--   request_review()     the closed Overview's "Request review" for older loans
--                        (the same draft, without the date and backfill rules)
--   mark_review_received()  records the date and drops a waiting follow-up
-- Sending a review draft marks the loan requested (or follow-up sent);
-- dismissing the first one marks it skipped.
-- COMPLIANCE: the wording is subject to Connor's compliance review: neutral
-- (no review gating) and no incentives.
-- Apply after the partner messages script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ review requests installed").

create table if not exists public.review_settings (
  organization_id   uuid primary key,
  enabled           boolean not null default false,
  company_link      text check (company_link is null or company_link ~* '^https://'),
  second_link       text check (second_link is null or second_link ~* '^https://'),
  days_after        smallint not null default 3 check (days_after between 0 and 60),
  follow_up         boolean not null default true,
  follow_up_days    smallint not null default 7 check (follow_up_days between 1 and 60),
  text_template     text not null default 'Hi {first}, it''s {lo}. Congrats again on closing! If you have a minute, would you leave a quick review of your experience? {link} Thank you!',
  email_subject     text not null default 'Thank you, {first}!',
  email_template    text not null default E'Hi {first},\n\nCongratulations again on closing, and thank you for letting us help with your loan.\n\nIf you have a minute, would you leave a quick review of your experience? It helps other families find us.\n\n{link}\n\nThank you!\n{lo}',
  drafts_from       date not null default (now() at time zone 'America/Chicago')::date,
  updated_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  constraint review_settings_link_to_turn_on check (not enabled or company_link is not null),
  constraint review_settings_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint review_settings_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null
);

alter table public.review_settings enable row level security;
drop policy if exists "members see review settings" on public.review_settings;
create policy "members see review settings" on public.review_settings
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add review settings" on public.review_settings;
create policy "managers add review settings" on public.review_settings
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit review settings" on public.review_settings;
create policy "managers edit review settings" on public.review_settings
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));

alter table public.profiles add column if not exists review_link text;
alter table public.profiles drop constraint if exists profiles_review_link_check;
alter table public.profiles add constraint profiles_review_link_check check (review_link is null or review_link ~* '^https://');

alter table public.loans add column if not exists review_status text not null default 'not_requested';
alter table public.loans add column if not exists review_requested_at timestamptz;
alter table public.loans add column if not exists review_received_on date;
alter table public.loans add column if not exists review_skip boolean not null default false;
alter table public.loans add column if not exists review_skip_note text;
alter table public.loans drop constraint if exists loans_review_status_check;
alter table public.loans add constraint loans_review_status_check check (review_status in ('not_requested', 'drafted', 'requested', 'follow_up_sent', 'received', 'skipped'));

-- The change log (Phase 1) now also covers the review fields.
create or replace function public.log_loan_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(current_setting('mps.change_reason', true)), '');
  v_by uuid := auth.uid();
begin
  insert into public.loan_change_log (organization_id, loan_id, field, old_value, new_value, changed_by, reason)
  select new.organization_id, new.id, f.field, f.old_value, f.new_value, v_by, v_reason
  from (values
    ('closing_date', old.closing_date::text, new.closing_date::text),
    ('funding_date', old.funding_date::text, new.funding_date::text),
    ('revenue_type', old.revenue_type::text, new.revenue_type::text),
    ('revenue_value', old.revenue_value::text, new.revenue_value::text),
    ('assigned_lo_id', old.assigned_lo_id::text, new.assigned_lo_id::text),
    ('comp_plan_id', old.comp_plan_id::text, new.comp_plan_id::text),
    ('lead_source_type', old.lead_source_type, new.lead_source_type),
    ('comp_base_mode', old.comp_base_mode, new.comp_base_mode),
    ('comp_base_bps', old.comp_base_bps::text, new.comp_base_bps::text),
    ('comp_split_pct', old.comp_split_pct::text, new.comp_split_pct::text),
    ('comp_member_type', old.comp_member_type, new.comp_member_type),
    ('review_status', old.review_status, new.review_status),
    ('review_received_on', old.review_received_on::text, new.review_received_on::text),
    ('review_skip', old.review_skip::text, new.review_skip::text)
  ) as f(field, old_value, new_value)
  where f.old_value is distinct from f.new_value;
  return new;
end;
$$;

revoke all on function public.log_loan_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Drafting one request (shared by the daily job and the manual button).
-- ---------------------------------------------------------------------------

create or replace function public.draft_review(p_loan_id uuid, p_follow_up boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  s public.review_settings%rowtype;
  v_channel text;
  v_link text;
  v_first text;
  v_lo text;
  v_key text := case when p_follow_up then 'review-followup:' else 'review:' end || p_loan_id::text;
  v_body text;
  v_id uuid;
begin
  select ln.id, ln.organization_id, ln.review_skip, c.id as contact_id, c.first_name, c.last_name, c.phone, c.email,
         (c.sms_consent is true and c.sms_opted_out_at is null and c.phone is not null) as sms_ok,
         (c.email_consent is true and c.email_opted_out_at is null and c.email is not null) as email_ok,
         p.full_name, p.email as lo_email, p.review_link
    into l
  from public.loans ln
  join public.loan_borrowers lb on lb.loan_id = ln.id and lb.role = 'primary'
  join public.contacts c on c.id = lb.contact_id
  left join public.profiles p on p.id = ln.assigned_lo_id
  where ln.id = p_loan_id;
  if not found then return 'no borrower'; end if;
  if l.review_skip then return 'skipped'; end if;
  select * into s from public.review_settings where organization_id = l.organization_id;
  if not found or not s.enabled or s.company_link is null then return 'reviews are off'; end if;
  v_channel := case when l.sms_ok then 'text' when l.email_ok then 'email' end;
  if v_channel is null then return 'no consent'; end if;

  v_link := coalesce(nullif(trim(l.review_link), ''), s.company_link) || coalesce(' or here: ' || nullif(trim(s.second_link), ''), '');
  v_first := coalesce(nullif(trim(l.first_name), ''), 'there');
  v_lo := coalesce(nullif(split_part(trim(l.full_name), ' ', 1), ''), split_part(l.lo_email, '@', 1), 'your loan officer');
  v_body := replace(replace(replace(case when v_channel = 'text' then s.text_template else s.email_template end, '{first}', v_first), '{lo}', v_lo), '{link}', v_link);
  if p_follow_up then
    v_body := case when v_channel = 'text' then 'Just a friendly follow-up: ' || v_body else 'Just a friendly follow-up.' || E'\n\n' || v_body end;
  end if;

  insert into public.action_items (organization_id, loan_id, kind, title, payload, sources, source_key, created_by)
  values (
    l.organization_id, l.id, 'draft_message',
    case when p_follow_up then 'Review follow-up: ' else 'Review request: ' end || trim(l.first_name || ' ' || coalesce(l.last_name, '')),
    jsonb_build_object(
      'channel', v_channel,
      'to', trim(l.first_name || ' ' || coalesce(l.last_name, '')) || ' (borrower)',
      'subject', case when v_channel = 'email' then replace(s.email_subject, '{first}', v_first) end,
      'body', v_body,
      'contactId', l.contact_id
    ),
    '[]'::jsonb, v_key, null
  )
  on conflict (organization_id, source_key) do nothing
  returning id into v_id;
  if v_id is null then return 'already drafted'; end if;
  if not p_follow_up then update public.loans set review_status = 'drafted' where id = l.id and review_status = 'not_requested'; end if;
  return 'drafted';
end;
$$;

revoke all on function public.draft_review(uuid, boolean) from public, anon, authenticated;

-- The daily job: every company with reviews on.
create or replace function public.draft_review_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  -- First requests.
  for r in
    select ln.id
    from public.loans ln
    join public.review_settings s on s.organization_id = ln.organization_id and s.enabled and s.company_link is not null
    join public.loan_borrowers lb on lb.loan_id = ln.id and lb.role = 'primary'
    where ln.stage = 'closed' and ln.review_status = 'not_requested' and not ln.review_skip
      and coalesce(ln.funding_date, ln.closing_date) is not null
      and coalesce(ln.funding_date, ln.closing_date) >= s.drafts_from
      and coalesce(ln.funding_date, ln.closing_date) + s.days_after <= v_today
      -- A repeat client asked on another loan in the last 12 months isn't asked again.
      and not exists (
        select 1 from public.loan_borrowers ob join public.loans o on o.id = ob.loan_id
        where ob.contact_id = lb.contact_id and o.id <> ln.id and o.review_requested_at > now() - interval '12 months'
      )
  loop
    if public.draft_review(r.id, false) = 'drafted' then n := n + 1; end if;
  end loop;
  -- The one follow-up.
  for r in
    select ln.id
    from public.loans ln
    join public.review_settings s on s.organization_id = ln.organization_id and s.enabled and s.follow_up and s.company_link is not null
    where ln.review_status = 'requested' and not ln.review_skip and ln.review_requested_at is not null
      and (ln.review_requested_at at time zone 'America/Chicago')::date + s.follow_up_days <= v_today
  loop
    if public.draft_review(r.id, true) = 'drafted' then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.draft_review_requests() from public, anon, authenticated;

-- "Request review" for a closed loan that funded before this shipped (same draft, no date rules).
create or replace function public.request_review(p_loan_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.can_see_loan(p_loan_id) or not public.may_approve_send(p_loan_id, auth.uid()) then
    raise exception 'Only this file''s loan officer or an admin can request a review.';
  end if;
  select review_status into v_status from public.loans where id = p_loan_id and stage = 'closed';
  if v_status is null then raise exception 'Reviews are requested on closed files.'; end if;
  if v_status <> 'not_requested' then raise exception 'A review was already drafted or requested on this loan.'; end if;
  return public.draft_review(p_loan_id, false);
end;
$$;

revoke all on function public.request_review(uuid) from public, anon;
grant execute on function public.request_review(uuid) to authenticated;

create or replace function public.mark_review_received(p_loan_id uuid, p_on date default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.loans set review_status = 'received', review_received_on = coalesce(p_on, (now() at time zone 'America/Chicago')::date) where id = p_loan_id;
  if not found then raise exception 'You do not have permission to change this loan.'; end if;
  -- No follow-up once the review is in.
  update public.action_items set status = 'dismissed', decided_at = now(), decided_by = auth.uid()
  where loan_id = p_loan_id and source_key = 'review-followup:' || p_loan_id::text and status = 'pending';
end;
$$;

revoke all on function public.mark_review_received(uuid, date) from public, anon;
grant execute on function public.mark_review_received(uuid, date) to authenticated;

-- Sending a review draft marks the loan; dismissing the first one marks it skipped.
create or replace function public.review_draft_decided()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' and new.source_key like 'review%:%' then
    if new.source_key = 'review:' || new.loan_id::text then
      update public.loans set
        review_status = case when new.status = 'dismissed' then 'skipped' else 'requested' end,
        review_requested_at = case when new.status = 'dismissed' then review_requested_at else now() end
      where id = new.loan_id and review_status = 'drafted';
    elsif new.source_key = 'review-followup:' || new.loan_id::text and new.status <> 'dismissed' then
      update public.loans set review_status = 'follow_up_sent' where id = new.loan_id and review_status = 'requested';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.review_draft_decided() from public, anon, authenticated;
drop trigger if exists action_items_review_decided on public.action_items;
create trigger action_items_review_decided after update of status on public.action_items
  for each row execute function public.review_draft_decided();

-- Every morning at 14:00 UTC: 8 AM Central in winter, 9 AM in summer.
select cron.unschedule('mpshq-review-requests') where exists (select 1 from cron.job where jobname = 'mpshq-review-requests');
select cron.schedule('mpshq-review-requests', '0 14 * * *', 'select public.draft_review_requests()');

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ review requests installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'review_settings') as settings_table,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('review_status', 'review_requested_at', 'review_received_on', 'review_skip', 'review_skip_note')) as loan_columns,
  (select count(*) from pg_proc where proname in ('draft_review', 'draft_review_requests', 'request_review', 'mark_review_received', 'review_draft_decided')) as functions,
  (select count(*) from cron.job where jobname = 'mpshq-review-requests') as daily_job;
