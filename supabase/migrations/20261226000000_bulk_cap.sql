-- MPS HQ: the daily cap on assistant bulk messages (Loan Officer Assistant,
-- Phase 3b, Connor 2026-11-03).
--
-- messaging_settings.bulk_daily_cap: how many bulk messages one loan officer
-- may approve in a day (Central time), 250 to start; owners and admins change
-- it in Settings → Sending. Bulk messages are ordinary approvals (one per
-- person, scheduled 20 a minute through the every-minute timer) whose key
-- starts "bulk:"; bulk_approved_today() counts the signed-in person's, and
-- approve_send() refuses one that would go over the cap.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ bulk cap installed").

alter table public.messaging_settings
  add column if not exists bulk_daily_cap integer not null default 250;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messaging_settings_bulk_daily_cap_check') then
    alter table public.messaging_settings
      add constraint messaging_settings_bulk_daily_cap_check check (bulk_daily_cap between 0 and 2000);
  end if;
end $$;

-- The signed-in person's bulk approvals made today (Central time).
create or replace function public.bulk_approved_today()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.send_approvals
  where approved_by = auth.uid()
    and client_key like 'bulk:%'
    and (approved_at at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date;
$$;

revoke all on function public.bulk_approved_today() from public, anon;
grant execute on function public.bulk_approved_today() to authenticated;

-- The cap, checked in the database whatever the screen showed.
create or replace function public.guard_bulk_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
begin
  if new.client_key not like 'bulk:%' then
    return new;
  end if;
  select bulk_daily_cap into v_cap from public.messaging_settings where organization_id = new.organization_id;
  if (select count(*) from public.send_approvals
      where approved_by = new.approved_by and client_key like 'bulk:%'
        and (approved_at at time zone 'America/Chicago')::date = (now() at time zone 'America/Chicago')::date) >= coalesce(v_cap, 250) then
    raise exception 'Daily bulk limit reached (% a day, Settings → Sending). Nothing more was scheduled.', coalesce(v_cap, 250);
  end if;
  return new;
end;
$$;

revoke all on function public.guard_bulk_cap() from public, anon, authenticated;

drop trigger if exists guard_bulk_cap on public.send_approvals;
create trigger guard_bulk_cap
  before insert on public.send_approvals
  for each row execute function public.guard_bulk_cap();

select
  'MPS HQ bulk cap installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messaging_settings' and column_name = 'bulk_daily_cap') as columns,
  (select count(*) from pg_trigger where tgname = 'guard_bulk_cap') as triggers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'bulk_approved_today') as functions;
