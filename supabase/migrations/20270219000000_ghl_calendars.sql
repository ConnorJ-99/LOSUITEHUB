-- GHL calendars (Connor, 2026-11-18): appointments are booked from a client's
-- text thread onto the file's loan officer's own GoHighLevel calendar. Each
-- loan officer's calendar is picked once in Settings → GoHighLevel and kept on
-- their GHL link. Owners and admins pick it (the existing "owners and admins
-- update GHL links" rule); everyone in the company can read it.
--
-- Safe to run more than once. A full run ends with a confirmation row.

alter table public.ghl_user_links add column if not exists ghl_calendar_id text;
alter table public.ghl_user_links add column if not exists ghl_calendar_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ghl_user_links_calendar_named') then
    alter table public.ghl_user_links add constraint ghl_user_links_calendar_named
      check (ghl_calendar_id is null or length(trim(ghl_calendar_id)) > 0);
  end if;
end;
$$;

comment on column public.ghl_user_links.ghl_calendar_id is 'The GHL calendar this person''s appointments are booked on (picked in Settings → GoHighLevel). Null = not picked; booking is off for their files.';
comment on column public.ghl_user_links.ghl_calendar_name is 'The calendar''s name in GHL when it was picked, for showing.';

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ GHL calendars installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ghl_user_links' and column_name in ('ghl_calendar_id', 'ghl_calendar_name')) as columns;
