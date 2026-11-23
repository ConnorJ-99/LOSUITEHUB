-- MPS HQ: MyHome asks on the file (Connor, 2026-11-23: "there's nowhere on the
-- file to show me where he requested to see the updated value").
--
-- A closed file's MyHome card lists the borrower's asks (check my value, and
-- later refi and equity checks) from myhome_events, which staff can already
-- read. handle_myhome_ask(event) marks one done (handled_at, handled_by = the
-- person pressing it), for anyone who can see the person and the file; logins
-- still can't write myhome_events directly. Once an ask is done, the borrower
-- can ask again the same day.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome asks installed").

create or replace function public.handle_myhome_ask(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.myhome_events;
begin
  select * into e from public.myhome_events where id = p_event;
  if e.id is null or e.kind not like '%\_requested' escape '\'
     or not public.can_see_contact(e.contact_id) or (e.loan_id is not null and not public.can_see_loan(e.loan_id)) then
    raise exception 'That request isn''t on a file you can see.';
  end if;
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  update public.myhome_events set handled_at = coalesce(handled_at, now()), handled_by = coalesce(handled_by, auth.uid()) where id = p_event;
end;
$$;

revoke all on function public.handle_myhome_ask(uuid) from public, anon;
grant execute on function public.handle_myhome_ask(uuid) to authenticated;

select
  'MPS HQ MyHome asks installed' as result,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'handle_myhome_ask') as functions;
