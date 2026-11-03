-- LOSuite: documents sent with a message (Connor, 2026-10-30; plan step B in
-- docs/plans/ghl-messaging.md). An email sent from LOSuite can carry up to
-- three saved PDFs from the file (Fee Worksheet, loan comparison,
-- pre-approval letter). The "ghl" Edge Function uploads them into the
-- person's GHL conversation and keeps which ones went here, as
-- [{"documentId": "...", "fileName": "..."}].
--
-- Apply to the DEV Supabase project only, after the GHL test privacy script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite GHL attachments installed").

alter table public.messages add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_attachments_is_list') then
    alter table public.messages add constraint messages_attachments_is_list check (jsonb_typeof(attachments) = 'array');
  end if;
end;
$$;

select
  'LOSuite GHL attachments installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'attachments') as columns,
  (select count(*) from pg_constraint where conname = 'messages_attachments_is_list') as checks;
