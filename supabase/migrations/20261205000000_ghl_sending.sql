-- LOSuite: sending through GHL, Phase 3 (Connor, 2026-10-29; plan in
-- docs/plans/ghl-messaging.md). The "ghl" Edge Function sends; this script
-- adds what it needs.
--
-- 1. record_consent(): a person records that someone agreed to texts or
--    email, with a note saying how. Kept in consent_events ("granted"). After
--    an opt-out, restore_consent() is the only way back.
-- 2. On messages: who sent it from LOSuite (sent_by), why a send failed
--    (send_error), and an idempotency key. The function saves the message
--    with its key before calling GHL, so a double click or a retry can't send
--    the same message twice.
--
-- Apply to the DEV Supabase project only, after the GHL message senders
-- script. Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite GHL sending installed").

-- ---------------------------------------------------------------------------
-- 1. Recording consent
-- ---------------------------------------------------------------------------

alter table public.consent_events drop constraint if exists consent_events_change_check;
alter table public.consent_events
  add constraint consent_events_change_check check (change in ('opted_out', 'restored', 'granted'));
alter table public.consent_events drop constraint if exists consent_events_restored_has_note;
alter table public.consent_events
  add constraint consent_events_restored_has_note check (change = 'opted_out' or length(trim(coalesce(note, ''))) > 0);

create or replace function public.record_consent(p_contact_id uuid, p_channel public.message_channel, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts%rowtype;
  v_note text := trim(coalesce(p_note, ''));
begin
  if auth.uid() is null or not public.can_see_contact(p_contact_id) then
    raise exception 'Only someone who can see this person''s file can record consent.';
  end if;
  if v_note = '' then
    raise exception 'Add a note saying how they agreed (for example, "Said yes to texts on our call 10/29").';
  end if;
  select * into v_contact from public.contacts where id = p_contact_id;
  if (p_channel = 'text' and v_contact.sms_opted_out_at is not null) or (p_channel = 'email' and v_contact.email_opted_out_at is not null) then
    raise exception 'This person opted out. Use "Restore" with a note instead.';
  end if;

  if p_channel = 'text' then
    update public.contacts set sms_consent = true where id = p_contact_id;
  else
    update public.contacts set email_consent = true where id = p_contact_id;
  end if;
  insert into public.consent_events (organization_id, contact_id, channel, change, source, note, created_by)
  values (v_contact.organization_id, p_contact_id, p_channel, 'granted', 'person', v_note, auth.uid());
end;
$$;

revoke all on function public.record_consent(uuid, public.message_channel, text) from public;
do $$ begin
  revoke all on function public.record_consent(uuid, public.message_channel, text) from anon;
exception when undefined_object then null;
end $$;
grant execute on function public.record_consent(uuid, public.message_channel, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sending: who, what went wrong, and the double-send lock
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists sent_by          uuid,
  add column if not exists send_error       text,
  add column if not exists idempotency_key  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_sent_by_fkey') then
    alter table public.messages
      add constraint messages_sent_by_fkey foreign key (sent_by) references public.profiles (id) on delete set null;
  end if;
end;
$$;

create unique index if not exists messages_idempotency_key_key
  on public.messages (organization_id, idempotency_key) where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite GHL sending installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messages'
     and column_name in ('sent_by', 'send_error', 'idempotency_key')) as columns,
  (select count(*) from pg_proc where proname = 'record_consent' and pronamespace = 'public'::regnamespace) as functions,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'consent_events_change_check') as consent_changes;
