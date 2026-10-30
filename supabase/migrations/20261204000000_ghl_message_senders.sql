-- LOSuite: who a GHL message is from, as GHL has them (Phase 2b, Connor
-- 2026-10-29). An admin matching a "Needs matching" message needs to see the
-- GHL contact's name, email and phone to pick the right person. The
-- ghl-inbound Edge Function fills these from the GHL contact it already reads
-- for matching (never the SSN). Messages saved before this script show the
-- GHL contact id only.
--
-- Apply to the DEV Supabase project only, after the GHL messages script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite GHL message senders installed").

alter table public.messages
  add column if not exists ghl_contact_name   text,
  add column if not exists ghl_contact_email  text,
  add column if not exists ghl_contact_phone  text;

select
  'LOSuite GHL message senders installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messages'
     and column_name in ('ghl_contact_name', 'ghl_contact_email', 'ghl_contact_phone')) as columns;
