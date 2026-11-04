-- MPS HQ: every send needs an approval record (Inbox fully live, Phase 1,
-- Connor 2026-11-03).
--
-- Rule #0: nothing sends on its own. The only way MPS HQ sends a text or
-- email through GHL is the "ghl" Edge Function's send task, and it now sends
-- ONLY what an approval record says, once:
--
-- 1. send_approvals: one row per approved message. Who approved it, when, and
--    the exact message (person, file, text or email, subject, words,
--    attachments). approve_send() is the only way to add one: the file's loan
--    officer or an admin, for a borrower on that file. The app can't change or
--    delete approvals. claim_send_approval() (the Edge Function only) uses an
--    approval once, re-checking that the approver may still approve it, and
--    refuses approvals over an hour old or cancelled.
-- 2. messages.approval_id: which approval a sent message came from (one each).
--    failure_cleared_at / _reason: a failed send stays on screen until someone
--    resends or dismisses it (clear_failed_send()).
-- 3. Test-mode switch: turning test mode off (inbound_mode test_only → all)
--    marks everything waiting from test mode as skipped. Nothing is sent:
--    drafts in the Action Queue are dismissed (skipped_reason = test_mode_ended)
--    and unused approvals are cancelled. test_mode_off_preview() counts them
--    for the confirm box. Only owners and admins can change the setting.
-- 4. Live updates: messages joins Supabase Realtime, so open screens hear about
--    new messages at once (each person still only receives what Row Level
--    Security lets them see).
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ send approvals installed").

-- ---------------------------------------------------------------------------
-- 1. send_approvals
-- ---------------------------------------------------------------------------

create table if not exists public.send_approvals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  loan_id          uuid not null,
  channel          public.message_channel not null,
  subject          text,
  body             text not null check (length(trim(body)) > 0),
  document_ids     uuid[] not null default '{}',
  -- The screen's send key, so a double click finds the same approval.
  client_key       text not null check (length(client_key) between 8 and 100),
  approved_by      uuid not null,
  approved_at      timestamptz not null default now(),
  -- Set once, when the Edge Function uses it.
  used_at          timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  constraint send_approvals_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint send_approvals_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint send_approvals_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  -- An approval keeps its approver; a login with approvals can't be deleted (remove them from the team instead).
  constraint send_approvals_approved_by_fkey
    foreign key (approved_by) references public.profiles (id) on delete restrict,
  constraint send_approvals_one_per_key unique (organization_id, approved_by, client_key),
  constraint send_approvals_subject_for_email check (channel = 'email' or subject is null),
  constraint send_approvals_docs_by_email check (channel = 'email' or cardinality(document_ids) = 0)
);

create index if not exists send_approvals_loan_id_idx on public.send_approvals (loan_id);
create index if not exists send_approvals_contact_id_idx on public.send_approvals (contact_id);
create index if not exists send_approvals_waiting_idx on public.send_approvals (organization_id) where used_at is null and voided_at is null;

alter table public.send_approvals enable row level security;
-- Read only for people who can see the file; no insert, update or delete from the app.
drop policy if exists "people on the file see its approvals" on public.send_approvals;
create policy "people on the file see its approvals" on public.send_approvals
  for select to authenticated using (public.can_see_loan(loan_id));

-- Who may approve a message on a file: its loan officer, or an admin.
create or replace function public.may_approve_send(p_loan_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.loans l
    join public.organization_members m on m.organization_id = l.organization_id and m.user_id = p_user
    where l.id = p_loan_id
      and (l.assigned_lo_id = p_user or m.role = 'admin')
  );
$$;

revoke all on function public.may_approve_send(uuid, uuid) from public, anon, authenticated;

-- Approves one exact message. Returns the approval's id (the same one again for the same key).
create or replace function public.approve_send(
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

  insert into public.send_approvals (organization_id, contact_id, loan_id, channel, subject, body, document_ids, client_key, approved_by)
  values (v_org, p_contact_id, p_loan_id, p_channel, v_subject, trim(p_body), v_docs, p_client_key, auth.uid())
  on conflict (organization_id, approved_by, client_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Same key again (a double click or a retry): only the same message counts.
    select * into v_old from public.send_approvals where organization_id = v_org and approved_by = auth.uid() and client_key = p_client_key;
    if v_old.loan_id <> p_loan_id or v_old.contact_id <> p_contact_id or v_old.channel <> p_channel
      or v_old.subject is distinct from v_subject or v_old.body <> trim(p_body) or v_old.document_ids <> v_docs then
      raise exception 'This message changed after it was approved. Refresh the page and approve it again.';
    end if;
    v_id := v_old.id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.approve_send(uuid, uuid, public.message_channel, text, text, uuid[], text) from public, anon;
grant execute on function public.approve_send(uuid, uuid, public.message_channel, text, text, uuid[], text) to authenticated;

-- The Edge Function uses an approval exactly once. Returns it, or nothing with
-- the reason in the error. Only the service role can run it.
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
  if v.approved_at < now() - interval '1 hour' then
    raise exception 'That approval is over an hour old. Approve the message again.';
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
-- 2. Messages: which approval, and failed sends until resent or dismissed
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists approval_id             uuid,
  add column if not exists failure_cleared_at      timestamptz,
  add column if not exists failure_cleared_by      uuid,
  add column if not exists failure_cleared_reason  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_approval_id_fkey') then
    alter table public.messages
      add constraint messages_approval_id_fkey foreign key (approval_id) references public.send_approvals (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_failure_cleared_by_fkey') then
    alter table public.messages
      add constraint messages_failure_cleared_by_fkey foreign key (failure_cleared_by) references public.profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_failure_cleared_reason_check') then
    alter table public.messages
      add constraint messages_failure_cleared_reason_check check (failure_cleared_reason in ('resent', 'dismissed'));
  end if;
end $$;

create unique index if not exists messages_approval_id_key on public.messages (approval_id) where approval_id is not null;
create index if not exists messages_failed_idx on public.messages (organization_id) where status = 'failed' and failure_cleared_at is null;

-- Clears a failed send from the "failed" lists, for anyone who can see it.
create or replace function public.clear_failed_send(p_message_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.messages%rowtype;
begin
  select * into v from public.messages where id = p_message_id;
  if v.id is null or not ((v.contact_id is not null and public.can_see_contact(v.contact_id)) or public.sees_all_files(v.organization_id)) then
    raise exception 'That message was not found.';
  end if;
  if v.direction <> 'outbound' or coalesce(v.status, '') <> 'failed' then
    raise exception 'Only a failed send can be cleared.';
  end if;
  if p_reason not in ('resent', 'dismissed') then
    raise exception 'Resent or dismissed?';
  end if;
  update public.messages
  set failure_cleared_at = now(), failure_cleared_by = auth.uid(), failure_cleared_reason = p_reason
  where id = p_message_id and failure_cleared_at is null;
end;
$$;

revoke all on function public.clear_failed_send(uuid, text) from public, anon;
grant execute on function public.clear_failed_send(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Test mode off = everything waiting from test mode is skipped
-- ---------------------------------------------------------------------------

alter table public.action_items
  add column if not exists skipped_reason text;

alter table public.messaging_settings
  add column if not exists test_mode_changed_at  timestamptz,
  add column if not exists test_mode_changed_by  uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messaging_settings_test_mode_changed_by_fkey') then
    alter table public.messaging_settings
      add constraint messaging_settings_test_mode_changed_by_fkey foreign key (test_mode_changed_by) references public.profiles (id) on delete set null;
  end if;
end $$;

-- What turning test mode off would skip, for the confirm box (owners and admins).
create or replace function public.test_mode_off_preview(p_organization_id uuid)
returns table (drafts integer, approvals integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(p_organization_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only an owner or admin can change test mode.';
  end if;
  return query select
    (select count(*)::integer from public.action_items where organization_id = p_organization_id and status = 'pending' and kind = 'draft_message'),
    (select count(*)::integer from public.send_approvals where organization_id = p_organization_id and used_at is null and voided_at is null);
end;
$$;

revoke all on function public.test_mode_off_preview(uuid) from public, anon;
grant execute on function public.test_mode_off_preview(uuid) to authenticated;

-- Runs whenever inbound_mode changes, however it's changed (the Settings switch or the SQL Editor).
create or replace function public.messaging_settings_test_mode_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.inbound_mode is distinct from old.inbound_mode then
    new.test_mode_changed_at := now();
    new.test_mode_changed_by := auth.uid();
    if old.inbound_mode = 'test_only' and new.inbound_mode = 'all' then
      update public.action_items
      set status = 'dismissed', decided_at = now(), decided_by = auth.uid(), skipped_reason = 'test_mode_ended'
      where organization_id = new.organization_id and status = 'pending' and kind = 'draft_message';
      update public.send_approvals
      set voided_at = now(), void_reason = 'test mode ended'
      where organization_id = new.organization_id and used_at is null and voided_at is null;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.messaging_settings_test_mode_change() from public, anon, authenticated;

drop trigger if exists messaging_settings_test_mode_change on public.messaging_settings;
create trigger messaging_settings_test_mode_change
  before update of inbound_mode on public.messaging_settings
  for each row execute function public.messaging_settings_test_mode_change();

-- ---------------------------------------------------------------------------
-- 4. Live updates (Supabase Realtime)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

select
  'MPS HQ send approvals installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'send_approvals') as tables,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'messages' and column_name in ('approval_id', 'failure_cleared_at', 'failure_cleared_by', 'failure_cleared_reason'))
        or (table_name = 'action_items' and column_name = 'skipped_reason')
        or (table_name = 'messaging_settings' and column_name in ('test_mode_changed_at', 'test_mode_changed_by')))) as new_columns,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('approve_send', 'claim_send_approval', 'may_approve_send', 'clear_failed_send', 'test_mode_off_preview', 'messaging_settings_test_mode_change')) as functions,
  (select count(*) from pg_trigger where tgname = 'messaging_settings_test_mode_change') as triggers,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') as realtime;
