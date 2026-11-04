-- MPS HQ: scheduled sends (Inbox fully live, Phase 2a, Connor 2026-11-03).
--
-- "Schedule" approves a message now and sends it later. It's still Rule #0:
-- the timer only sends what someone approved, by name, and every check runs
-- again at send time (the approver may still approve on the file, consent,
-- Do Not Disturb, sending hours, test mode, the LO's number).
--
-- 1. send_approvals.send_at: when a scheduled approval goes out (empty = now).
--    approve_send() takes it (from 1 minute ago to 60 days ahead).
--    claim_send_approval(): a scheduled approval can be used from its time
--    until a day after (then it's missed); an unscheduled one within an hour.
-- 2. cancel_scheduled_send(): the approver or an admin cancels one that
--    hasn't gone yet.
-- 3. The timer: pg_cron runs scheduled_ghl_send() every minute. When an
--    approval is due it asks the ghl Edge Function (task send_due) to send
--    the due ones; otherwise it does nothing. It needs three Supabase Vault
--    secrets: losuite_project_url and ghl_webhook_secret (already there for
--    the catch-up) and losuite_anon_key (the project's public anon key, which
--    lets the call through the function's sign-in check).
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ scheduled sends installed").

alter table public.send_approvals
  add column if not exists send_at timestamptz;

create index if not exists send_approvals_due_idx on public.send_approvals (send_at) where send_at is not null and used_at is null and voided_at is null;

-- ---------------------------------------------------------------------------
-- 1. approve_send() with an optional time, and claim_send_approval()
-- ---------------------------------------------------------------------------

drop function if exists public.approve_send(uuid, uuid, public.message_channel, text, text, uuid[], text);

create or replace function public.approve_send(
  p_loan_id       uuid,
  p_contact_id    uuid,
  p_channel       public.message_channel,
  p_subject       text,
  p_body          text,
  p_document_ids  uuid[],
  p_client_key    text,
  p_send_at       timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_id      uuid;
  v_subject text := case when p_channel = 'email' then nullif(trim(coalesce(p_subject, '')), '') else null end;
  v_docs    uuid[] := coalesce(p_document_ids, '{}');
  v_old     public.send_approvals%rowtype;
begin
  select organization_id into v_org from public.loans where id = p_loan_id;
  if v_org is null or not public.can_see_loan(p_loan_id) then
    raise exception 'That file was not found, or it is not yours.';
  end if;
  if not public.may_approve_send(p_loan_id, auth.uid()) then
    raise exception 'Only this file''s loan officer or an admin can approve a message on it.';
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
  if p_send_at is not null and (p_send_at < now() - interval '1 minute' or p_send_at > now() + interval '60 days') then
    raise exception 'Pick a time from now to 60 days ahead.';
  end if;

  insert into public.send_approvals (organization_id, contact_id, loan_id, channel, subject, body, document_ids, client_key, approved_by, send_at)
  values (v_org, p_contact_id, p_loan_id, p_channel, v_subject, trim(p_body), v_docs, p_client_key, auth.uid(), p_send_at)
  on conflict (organization_id, approved_by, client_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Same key again (a double click or a retry): only the same message counts.
    select * into v_old from public.send_approvals where organization_id = v_org and approved_by = auth.uid() and client_key = p_client_key;
    if v_old.loan_id <> p_loan_id or v_old.contact_id <> p_contact_id or v_old.channel <> p_channel
      or v_old.subject is distinct from v_subject or v_old.body <> trim(p_body) or v_old.document_ids <> v_docs
      or v_old.send_at is distinct from p_send_at then
      raise exception 'This message changed after it was approved. Refresh the page and approve it again.';
    end if;
    v_id := v_old.id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.approve_send(uuid, uuid, public.message_channel, text, text, uuid[], text, timestamptz) from public, anon;
grant execute on function public.approve_send(uuid, uuid, public.message_channel, text, text, uuid[], text, timestamptz) to authenticated;

create or replace function public.claim_send_approval(p_approval_id uuid, p_organization_id uuid, p_user uuid)
returns setof public.send_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.send_approvals%rowtype;
begin
  select * into v from public.send_approvals where id = p_approval_id and organization_id = p_organization_id for update;
  if v.id is null then
    raise exception 'That approval was not found.';
  end if;
  if v.voided_at is not null then
    raise exception 'That approval was cancelled (%). Nothing was sent.', coalesce(v.void_reason, 'no reason given');
  end if;
  if v.used_at is not null then
    raise exception 'already_used';
  end if;
  if v.approved_by <> p_user then
    raise exception 'Only the person who approved a message can send it.';
  end if;
  if v.send_at is null then
    if v.approved_at < now() - interval '1 hour' then
      raise exception 'That approval is over an hour old. Approve the message again.';
    end if;
  else
    if now() < v.send_at - interval '30 seconds' then
      raise exception 'not_due';
    end if;
    if now() > v.send_at + interval '1 day' then
      raise exception 'Its time passed over a day ago, so it was not sent. Schedule it again.';
    end if;
  end if;
  if not public.may_approve_send(v.loan_id, v.approved_by) then
    raise exception 'Whoever approved this message can no longer approve messages on this file. Nothing was sent.';
  end if;
  update public.send_approvals set used_at = now() where id = v.id returning * into v;
  return next v;
end;
$$;

revoke all on function public.claim_send_approval(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_send_approval(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Cancel a scheduled send
-- ---------------------------------------------------------------------------

create or replace function public.cancel_scheduled_send(p_approval_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.send_approvals%rowtype;
begin
  select * into v from public.send_approvals where id = p_approval_id;
  if v.id is null or not public.can_see_loan(v.loan_id) then
    raise exception 'That scheduled message was not found.';
  end if;
  if not (v.approved_by = auth.uid() or public.sees_all_files(v.organization_id)) then
    raise exception 'Only the person who scheduled it, or an admin, can cancel it.';
  end if;
  if v.send_at is null or v.used_at is not null then
    raise exception 'That message already went out.';
  end if;
  update public.send_approvals set voided_at = now(), void_reason = 'cancelled' where id = p_approval_id and voided_at is null;
end;
$$;

revoke all on function public.cancel_scheduled_send(uuid) from public, anon;
grant execute on function public.cancel_scheduled_send(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The timer
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Asks the ghl function to send what's due. Does nothing (no call at all)
-- when nothing is due. Runs as its owner so it can read Vault; nobody else
-- can call it.
create or replace function public.scheduled_ghl_send()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_anon text;
  v_request bigint;
begin
  -- Over a day late (the timer or GHL was down): marked missed, never sent.
  update public.send_approvals
  set voided_at = now(), void_reason = 'missed: its time passed over a day ago'
  where send_at < now() - interval '1 day' and used_at is null and voided_at is null;
  if not exists (select 1 from public.send_approvals where send_at is not null and send_at <= now() + interval '30 seconds' and used_at is null and voided_at is null) then
    return 'Nothing due.';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'losuite_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ghl_webhook_secret' limit 1;
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'losuite_anon_key' limit 1;
  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_key), '') = '' or coalesce(trim(v_anon), '') = '' then
    return 'Skipped: add losuite_project_url, ghl_webhook_secret and losuite_anon_key in Supabase Vault first.';
  end if;
  select net.http_post(
    url := rtrim(trim(v_url), '/') || '/functions/v1/ghl?key=' || trim(v_key),
    body := jsonb_build_object('task', 'send_due'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || trim(v_anon)),
    timeout_milliseconds := 60000
  ) into v_request;
  return 'Asked ghl to send what''s due (request ' || v_request || ').';
end;
$$;

revoke all on function public.scheduled_ghl_send() from public;
revoke all on function public.scheduled_ghl_send() from anon, authenticated;

-- Every minute. Scheduling the same name again replaces it.
select cron.schedule('mpshq-ghl-scheduled-send', '* * * * *', 'select public.scheduled_ghl_send()');

select
  'MPS HQ scheduled sends installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'send_approvals' and column_name = 'send_at') as columns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'approve_send') as approve_send_versions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cancel_scheduled_send', 'scheduled_ghl_send')) as functions,
  (select count(*) from cron.job where jobname = 'mpshq-ghl-scheduled-send') as scheduled_jobs,
  (select count(*) from vault.decrypted_secrets where name in ('losuite_project_url', 'ghl_webhook_secret', 'losuite_anon_key')) as vault_secrets_found;
