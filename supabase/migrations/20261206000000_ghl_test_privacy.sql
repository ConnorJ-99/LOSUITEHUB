-- LOSuite: test-mode privacy fix (Connor, 2026-10-30; plan step A in
-- docs/plans/ghl-messaging.md). Linking a TEST lead to Connor's own GHL
-- contact copied in that contact's older messages, including GHL's internal
-- "NEW LEAD" alerts with real clients' names and phones. In test mode the
-- ghl-inbound function now saves only messages sent after the person was
-- linked, and never GHL's own workflow, campaign or bulk messages.
--
-- 1. contacts.ghl_linked_at: when the person was linked to their GHL contact.
--    The database stamps it whenever ghl_contact_id is set or changed (and
--    clears it when the link is removed). People already linked get the time
--    of their first message sent from LOSuite, else now.
-- 2. messages.ghl_source: GHL's record of what sent a message (app, api,
--    workflow, campaign, bulk_actions), kept for new messages.
--
-- The copied history itself is removed by
-- supabase/seed-dev/ghl-test-history-cleanup.sql (dev only).
--
-- Apply to the DEV Supabase project only, after the GHL sending script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite GHL test privacy installed").

alter table public.contacts add column if not exists ghl_linked_at timestamptz;
alter table public.messages add column if not exists ghl_source text;

create or replace function public.stamp_ghl_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ghl_contact_id is null then
    new.ghl_linked_at := null;
  elsif tg_op = 'INSERT' or new.ghl_contact_id is distinct from old.ghl_contact_id then
    new.ghl_linked_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_ghl_link() from public;

drop trigger if exists stamp_ghl_link on public.contacts;
create trigger stamp_ghl_link
  before insert or update of ghl_contact_id on public.contacts
  for each row execute function public.stamp_ghl_link();

-- People linked before this script: their first message sent from LOSuite, else now.
update public.contacts c
set ghl_linked_at = coalesce(
  (select min(m.sent_at) from public.messages m where m.contact_id = c.id and m.sent_by is not null),
  now())
where c.ghl_contact_id is not null and c.ghl_linked_at is null;

select
  'LOSuite GHL test privacy installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'contacts' and column_name = 'ghl_linked_at') or (table_name = 'messages' and column_name = 'ghl_source'))) as columns,
  (select count(*) from pg_trigger where tgname = 'stamp_ghl_link' and tgrelid = 'public.contacts'::regclass) as triggers,
  (select count(*) from public.contacts where ghl_contact_id is not null and ghl_linked_at is null) as linked_without_time;
