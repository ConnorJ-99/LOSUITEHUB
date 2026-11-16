-- MPS HQ: suggested lead follow-ups (Connor, 2026-11-16; plan
-- docs/plans/lead-follow-ups.md, step 3). Drafts only: nothing here sends.
--
-- Every 30 minutes pg_cron runs draft_lead_followups(): for each company with
-- lead follow-ups turned on (Settings → Lead follow-ups, off until Connor turns
-- it on), each file in a lead stage whose Next Action is due gets one draft in
-- the Action Queue (action_items.source = 'lead_followup'), worded in code:
--   new lead (added by hand, never contacted)  same day, an intro text
--   Waiting on Application / In Progress       the portal link to finish it
--   Waiting on Documents                       exactly the open checklist
--                                              items, in plain words, + link
--   Needs LO Review                            a task for the loan officer
--   Ready to Shop / Property Found / Waiting on Borrower   a short check-in
-- Due = the interval for that Next Action since the later of: our last text,
-- email or call/text/email/meeting note, their last message, when the Next
-- Action last changed, and the last lead follow-up on the file. Ready to Shop
-- is tighter when they expect to be ready within 60 days.
-- Not drafted when: one is already waiting (or snoozed), an open task is due
-- later or a send is scheduled, the file is on hold or has no loan officer,
-- both channels are opted out, there are no documents in plain words to ask
-- for, test mode is on and the borrower isn't a TEST person, or (new-lead
-- intro) the lead came from a website form / page / application (Connor's GHL
-- workflow sends those).
-- A waiting draft is dismissed when the Next Action changes, the file leaves
-- the lead stages, or the borrower writes in. Sending it records sent_at.
-- Application and upload links are the borrower's portal link (made here
-- when they don't have a live one; making it sends nothing). The draft holds
-- "{link}" and the link's token; the app fills in the address.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ lead follow-ups installed").

-- ---------------------------------------------------------------------------
-- 1. Settings (one row per company; owners and admins)
-- ---------------------------------------------------------------------------

create table if not exists public.lead_followup_settings (
  organization_id               uuid primary key,
  enabled                       boolean not null default false,
  new_lead_days                 smallint not null default 0 check (new_lead_days between 0 and 30),
  waiting_application_days      smallint not null default 2 check (waiting_application_days between 0 and 30),
  application_in_progress_days  smallint not null default 1 check (application_in_progress_days between 0 and 30),
  waiting_documents_days        smallint not null default 2 check (waiting_documents_days between 0 and 30),
  needs_lo_review_days          smallint not null default 0 check (needs_lo_review_days between 0 and 30),
  ready_to_shop_days            smallint not null default 14 check (ready_to_shop_days between 1 and 60),
  ready_to_shop_soon_days       smallint not null default 7 check (ready_to_shop_soon_days between 1 and 60),
  property_found_days           smallint not null default 1 check (property_found_days between 0 and 30),
  waiting_borrower_days         smallint not null default 3 check (waiting_borrower_days between 1 and 30),
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid default auth.uid(),
  constraint lead_followup_settings_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint lead_followup_settings_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null
);

alter table public.lead_followup_settings enable row level security;
drop policy if exists "members see lead follow-up settings" on public.lead_followup_settings;
create policy "members see lead follow-up settings" on public.lead_followup_settings
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add lead follow-up settings" on public.lead_followup_settings;
create policy "managers add lead follow-up settings" on public.lead_followup_settings
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers change lead follow-up settings" on public.lead_followup_settings;
create policy "managers change lead follow-up settings" on public.lead_followup_settings
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));

drop trigger if exists lead_followup_settings_set_updated_at on public.lead_followup_settings;
create trigger lead_followup_settings_set_updated_at
  before update on public.lead_followup_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The queue: source, priority, snooze, sent
-- ---------------------------------------------------------------------------

alter table public.action_items
  add column if not exists source         text,
  add column if not exists priority       text not null default 'normal',
  add column if not exists snoozed_until  date,
  add column if not exists sent_at        timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'action_items_priority_check') then
    alter table public.action_items add constraint action_items_priority_check check (priority in ('high', 'normal'));
  end if;
end $$;

create index if not exists action_items_lead_followup_idx on public.action_items (loan_id) where source = 'lead_followup';

-- Sent (or approved and copied) records when.
create or replace function public.lead_followup_decided()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.source = 'lead_followup' and old.status = 'pending' and new.status in ('approved', 'edited') and new.sent_at is null then
    new.sent_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists action_items_lead_followup_decided on public.action_items;
create trigger action_items_lead_followup_decided before update of status on public.action_items
  for each row execute function public.lead_followup_decided();

-- ---------------------------------------------------------------------------
-- 3. Plain words for checklist items ("Pay stubs (last 30 days)" → "your most recent pay stubs")
-- ---------------------------------------------------------------------------

create or replace function public.lead_doc_phrase(p_rule_key text, p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := lower(coalesce(p_label, '') || ' ' || coalesce(p_rule_key, ''));
  base text := lower(trim(regexp_replace(coalesce(p_label, ''), '\s*\([^)]*\)', '', 'g')));
begin
  if t ~ 'pay ?stub|paystub' then return 'your most recent pay stubs'; end if;
  if t ~ 'w-?2' then return 'your W-2s'; end if;
  if t ~ '1099' then return 'your 1099s'; end if;
  if t ~ 'business (tax )?return|1120|1065|k-1' then return 'your business tax returns'; end if;
  if t ~ 'tax return|1040|tax_return' then return 'your tax returns'; end if;
  if t ~ 'profit|p&l|p_and_l|profit_loss' then return 'a profit and loss statement'; end if;
  if t ~ 'business license|cpa' then return 'your business license or a CPA letter'; end if;
  if t ~ 'bank statement|bank_statement' then return 'your most recent bank statements'; end if;
  if t ~ 'retirement|401|investment|brokerage|\mira\M' then return 'your retirement or investment statements'; end if;
  if t ~ 'mortgage statement|mortgage_statement' then return 'your current mortgage statement'; end if;
  if t ~ '\mlease' then return 'your lease'; end if;
  if t ~ 'award letter|award_' then return 'your award letter'; end if;
  if t ~ 'gift' then return 'the gift letter'; end if;
  if t ~ 'divorce' then return 'your divorce decree'; end if;
  if t ~ 'bankruptcy' then return 'your bankruptcy paperwork'; end if;
  if t ~ 'explanation|\mloe\M' then return 'a quick letter of explanation'; end if;
  if t ~ 'insurance|declarations' then return 'your homeowners insurance info'; end if;
  if t ~ '(photo |driver.?s? |^)id\M|license|photo_id|identification' then return 'a copy of your ID'; end if;
  if t ~ '\mvoe\M|verification of employment' then return 'your employment verification'; end if;
  if base = '' then return null; end if;
  -- Anything else: its own name, without codes in parentheses.
  if base ~ '^(your|a|an|the) ' then return base; end if;
  return 'your ' || base;
end;
$$;

-- "a", "a and b", "a, b and c", and for 4+: "a, b, c and a few other things".
create or replace function public.lead_doc_sentence(p_items text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(cardinality(p_items), 0) = 0 then null
    when cardinality(p_items) = 1 then p_items[1]
    when cardinality(p_items) = 2 then p_items[1] || ' and ' || p_items[2]
    when cardinality(p_items) = 3 then p_items[1] || ', ' || p_items[2] || ' and ' || p_items[3]
    else p_items[1] || ', ' || p_items[2] || ', ' || p_items[3] || ' and a few other things on your list'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. One file: draft its follow-up if one is due (returns what happened)
-- ---------------------------------------------------------------------------

create or replace function public.draft_lead_followup(p_loan_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
  s public.lead_followup_settings%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_kind text;
  v_last_out timestamptz;
  v_last_in timestamptz;
  v_last_item timestamptz;
  v_since timestamptz;
  v_days integer;
  v_channel text;
  v_first text;
  v_lo text;
  v_lo_full text;
  v_name text;
  v_link_token text;
  v_docs text[];
  v_sentence text;
  v_body text;
  v_subject text;
  v_reason text;
  v_label text;
  v_priority text := 'normal';
  v_payload jsonb;
  v_id uuid;
begin
  select ln.id, ln.organization_id, ln.stage::text as stage, ln.next_action, ln.next_action_at, ln.on_hold_at, ln.assigned_lo_id,
         ln.timeline, ln.ready_on, ln.created_at,
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
  if not found or not s.enabled then return 'lead follow-ups are off'; end if;
  if l.stage not in ('lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search') then return 'not a lead'; end if;
  if l.on_hold_at is not null then return 'on hold'; end if;
  if l.assigned_lo_id is null then return 'no loan officer'; end if;
  if exists (select 1 from public.messaging_settings m where m.organization_id = l.organization_id and m.inbound_mode = 'test_only')
     and (coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '')) !~* '\mtest\M' then
    return 'test mode (TEST people only)';
  end if;
  if exists (select 1 from public.action_items a where a.loan_id = l.id and a.source = 'lead_followup' and a.status = 'pending') then
    return 'one is already waiting';
  end if;
  if exists (select 1 from public.tasks t where t.loan_id = l.id and t.completed_at is null and t.due_on > v_today) then
    return 'a follow-up task is scheduled';
  end if;
  if exists (select 1 from public.send_approvals a where a.loan_id = l.id and a.send_at > now() and a.used_at is null and a.voided_at is null) then
    return 'a message is scheduled';
  end if;

  -- When we last reached them, and when they last wrote.
  select greatest(
    (select max(m.sent_at) from public.messages m where m.direction::text = 'outbound' and m.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id)),
    (select max(n.created_at) from public.notes n where n.kind::text in ('call', 'text', 'email', 'meeting') and n.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id))
  ) into v_last_out;
  select max(m.sent_at) into v_last_in from public.messages m
  where m.direction::text = 'inbound' and m.contact_id in (select b.contact_id from public.loan_borrowers b where b.loan_id = l.id);
  select max(a.created_at) into v_last_item from public.action_items a where a.loan_id = l.id and a.source = 'lead_followup';

  if l.next_action is not null then
    v_kind := l.next_action;
  elsif l.stage in ('lead', 'contacted') and v_last_out is null and v_last_item is null
    and not exists (select 1 from public.lead_submissions x where x.loan_id = l.id) then
    v_kind := 'new_lead';
  else
    return 'nothing to follow up on';
  end if;

  v_days := case v_kind
    when 'new_lead' then s.new_lead_days
    when 'waiting_application' then s.waiting_application_days
    when 'application_in_progress' then s.application_in_progress_days
    when 'waiting_documents' then s.waiting_documents_days
    when 'needs_lo_review' then s.needs_lo_review_days
    when 'ready_to_shop' then case when l.ready_on is not null and l.ready_on <= v_today + 60 then s.ready_to_shop_soon_days else s.ready_to_shop_days end
    when 'property_found' then s.property_found_days
    when 'waiting_borrower' then s.waiting_borrower_days
  end;
  v_since := greatest(v_last_out, v_last_in, v_last_item, case when v_kind = 'new_lead' then l.created_at else l.next_action_at end);
  if v_since is not null and (v_since at time zone 'America/Chicago')::date + v_days > v_today then
    return 'not due yet';
  end if;
  -- Overdue by another full interval (or more than 2 days for same-day ones): high priority.
  if v_kind in ('new_lead', 'needs_lo_review', 'property_found')
     or (v_since is not null and (v_since at time zone 'America/Chicago')::date + greatest(v_days * 2, 2) <= v_today) then
    v_priority := 'high';
  end if;

  v_name := trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, ''));
  v_first := coalesce(nullif(trim(l.first_name), ''), 'there');
  v_lo_full := coalesce(nullif(trim(l.full_name), ''), split_part(l.lo_email, '@', 1), 'your loan officer');
  v_lo := coalesce(nullif(split_part(trim(l.full_name), ' ', 1), ''), split_part(l.lo_email, '@', 1), 'your loan officer');
  v_label := case v_kind
    when 'new_lead' then 'New lead'
    when 'waiting_application' then 'Waiting on Application'
    when 'application_in_progress' then 'Application In Progress'
    when 'waiting_documents' then 'Waiting on Documents'
    when 'needs_lo_review' then 'Needs LO Review'
    when 'ready_to_shop' then 'Ready to Shop'
    when 'property_found' then 'Property Found'
    else 'Waiting on Borrower'
  end;
  v_reason := v_label || ': ' || case
    when v_kind = 'new_lead' then 'added by hand and not contacted yet'
    when v_kind = 'needs_lo_review' then 'the application is in and nothing is outstanding'
    when v_last_out is null then 'no contact on record yet'
    else ((now() at time zone 'America/Chicago')::date - (v_last_out at time zone 'America/Chicago')::date)::text || ' days since you last reached them'
  end;

  -- Needs LO Review: a task for the loan officer, no message.
  if v_kind = 'needs_lo_review' then
    v_payload := jsonb_build_object(
      'title', 'Review ' || v_name || '''s application and documents',
      'dueOn', v_today,
      'lead', jsonb_build_object('nextAction', v_kind, 'stage', l.stage, 'timeline', l.timeline, 'readyOn', l.ready_on, 'lastContactAt', v_last_out, 'reason', v_reason)
    );
    insert into public.action_items (organization_id, loan_id, kind, title, payload, sources, source_key, source, priority, due_on, created_by)
    values (l.organization_id, l.id, 'task_suggestion', 'Lead follow-up: ' || v_name, v_payload, '[]'::jsonb,
            'lead-followup:' || l.id || ':' || v_kind || ':' || v_today, 'lead_followup', 'high', v_today, null)
    on conflict (organization_id, source_key) do nothing
    returning id into v_id;
    return case when v_id is null then 'already drafted today' else 'drafted' end;
  end if;

  -- The channel: one with consent first, then one not opted out (the send asks for consent).
  v_channel := case
    when l.sms_consent is true and l.sms_opted_out_at is null and l.phone is not null then 'text'
    when l.email_consent is true and l.email_opted_out_at is null and l.email is not null then 'email'
    when l.sms_consent is not false and l.sms_opted_out_at is null and l.phone is not null then 'text'
    when l.email_consent is not false and l.email_opted_out_at is null and l.email is not null then 'email'
  end;
  if v_channel is null then return 'no way to reach them (opted out or no phone/email)'; end if;

  -- Documents: only the borrower's open checklist items, in plain words.
  if v_kind = 'waiting_documents' then
    select array_agg(phrase order by first_at, phrase) into v_docs from (
      select public.lead_doc_phrase(r.rule_key, r.label) as phrase, min(r.created_at) as first_at
      from public.document_requests r
      where r.loan_id = l.id and r.status::text in ('requested', 'rejected')
        and (r.contact_id = l.contact_id or r.contact_id is null)
      group by 1
    ) d where phrase is not null;
    v_sentence := public.lead_doc_sentence(v_docs);
    if v_sentence is null then return 'no documents to ask this borrower for'; end if;
  end if;

  -- The portal link for the application and documents (made if they don't have a live one).
  if v_kind in ('waiting_application', 'application_in_progress', 'waiting_documents') then
    select u.token into v_link_token from public.document_upload_links u
    where u.loan_id = l.id and u.contact_id = l.contact_id and u.kind = 'portal' and u.revoked_at is null and u.expires_at > now() + interval '3 days'
    order by u.created_at desc limit 1;
    if v_link_token is null then
      update public.document_upload_links set revoked_at = now()
      where loan_id = l.id and contact_id = l.contact_id and kind = 'portal' and revoked_at is null;
      v_link_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
      insert into public.document_upload_links (organization_id, loan_id, contact_id, kind, token, token_hash, expires_at, created_by)
      values (l.organization_id, l.id, l.contact_id, 'portal', v_link_token, encode(sha256(convert_to(v_link_token, 'UTF8')), 'hex'), now() + interval '90 days', null);
    end if;
  end if;

  v_body := case v_kind
    when 'new_lead' then 'Hey ' || v_first || ', it''s ' || v_lo || ' with MPS Mortgage. Wanted to reach out about your home loan. When''s a good time for a quick call?'
    when 'waiting_application' then 'Hey ' || v_first || ', it''s ' || v_lo || '. Whenever you have a few minutes, you can start your application here: {link} Any questions, just let me know.'
    when 'application_in_progress' then 'Hey ' || v_first || ', saw you started your application. Any questions I can help with? You can pick up where you left off here: {link}'
    when 'waiting_documents' then 'Hey ' || v_first || ', can you send me ' || v_sentence || '? You can '
      || case when cardinality(v_docs) > 3 then 'see the full list and upload them here: {link}' else 'upload them here: {link}' end
    when 'ready_to_shop' then 'Hey ' || v_first || ', how''s the house hunt going? If you find a place you like, send it my way and I''ll run the numbers for you.'
    when 'property_found' then 'Hey ' || v_first || ', saw you found a place you like. Want me to put together the numbers and a letter for it?'
    else 'Hey ' || v_first || ', just checking in. Let me know when you get a chance!'
  end;
  if v_channel = 'email' then
    v_subject := case v_kind
      when 'new_lead' then 'Your home loan'
      when 'waiting_application' then 'Your application'
      when 'application_in_progress' then 'Your application'
      when 'waiting_documents' then 'A few documents'
      when 'ready_to_shop' then 'Your home search'
      when 'property_found' then 'The home you found'
      else 'Checking in'
    end;
    v_body := regexp_replace(v_body, '^Hey [^,]*, ', '');
    v_body := 'Hi ' || v_first || ',' || E'\n\n' || upper(left(v_body, 1)) || substr(v_body, 2) || E'\n\n' || 'Thanks,' || E'\n' || v_lo_full;
  end if;

  v_payload := jsonb_build_object(
    'channel', v_channel,
    'to', v_name || ' (borrower)',
    'subject', v_subject,
    'body', v_body,
    'contactId', l.contact_id,
    'linkToken', v_link_token,
    'lead', jsonb_build_object('nextAction', v_kind, 'stage', l.stage, 'timeline', l.timeline, 'readyOn', l.ready_on, 'lastContactAt', v_last_out, 'reason', v_reason)
  );
  insert into public.action_items (organization_id, loan_id, kind, title, payload, sources, source_key, source, priority, due_on, created_by)
  values (l.organization_id, l.id, 'draft_message', 'Lead follow-up: ' || v_name, v_payload, '[]'::jsonb,
          'lead-followup:' || l.id || ':' || v_kind || ':' || v_today, 'lead_followup', v_priority, v_today, null)
  on conflict (organization_id, source_key) do nothing
  returning id into v_id;
  return case when v_id is null then 'already drafted today' else 'drafted' end;
end;
$$;

revoke all on function public.draft_lead_followup(uuid) from public, anon, authenticated;

-- The timer's job: every lead file in every company with follow-ups on.
create or replace function public.draft_lead_followups()
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
    join public.lead_followup_settings s on s.organization_id = ln.organization_id and s.enabled
    where ln.stage::text in ('lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search')
  loop
    begin
      if public.draft_lead_followup(r.id) = 'drafted' then n := n + 1; end if;
    exception when others then
      raise warning 'lead follow-up for % skipped: %', r.id, sqlerrm; -- One bad file never stops the rest.
    end;
  end loop;
  return n;
end;
$$;

revoke all on function public.draft_lead_followups() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. A waiting draft goes stale: the Next Action changed, the file left the
--    lead stages, or the borrower wrote in
-- ---------------------------------------------------------------------------

create or replace function public.lead_followup_loan_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.next_action is distinct from old.next_action or new.stage is distinct from old.stage then
    update public.action_items a set status = 'dismissed', decided_at = now(),
      skipped_reason = case when new.stage::text not in ('lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search') then 'no_longer_a_lead' else 'next_action_changed' end
    where a.loan_id = new.id and a.source = 'lead_followup' and a.status = 'pending'
      and (new.stage::text not in ('lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search')
        or coalesce(a.payload->'lead'->>'nextAction', '') <> coalesce(new.next_action, 'new_lead'));
  end if;
  return null;
end;
$$;

revoke all on function public.lead_followup_loan_changed() from public, anon, authenticated;

drop trigger if exists loans_lead_followup_changed on public.loans;
create trigger loans_lead_followup_changed after update on public.loans
  for each row execute function public.lead_followup_loan_changed();

create or replace function public.lead_followup_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction::text = 'inbound' and new.contact_id is not null then
    update public.action_items a set status = 'dismissed', decided_at = now(), skipped_reason = 'borrower_replied'
    where a.source = 'lead_followup' and a.status = 'pending'
      and a.loan_id in (select b.loan_id from public.loan_borrowers b where b.contact_id = new.contact_id);
  end if;
  return null;
end;
$$;

revoke all on function public.lead_followup_reply() from public, anon, authenticated;

drop trigger if exists messages_lead_followup_reply on public.messages;
create trigger messages_lead_followup_reply after insert on public.messages
  for each row execute function public.lead_followup_reply();

-- ---------------------------------------------------------------------------
-- 6. The timer: every 30 minutes
-- ---------------------------------------------------------------------------

select cron.unschedule('mpshq-lead-followups') where exists (select 1 from cron.job where jobname = 'mpshq-lead-followups');
select cron.schedule('mpshq-lead-followups', '*/30 * * * *', 'select public.draft_lead_followups()');

select
  'MPS HQ lead follow-ups installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'action_items' and column_name in ('source', 'priority', 'snoozed_until', 'sent_at')) as queue_columns,
  (select count(*) from cron.job where jobname = 'mpshq-lead-followups') as timer,
  (select coalesce(bool_or(enabled), false) from public.lead_followup_settings) as turned_on;
