-- MPS HQ: notifications (Inbox fully live, Phase 2c, Connor 2026-11-03).
--
-- 1. notifications: one row per alert for one person (what happened, a link,
--    read or not). Made only by the database when something happens:
--    - reply: a client wrote in (to the file's loan officer);
--    - needs_matching: a message MPS HQ couldn't place (to admins);
--    - send_failed: a send didn't go out (to whoever sent it);
--    - opted_out: someone said STOP / unsubscribe or GHL's Do Not Disturb came
--      on (to the loan officers on their files);
--    - scheduled_sent / scheduled_stopped: a scheduled message went out, or
--      couldn't go at its time (to whoever scheduled it);
--    - test: "Send a test notification" in Settings.
--    People see and mark read only their own (mark_notifications_read()).
-- 2. notification_settings: which kinds each person wants, in the app and as
--    a phone/computer push. Missing = the defaults (everything in the app;
--    push for all but scheduled_sent).
-- 3. push_subscriptions: each browser or installed app that turned push on
--    (save_push_subscription() / remove_push_subscription()).
-- 4. Push: a new notification someone wants pushed asks the "push" Edge
--    Function (pg_net, the same Vault project address and key as the GHL
--    catch-up) to deliver it. A notification problem never stops the thing
--    that caused it (a saved message, a send).
-- 5. Live: notifications join Supabase Realtime.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ notifications installed").

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- 1–3. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid not null,
  kind             text not null check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test')),
  title            text not null,
  body             text,
  -- Where a click goes, inside the app ("/loans/<id>?tab=messages").
  link             text check (link is null or link like '/%'),
  -- What it's about (a message, a consent change, an approval), so it's never made twice.
  source_id        uuid,
  created_at       timestamptz not null default now(),
  read_at          timestamptz,
  constraint notifications_organization_id_fkey foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint notifications_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint notifications_once unique (user_id, kind, source_id)
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists "people see their own notifications" on public.notifications;
create policy "people see their own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.notification_settings (
  user_id     uuid primary key,
  -- {"reply": {"in_app": true, "push": true}, ...}; a missing kind uses the defaults.
  prefs       jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  updated_at  timestamptz not null default now(),
  constraint notification_settings_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);

alter table public.notification_settings enable row level security;
drop policy if exists "people see their own notification settings" on public.notification_settings;
create policy "people see their own notification settings" on public.notification_settings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "people add their own notification settings" on public.notification_settings;
create policy "people add their own notification settings" on public.notification_settings
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "people change their own notification settings" on public.notification_settings;
create policy "people change their own notification settings" on public.notification_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  endpoint      text not null unique check (endpoint like 'https://%'),
  p256dh        text not null,
  auth          text not null,
  device        text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  constraint push_subscriptions_user_id_fkey foreign key (user_id) references public.profiles (id) on delete cascade
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "people see their own devices" on public.push_subscriptions;
create policy "people see their own devices" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Settings, reading and devices
-- ---------------------------------------------------------------------------

-- Whether a person wants this kind in the app or pushed. Defaults: everything
-- in the app; push for all but scheduled_sent.
create or replace function public.wants_notification(p_user uuid, p_kind text, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.prefs -> p_kind ->> p_channel)::boolean from public.notification_settings s where s.user_id = p_user),
    case when p_channel = 'push' then p_kind <> 'scheduled_sent' else true end
  );
$$;

revoke all on function public.wants_notification(uuid, text, text) from public, anon, authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v integer;
begin
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v = row_count;
  return v;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_device text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  -- The same browser signed in as someone else before: it's this person's now.
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_device, 200))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Making notifications, and pushing them
-- ---------------------------------------------------------------------------

-- Adds one notification if the person wants it in the app or as a push.
create or replace function public.notify_user(p_org uuid, p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_source uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    return;
  end if;
  if not (public.wants_notification(p_user, p_kind, 'in_app') or public.wants_notification(p_user, p_kind, 'push')) then
    return;
  end if;
  insert into public.notifications (organization_id, user_id, kind, title, body, link, source_id)
  values (p_org, p_user, p_kind, left(p_title, 200), left(p_body, 500), p_link, p_source)
  on conflict (user_id, kind, source_id) do nothing;
end;
$$;

revoke all on function public.notify_user(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- "Send a test notification" (Settings): one for yourself, in the app and pushed.
create or replace function public.send_test_notification()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.organization_members where user_id = auth.uid() limit 1;
  if v_org is null then
    raise exception 'Sign in first.';
  end if;
  insert into public.notifications (organization_id, user_id, kind, title, body, link, source_id)
  values (v_org, auth.uid(), 'test', 'Test notification', 'Notifications from MPS HQ reach this device.', '/', gen_random_uuid());
end;
$$;

revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- A new notification someone wants pushed (and who has a device): ask the push function to deliver it.
create or replace function public.notifications_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if not (new.kind = 'test' or public.wants_notification(new.user_id, new.kind, 'push')) then
    return null;
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'losuite_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ghl_webhook_secret' limit 1;
  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_key), '') = '' then
    return null;
  end if;
  perform net.http_post(
    url := rtrim(trim(v_url), '/') || '/functions/v1/push?key=' || trim(v_key),
    body := jsonb_build_object('task', 'deliver', 'notificationId', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 30000
  );
  return null;
exception when others then
  raise warning 'Push not started for notification %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.notifications_push() from public, anon, authenticated;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row execute function public.notifications_push();

-- Messages: a client wrote in, a message needs matching, a send failed.
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
  v_preview text := left(regexp_replace(coalesce(case when new.channel = 'email' and new.subject is not null then new.subject || ': ' else '' end || new.body, ''), '\s+', ' ', 'g'), 140);
begin
  if tg_op = 'INSERT' and new.direction = 'inbound' then
    if new.match_status = 'matched' and new.contact_id is not null then
      select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
      select assigned_lo_id into v_lo from public.loans where id = new.loan_id;
      perform public.notify_user(new.organization_id, v_lo, 'reply', coalesce(nullif(v_name, ''), 'A client') || case when new.channel = 'text' then ' texted you' else ' emailed you' end,
        v_preview, case when new.loan_id is not null then '/loans/' || new.loan_id || '?tab=messages' else '/inbox' end, new.id);
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

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
  after insert or update of status on public.messages
  for each row execute function public.messages_notify();

-- Opt-outs: tell the loan officer on each of the person's files.
create or replace function public.consent_events_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_loan record;
begin
  if new.change <> 'opted_out' then
    return null;
  end if;
  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
  for v_loan in
    select distinct on (l.assigned_lo_id) l.id, l.assigned_lo_id
    from public.loan_borrowers b join public.loans l on l.id = b.loan_id
    where b.contact_id = new.contact_id and l.assigned_lo_id is not null
    order by l.assigned_lo_id, l.created_at desc
  loop
    perform public.notify_user(new.organization_id, v_loan.assigned_lo_id, 'opted_out',
      coalesce(nullif(v_name, ''), 'A client') || ' opted out of ' || case when new.channel = 'text' then 'texts' else 'email' end,
      case new.source when 'stop_reply' then 'They replied to stop.' when 'ghl_dnd' then 'Do Not Disturb is on in GHL.' else 'Recorded by a person.' end,
      '/loans/' || v_loan.id || '?tab=messages', new.id);
  end loop;
  return null;
exception when others then
  raise warning 'Notification not made for consent change %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.consent_events_notify() from public, anon, authenticated;

drop trigger if exists consent_events_notify on public.consent_events;
create trigger consent_events_notify
  after insert on public.consent_events
  for each row execute function public.consent_events_notify();

-- Scheduled sends: went out, or couldn't go at their time.
create or replace function public.send_approvals_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_what text := case when new.channel = 'text' then 'text' else 'email' end;
begin
  if new.send_at is null then
    return null;
  end if;
  select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_name from public.contacts where id = new.contact_id;
  if old.used_at is null and new.used_at is not null then
    perform public.notify_user(new.organization_id, new.approved_by, 'scheduled_sent', 'Scheduled ' || v_what || ' sent to ' || coalesce(nullif(v_name, ''), 'a client'),
      left(new.body, 140), '/loans/' || new.loan_id || '?tab=messages', new.id);
  elsif old.voided_at is null and new.voided_at is not null and coalesce(new.void_reason, '') not in ('cancelled', 'test mode ended') then
    perform public.notify_user(new.organization_id, new.approved_by, 'scheduled_stopped', 'Scheduled ' || v_what || ' to ' || coalesce(nullif(v_name, ''), 'a client') || ' didn''t send',
      new.void_reason, '/', new.id);
  end if;
  return null;
exception when others then
  raise warning 'Notification not made for approval %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.send_approvals_notify() from public, anon, authenticated;

drop trigger if exists send_approvals_notify on public.send_approvals;
create trigger send_approvals_notify
  after update of used_at, voided_at on public.send_approvals
  for each row execute function public.send_approvals_notify();

-- ---------------------------------------------------------------------------
-- 5. Live updates
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

select
  'MPS HQ notifications installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('notifications', 'notification_settings', 'push_subscriptions')) as tables,
  (select count(*) from pg_trigger where tgname in ('notifications_push', 'messages_notify', 'consent_events_notify', 'send_approvals_notify')) as triggers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('wants_notification', 'mark_notifications_read', 'save_push_subscription', 'remove_push_subscription', 'notify_user', 'send_test_notification')) as functions,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') as realtime;
