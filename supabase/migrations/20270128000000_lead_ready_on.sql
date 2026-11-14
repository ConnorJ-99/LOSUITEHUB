-- MPS HQ: when a lead will be ready (Connor, 2026-11-14).
--
-- loans.ready_on: the month the borrower expects to be ready to buy or
-- refinance, worked out from the time frame (loans.timeline) on the day it
-- was picked: ASAP = that day, "2 months" = two months later, "3–6 months" =
-- three months later (the start of the window), "6+ months" = six months
-- later, "Just looking" or words typed elsewhere = blank. The pipeline card
-- shows "Ready Jan 2027" and "Ready now" once the date has come. The
-- matching is the same as timelineChoice / readyOnFor in
-- src/lib/pipeline/timeline.ts.
--
-- A file whose time frame was set before this script gets a date counted
-- from the day the file came in.
--
-- Safe to re-run. Ends with a confirmation row.

alter table public.loans add column if not exists ready_on date;

-- How many months a time frame means; null when it can't be counted.
create or replace function public.timeline_months(p_timeline text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := regexp_replace(lower(trim(coalesce(p_timeline, ''))), '\s+', ' ', 'g');
begin
  t := replace(replace(t, '–', '-'), '—', '-');
  return case t
    when 'asap' then 0
    when 'now' then 0
    when 'immediately' then 0
    when 'right away' then 0
    when '0-30 days' then 0
    when '30-60 days' then 1
    when '1-2 months' then 1
    when '1-3 months' then 1
    when '60-90 days' then 2
    when '2-3 months' then 2
    when 'in the next 3 months' then 3
    when 'next 3 months' then 3
    when 'within 3 months' then 3
    when '90+ days' then 3
    when '1 month' then 1
    when '30 days' then 1
    when 'one month' then 1
    when '2 months' then 2
    when '60 days' then 2
    when 'two months' then 2
    when '3 months' then 3
    when '90 days' then 3
    when 'three months' then 3
    when '3-6 months' then 3
    when '3 to 6 months' then 3
    when '6+ months' then 6
    when '6 months+' then 6
    when 'over 6 months' then 6
  end;
end;
$$;
revoke all on function public.timeline_months(text) from public;
do $$ begin
  revoke all on function public.timeline_months(text) from anon, authenticated;
exception when undefined_object then null; end $$;

-- A new or changed time frame sets the ready date, unless the same save sets the date itself.
create or replace function public.set_ready_on()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_months integer;
begin
  if tg_op = 'INSERT' then
    if new.timeline is null or new.ready_on is not null then return new; end if;
  elsif new.timeline is not distinct from old.timeline or new.ready_on is distinct from old.ready_on then
    return new;
  end if;
  v_months := public.timeline_months(new.timeline);
  new.ready_on := case when v_months is null then null
    else ((now() at time zone 'America/Chicago')::date + make_interval(months => v_months))::date end;
  return new;
end;
$$;
revoke all on function public.set_ready_on() from public;
do $$ begin
  revoke all on function public.set_ready_on() from anon, authenticated;
exception when undefined_object then null; end $$;

drop trigger if exists loans_set_ready_on on public.loans;
create trigger loans_set_ready_on
  before insert or update of timeline, ready_on on public.loans
  for each row execute function public.set_ready_on();

-- Time frames set before this script: counted from the day the file came in.
update public.loans
   set ready_on = ((created_at at time zone 'America/Chicago')::date + make_interval(months => public.timeline_months(timeline)))::date
 where ready_on is null and public.timeline_months(timeline) is not null;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ lead ready dates installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name = 'ready_on') as columns,
  (select count(*) from public.loans where ready_on is not null) as files_with_a_ready_date;
