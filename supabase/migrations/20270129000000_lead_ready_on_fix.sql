-- MPS HQ: lead ready dates fix and custom dates (Connor, 2026-11-14).
--
-- 1. Picking a time frame on a card failed with "permission denied for
--    function timeline_months": the ready date trigger runs as the person
--    saving, so they need to be able to use it. It only turns words like
--    "2 months" into a number.
-- 2. A custom date typed on the card ("03/15/2027" or "03/2027") is saved as
--    the time frame with its own ready date; the trigger leaves that date
--    alone.
--
-- Safe to re-run. Ends with a confirmation row.

grant execute on function public.timeline_months(text) to authenticated, service_role;

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
  -- A custom date (mm/dd/yyyy or mm/yyyy) carries its own ready date.
  if trim(coalesce(new.timeline, '')) ~ '^\d{1,2}/\d{1,2}(/\d{4})?$|^\d{1,2}/\d{4}$' then
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

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ lead ready dates fix installed' as result,
  has_function_privilege('authenticated', 'public.timeline_months(text)', 'execute') as people_can_pick;
