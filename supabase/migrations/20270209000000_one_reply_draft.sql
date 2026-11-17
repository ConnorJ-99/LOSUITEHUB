-- MPS HQ: one reply draft per client (Connor, 2026-11-16).
--
-- What was wrong (live data, 2026-11-16): each client text that came after a
-- reply from the loan officer started a new reply draft, and a reply sent
-- from GHL or the LO's phone never cleared the old one, so a back-and-forth
-- left a pile of drafts that were all already answered (9 for one client in
-- one evening). Each text also made its own "texted you" notification.
--
-- Now:
--  1. At most ONE waiting reply draft per client (a unique index), answering
--     everything they sent since our last message. ghl-inbound saves it
--     through save_reply_draft(), which takes a per-client lock, so texts
--     arriving at the same moment still make one draft. A newer text rewrites
--     that draft; an older waiting one is set aside as "superseded".
--  2. Any reply to the client (sent from MPS HQ, from GHL or the LO's phone
--     and synced in, or a scheduled send going out) clears their waiting
--     reply draft ("replied") and marks their "texted you" notification read.
--     A draft being sent through its own approval is left for the queue to
--     mark sent.
--  3. One "texted you" notification per client while it's unread: later texts
--     update it ("Jane texted you (5)", the newest text as the preview).
--  4. A draft that was sent, scheduled or dismissed is never brought back.
-- Set-aside drafts are kept as status 'dismissed' with skipped_reason
-- 'superseded' or 'replied' and no decided_by (nobody dismissed them).
-- Nothing is ever sent. Safe to run more than once; a full run ends with a
-- confirmation row ("MPS HQ one reply draft installed").

-- ---------------------------------------------------------------------------
-- 1. Reply drafts are source 'reply'; the ones already answered are cleared
-- ---------------------------------------------------------------------------

update public.action_items set source = 'reply'
where source is null and source_key like 'reply:%';

-- When the client's newest text in a draft was sent (payload.burstLastAt, else that message's time).
create or replace function public.reply_draft_last_at(p_payload jsonb)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (p_payload->>'burstLastAt')::timestamptz,
    (select m.sent_at from public.messages m where m.id::text = p_payload->>'burstLastId'),
    'infinity'::timestamptz);
$$;

revoke all on function public.reply_draft_last_at(jsonb) from public, anon, authenticated;

-- A reply counts unless it failed or never reached them.
create or replace function public.is_real_reply(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_status, '') not in ('failed', 'undelivered');
$$;

revoke all on function public.is_real_reply(text) from public, anon, authenticated;

-- Waiting drafts we've already answered since.
update public.action_items a
set status = 'dismissed', decided_at = now(), skipped_reason = 'replied'
where a.source = 'reply' and a.status = 'pending'
  and exists (
    select 1 from public.messages o
    where o.contact_id::text = a.payload->>'contactId' and o.direction = 'outbound'
      and public.is_real_reply(o.status) and o.sent_at >= public.reply_draft_last_at(a.payload)
  );

-- More than one still waiting for a client: keep the newest.
update public.action_items a
set status = 'dismissed', decided_at = now(), skipped_reason = 'superseded'
where a.source = 'reply' and a.status = 'pending'
  and exists (
    select 1 from public.action_items b
    where b.source = 'reply' and b.status = 'pending' and b.organization_id = a.organization_id
      and b.payload->>'contactId' = a.payload->>'contactId'
      and (b.created_at, b.id) > (a.created_at, a.id)
  );

create unique index if not exists action_items_one_reply_per_client
  on public.action_items (organization_id, (payload->>'contactId'))
  where source = 'reply' and status = 'pending';

-- ---------------------------------------------------------------------------
-- 2. save_reply_draft: the one way ghl-inbound saves a reply draft
-- ---------------------------------------------------------------------------

-- Returns what happened: 'created', 'rewritten', 'replaced' (an older waiting
-- one was set aside), 'decided' (this burst's draft was already sent,
-- scheduled or dismissed), 'answered' (we replied after their newest text)
-- or 'newer' (a draft from a newer text is already there).
create or replace function public.save_reply_draft(
  p_org      uuid,
  p_loan     uuid,
  p_contact  uuid,
  p_key      text,
  p_last_at  timestamptz,
  p_item     jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     public.action_items%rowtype;
  v_pending public.action_items%rowtype;
  v_payload jsonb := coalesce(p_item->'payload', '{}'::jsonb) || jsonb_build_object('contactId', p_contact, 'burstLastAt', p_last_at);
begin
  -- One client at a time: texts arriving together wait here and see each other's draft.
  perform pg_advisory_xact_lock(hashtext('reply-draft:' || p_contact::text));

  -- Sent, scheduled or dismissed by a person: never brought back. Set aside by the system: may be reused.
  select * into v_old from public.action_items where organization_id = p_org and source_key = p_key and status <> 'pending';
  if v_old.id is not null and coalesce(v_old.skipped_reason, '') not in ('superseded', 'replied') then
    return 'decided';
  end if;
  if exists (
    select 1 from public.messages o
    where o.contact_id = p_contact and o.direction = 'outbound' and public.is_real_reply(o.status) and o.sent_at >= p_last_at
  ) then
    return 'answered';
  end if;

  select * into v_pending from public.action_items
  where organization_id = p_org and source = 'reply' and status = 'pending' and payload->>'contactId' = p_contact::text
  for update;

  if v_pending.id is not null and public.reply_draft_last_at(v_pending.payload) > p_last_at then
    return 'newer';
  end if;

  if v_pending.id is not null and v_pending.source_key = p_key then
    update public.action_items set
      loan_id = p_loan,
      title = coalesce(p_item->>'title', title),
      payload = v_payload,
      confidence = (p_item->>'confidence')::public.confidence_level,
      ai_run_id = nullif(p_item->>'ai_run_id', '')::uuid,
      due_on = coalesce((p_item->>'due_on')::date, due_on),
      updated_at = now()
    where id = v_pending.id;
    return 'rewritten';
  end if;

  if v_pending.id is not null then
    update public.action_items set status = 'dismissed', decided_at = now(), skipped_reason = 'superseded' where id = v_pending.id;
  end if;

  if v_old.id is not null then
    update public.action_items set
      status = 'pending', decided_at = null, decided_by = null, skipped_reason = null,
      loan_id = p_loan,
      title = coalesce(p_item->>'title', title),
      payload = v_payload,
      confidence = (p_item->>'confidence')::public.confidence_level,
      ai_run_id = nullif(p_item->>'ai_run_id', '')::uuid,
      due_on = coalesce((p_item->>'due_on')::date, due_on),
      updated_at = now()
    where id = v_old.id;
    return case when v_pending.id is not null then 'replaced' else 'created' end;
  end if;

  insert into public.action_items (organization_id, loan_id, kind, title, payload, sources, confidence, status, due_on, ai_run_id, created_by, source, source_key)
  values (p_org, p_loan, 'draft_message', coalesce(p_item->>'title', 'Reply'), v_payload, '[]'::jsonb,
    (p_item->>'confidence')::public.confidence_level, 'pending', coalesce((p_item->>'due_on')::date, (now() at time zone 'America/Chicago')::date),
    nullif(p_item->>'ai_run_id', '')::uuid, null, 'reply', p_key);
  return case when v_pending.id is not null then 'replaced' else 'created' end;
end;
$$;

revoke all on function public.save_reply_draft(uuid, uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.save_reply_draft(uuid, uuid, uuid, text, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A reply to the client clears their waiting draft and notification
-- ---------------------------------------------------------------------------

create or replace function public.messages_reply_sent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction <> 'outbound' or new.contact_id is null or not public.is_real_reply(new.status) then
    return null;
  end if;
  if tg_op = 'UPDATE' and public.is_real_reply(old.status) then
    return null; -- Already counted when it was saved.
  end if;
  update public.action_items a
  set status = 'dismissed', decided_at = now(), skipped_reason = 'replied'
  where a.source = 'reply' and a.status = 'pending'
    and a.organization_id = new.organization_id
    and a.payload->>'contactId' = new.contact_id::text
    and public.reply_draft_last_at(a.payload) <= new.sent_at
    -- The draft being sent itself: the queue marks it sent.
    and not exists (
      select 1 from public.send_approvals s
      where s.id = new.approval_id and s.client_key like 'queue:' || a.id::text || '%'
    );
  update public.notifications n
  set read_at = now()
  where n.kind = 'reply' and n.read_at is null and n.organization_id = new.organization_id
    and n.source_id in (
      select m.id from public.messages m
      where m.contact_id = new.contact_id and m.direction = 'inbound' and m.sent_at <= new.sent_at
    );
  return null;
exception when others then
  raise warning 'Reply draft not cleared for message %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.messages_reply_sent() from public, anon, authenticated;

drop trigger if exists messages_reply_sent on public.messages;
create trigger messages_reply_sent
  after insert or update of status on public.messages
  for each row execute function public.messages_reply_sent();

-- ---------------------------------------------------------------------------
-- 4. One "texted you" notification per client while it's unread
-- ---------------------------------------------------------------------------

create or replace function public.messages_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_lo uuid;
  v_admin uuid;
  v_open uuid;
  v_count integer;
  v_title text;
  v_preview text := left(regexp_replace(coalesce(case when new.channel = 'email' and new.subject is not null then new.subject || ': ' else '' end || new.body, ''), '\s+', ' ', 'g'), 140);
begin
  if tg_op = 'INSERT' and new.direction = 'inbound' then
    if new.match_status = 'matched' and new.contact_id is not null then
      select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
      select assigned_lo_id into v_lo from public.loans where id = new.loan_id;
      if v_lo is not null then
        -- One client at a time, so texts arriving together share one notification.
        perform pg_advisory_xact_lock(hashtext('reply-notify:' || new.contact_id::text));
        select n.id into v_open
        from public.notifications n
        join public.messages m on m.id = n.source_id
        where n.user_id = v_lo and n.kind = 'reply' and n.read_at is null and m.contact_id = new.contact_id
        order by n.created_at desc
        limit 1;
        -- Their unread texts since our last reply.
        select count(*) into v_count from public.messages i
        where i.contact_id = new.contact_id and i.direction = 'inbound' and i.read_at is null
          and i.sent_at > coalesce((select max(o.sent_at) from public.messages o
            where o.contact_id = new.contact_id and o.direction = 'outbound' and public.is_real_reply(o.status)), '-infinity'::timestamptz);
        v_title := coalesce(nullif(v_name, ''), 'A client') || case when new.channel = 'text' then ' texted you' else ' emailed you' end
          || case when v_count > 1 then ' (' || v_count || ')' else '' end;
        if v_open is not null then
          update public.notifications
          set title = left(v_title, 200), body = left(v_preview, 500),
              link = case when new.loan_id is not null then '/loans/' || new.loan_id || '?tab=messages' else '/inbox' end,
              created_at = now()
          where id = v_open;
        else
          perform public.notify_user(new.organization_id, v_lo, 'reply', v_title,
            v_preview, case when new.loan_id is not null then '/loans/' || new.loan_id || '?tab=messages' else '/inbox' end, new.id);
        end if;
      end if;
    elsif new.match_status = 'needs_matching' then
      for v_admin in select user_id from public.organization_members where organization_id = new.organization_id and role = 'admin' loop
        perform public.notify_user(new.organization_id, v_admin, 'needs_matching', 'A message needs matching',
          coalesce(new.ghl_contact_name, new.ghl_contact_phone, new.ghl_contact_email, 'Unknown sender') || ': ' || v_preview, '/inbox', new.id);
      end loop;
    end if;
  end if;
  if new.direction = 'outbound' and new.status = 'failed' and new.sent_by is not null
    and (tg_op = 'INSERT' or old.status is distinct from 'failed') then
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
    perform public.notify_user(new.organization_id, new.sent_by, 'send_failed',
      'Not sent: ' || case when new.channel = 'text' then 'text' else 'email' end || ' to ' || coalesce(nullif(v_name, ''), 'a client'),
      coalesce(new.send_error, 'GHL reports it failed.'), case when new.loan_id is not null then '/loans/' || new.loan_id || '?tab=messages' else '/inbox' end, new.id);
  end if;
  return null;
exception when others then
  raise warning 'Notification not made for message %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.messages_notify() from public, anon, authenticated;

-- Unread "texted you" notifications we've already answered: marked read.
update public.notifications n
set read_at = now()
from public.messages m
where n.kind = 'reply' and n.read_at is null and m.id = n.source_id and m.contact_id is not null
  and exists (
    select 1 from public.messages o
    where o.contact_id = m.contact_id and o.direction = 'outbound' and public.is_real_reply(o.status) and o.sent_at >= m.sent_at
  );

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ one reply draft installed' as result,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'action_items_one_reply_per_client') as indexes,
  (select count(*) from pg_trigger where tgname in ('messages_reply_sent', 'messages_notify')) as triggers,
  (select count(*) from public.action_items where source = 'reply' and status = 'pending') as reply_drafts_waiting;
