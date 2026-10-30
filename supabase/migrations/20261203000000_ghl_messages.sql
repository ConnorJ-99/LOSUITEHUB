-- LOSuite: GHL messages, Phase 2a (Connor, 2026-10-29; plan in
-- docs/plans/ghl-messaging.md). Texts and emails from the MPS Mortgage GHL
-- sub-account are copied into LOSuite and matched to the right person. Nothing
-- is sent from LOSuite yet.
--
-- 1. messaging_settings gets which GHL sub-account belongs to the company,
--    when messages were last checked, and a test switch: "test_only" (the
--    default) saves only GHL contacts with TEST in their name, so real
--    clients' messages stay out of the dev database until Connor switches it
--    to "all".
-- 2. Opt-outs: contacts.sms_opted_out_at / email_opted_out_at. A STOP reply or
--    GHL's Do Not Disturb turns consent off and records when; only a person
--    can turn it back on, with a note, through restore_consent(). Every change
--    is kept in consent_events.
-- 3. messages: one row per GHL text or email, keyed by GHL's message id so
--    nothing saves twice. Matched messages belong to a person (and are tagged
--    with their loan); the rest wait in "Needs matching". Visible like the
--    person's file: loan officers see their own, processors the files they're
--    on, and only admins see every message and the unmatched ones.
-- 4. match_message() (admins: "This is…"), mark_messages_read(), and
--    ghl_match_candidates() for the Edge Function's matching.
--
-- Only the ghl-inbound Edge Function (service role) writes messages; the app
-- reads them and uses the functions above.
--
-- Apply to the DEV Supabase project only, after the GHL connection script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite GHL messages installed").

-- ---------------------------------------------------------------------------
-- 1. Which sub-account, last check, test switch
-- ---------------------------------------------------------------------------

alter table public.messaging_settings
  add column if not exists ghl_location_id text,
  add column if not exists last_synced_at  timestamptz,
  add column if not exists inbound_mode    text not null default 'test_only';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messaging_settings_inbound_mode_check') then
    alter table public.messaging_settings
      add constraint messaging_settings_inbound_mode_check check (inbound_mode in ('test_only', 'all'));
  end if;
end;
$$;

create unique index if not exists messaging_settings_ghl_location_id_key
  on public.messaging_settings (ghl_location_id) where ghl_location_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Opt-outs and consent history
-- ---------------------------------------------------------------------------

alter table public.contacts
  add column if not exists sms_opted_out_at    timestamptz,
  add column if not exists email_opted_out_at  timestamptz;

-- Someone who said STOP stays opted out until a person turns consent back on
-- with a note (restore_consent). Edits from the app can't do it by changing
-- the field; Edge Functions using the service role and the SQL Editor (no
-- signed-in user) aren't limited.
create or replace function public.guard_opt_out()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('losuite.consent_restore', true), '') <> 'on' then
    if (old.sms_opted_out_at is not null and (new.sms_opted_out_at is null or new.sms_consent is true))
      or (old.email_opted_out_at is not null and (new.email_opted_out_at is null or new.email_consent is true)) then
      raise exception 'This person opted out. Turn consent back on with "Restore consent" and a note.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_opt_out() from public;

drop trigger if exists guard_opt_out on public.contacts;
create trigger guard_opt_out
  before update of sms_consent, email_consent, sms_opted_out_at, email_opted_out_at on public.contacts
  for each row execute function public.guard_opt_out();

create table if not exists public.consent_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  channel          public.message_channel not null,
  -- opted_out: consent turned off by a STOP reply or GHL's Do Not Disturb.
  -- restored: a person turned it back on, with a note.
  change           text not null check (change in ('opted_out', 'restored')),
  source           text not null check (source in ('stop_reply', 'ghl_dnd', 'person')),
  note             text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  constraint consent_events_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint consent_events_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint consent_events_restored_has_note check (change <> 'restored' or length(trim(coalesce(note, ''))) > 0)
);

create index if not exists consent_events_contact_id_idx on public.consent_events (contact_id, created_at desc);

alter table public.consent_events enable row level security;
drop policy if exists "people on the file see consent history" on public.consent_events;
create policy "people on the file see consent history" on public.consent_events
  for select to authenticated using (public.can_see_contact(contact_id));

create or replace function public.restore_consent(p_contact_id uuid, p_channel public.message_channel, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_note text := trim(coalesce(p_note, ''));
begin
  if auth.uid() is null or not public.can_see_contact(p_contact_id) then
    raise exception 'Only someone who can see this person''s file can turn consent back on.';
  end if;
  if v_note = '' then
    raise exception 'Add a note saying how they gave consent again (for example, "Texted START on 11/2").';
  end if;
  select c.organization_id into v_org from public.contacts c where c.id = p_contact_id;

  perform set_config('losuite.consent_restore', 'on', true);
  if p_channel = 'text' then
    update public.contacts set sms_consent = true, sms_opted_out_at = null where id = p_contact_id;
  else
    update public.contacts set email_consent = true, email_opted_out_at = null where id = p_contact_id;
  end if;
  perform set_config('losuite.consent_restore', '', true);

  insert into public.consent_events (organization_id, contact_id, channel, change, source, note, created_by)
  values (v_org, p_contact_id, p_channel, 'restored', 'person', v_note, auth.uid());
end;
$$;

revoke all on function public.restore_consent(uuid, public.message_channel, text) from public;
grant execute on function public.restore_consent(uuid, public.message_channel, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Messages
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  -- Empty until matched (then it waits in "Needs matching").
  contact_id           uuid,
  -- The person's file it's shown on; a tag, like notes.
  loan_id              uuid,
  channel              public.message_channel not null,
  direction            text not null check (direction in ('inbound', 'outbound')),
  subject              text,
  -- Plain text (emails are stored without their HTML).
  body                 text not null default '',
  from_address         text,
  to_address           text,
  -- GHL's status: delivered, failed, read, …
  status               text,
  sent_at              timestamptz not null,
  ghl_message_id       text not null,
  ghl_conversation_id  text,
  ghl_contact_id       text,
  -- GHL's own record of who sent an outbound message.
  ghl_user_id          text,
  match_status         text not null check (match_status in ('matched', 'needs_matching')),
  -- How it was matched (ghl_id, email, phone, admin), or why it needs matching.
  matched_by           text check (matched_by in ('ghl_id', 'email', 'phone', 'admin')),
  match_reason         text check (match_reason in ('shared_email', 'shared_phone', 'email_phone_differ', 'linked_to_other_ghl', 'no_match')),
  -- For "Needs matching": the people it could be.
  candidate_ids        uuid[] not null default '{}',
  read_at              timestamptz,
  read_by              uuid,
  created_at           timestamptz not null default now(),
  constraint messages_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint messages_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id),
  constraint messages_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint messages_read_by_fkey
    foreign key (read_by) references public.profiles (id) on delete set null,
  constraint messages_one_per_ghl_message unique (organization_id, ghl_message_id),
  constraint messages_matched_has_person check ((match_status = 'matched') = (contact_id is not null)),
  constraint messages_matched_says_how check (match_status <> 'matched' or matched_by is not null)
);

create index if not exists messages_contact_id_idx on public.messages (contact_id, sent_at desc);
create index if not exists messages_needs_matching_idx on public.messages (organization_id, sent_at desc) where match_status = 'needs_matching';
create index if not exists messages_unread_idx on public.messages (organization_id, contact_id) where read_at is null and direction = 'inbound';

alter table public.messages enable row level security;
drop policy if exists "people on the file see its messages" on public.messages;
create policy "people on the file see its messages" on public.messages
  for select to authenticated using (
    (contact_id is not null and public.can_see_contact(contact_id))
    or public.sees_all_files(organization_id)
  );

-- The file a person's messages are shown on: their newest open file, else
-- their newest file.
create or replace function public.message_loan_for(p_contact_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.loan_borrowers lb
  join public.loans l on l.id = lb.loan_id
  where lb.contact_id = p_contact_id
  order by (l.stage in ('closed', 'lost')) asc, l.created_at desc
  limit 1;
$$;

-- Only the ghl-inbound Edge Function (service role) may run it.
revoke all on function public.message_loan_for(uuid) from public;
do $$ begin
  revoke all on function public.message_loan_for(uuid) from anon, authenticated;
exception when undefined_object then null;
end $$;
do $$ begin
  grant execute on function public.message_loan_for(uuid) to service_role;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Matching by hand, read receipts, candidates for the Edge Function
-- ---------------------------------------------------------------------------

-- An admin says who a "Needs matching" message is from. Every other waiting
-- message from the same GHL contact goes with it, and the person is linked to
-- that GHL contact (unless they already have one), so later messages match
-- on their own.
create or replace function public.match_message(p_message_id uuid, p_contact_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg public.messages%rowtype;
  v_contact public.contacts%rowtype;
  v_loan uuid;
  v_count integer;
begin
  select * into v_msg from public.messages where id = p_message_id;
  if v_msg.id is null or not public.sees_all_files(v_msg.organization_id) then
    raise exception 'Only an admin can match messages.';
  end if;
  select * into v_contact from public.contacts where id = p_contact_id and organization_id = v_msg.organization_id;
  if v_contact.id is null then
    raise exception 'That person isn''t in this company.';
  end if;
  v_loan := public.message_loan_for(p_contact_id);

  update public.messages m
  set contact_id = p_contact_id, loan_id = v_loan, match_status = 'matched', matched_by = 'admin', match_reason = null, candidate_ids = '{}'
  where m.organization_id = v_msg.organization_id
    and (m.id = p_message_id
      or (m.match_status = 'needs_matching' and v_msg.ghl_contact_id is not null and m.ghl_contact_id = v_msg.ghl_contact_id));
  get diagnostics v_count = row_count;

  if v_contact.ghl_contact_id is null and v_msg.ghl_contact_id is not null
    and not exists (select 1 from public.contacts c where c.organization_id = v_msg.organization_id and c.ghl_contact_id = v_msg.ghl_contact_id) then
    perform set_config('losuite.ghl_link', 'on', true);
    update public.contacts set ghl_contact_id = v_msg.ghl_contact_id where id = p_contact_id;
    perform set_config('losuite.ghl_link', '', true);
  end if;
  return v_count;
end;
$$;

revoke all on function public.match_message(uuid, uuid) from public;
grant execute on function public.match_message(uuid, uuid) to authenticated;

-- Marks a person's received messages as read, for whoever can see the file.
create or replace function public.mark_messages_read(p_contact_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null or not public.can_see_contact(p_contact_id) then
    return 0;
  end if;
  update public.messages set read_at = now(), read_by = auth.uid()
  where contact_id = p_contact_id and direction = 'inbound' and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_messages_read(uuid) from public;
grant execute on function public.mark_messages_read(uuid) to authenticated;

-- The people a GHL contact could be, for the Edge Function's matching (same
-- rules as supabase/functions/ghl/match.ts: GHL id, email, last 10 digits of
-- the phone). Never by name. Service role only.
create or replace function public.ghl_match_candidates(p_organization_id uuid, p_ghl_contact_id text, p_email text, p_phone10 text)
returns table (id uuid, ghl_contact_id text, email text, phone_digits text, first_name text, last_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.ghl_contact_id, c.email, c.phone_digits, c.first_name, c.last_name
  from public.contacts c
  where c.organization_id = p_organization_id
    and ((p_ghl_contact_id is not null and c.ghl_contact_id = p_ghl_contact_id)
      or (p_email is not null and lower(trim(c.email)) = lower(trim(p_email)))
      or (p_phone10 is not null and right(c.phone_digits, 10) = p_phone10));
$$;

-- Only the ghl-inbound Edge Function (service role) may run it.
revoke all on function public.ghl_match_candidates(uuid, text, text, text) from public;
do $$ begin
  revoke all on function public.ghl_match_candidates(uuid, text, text, text) from anon, authenticated;
exception when undefined_object then null;
end $$;
do $$ begin
  grant execute on function public.ghl_match_candidates(uuid, text, text, text) to service_role;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite GHL messages installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('messages', 'consent_events')) as tables,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'contacts' and column_name in ('sms_opted_out_at', 'email_opted_out_at'))
       or (table_name = 'messaging_settings' and column_name in ('ghl_location_id', 'last_synced_at', 'inbound_mode')))) as columns,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('restore_consent', 'match_message', 'mark_messages_read', 'ghl_match_candidates', 'message_loan_for', 'guard_opt_out')) as functions,
  (select string_agg(inbound_mode, ', ') from public.messaging_settings) as inbound_modes;
