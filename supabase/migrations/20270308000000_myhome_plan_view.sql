-- MPS HQ: the readiness plan in MyHome (Connor 2026-11-24, "#2": Nurture
-- borrowers see their approved plan, its milestones and the roadmap PDF).
--
-- The plan itself needs no new table: the myhome Edge Function reads the
-- file's approved plan. This script adds the one thing borrowers can do on it:
-- myhome_milestone_done() (service role), "Tell {LO} I did this" on a
-- milestone. It never ticks the milestone: it adds an unverified update (kind
-- reported_done, source myhome) to the file's "Updates from {name}" card for
-- the LO to verify (Verify and mark done ticks it, as for replies), a note,
-- and a myhome_request notice. One open report per milestone; asking again
-- returns the one waiting.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome plan view installed").

create or replace function public.myhome_milestone_done(p_account uuid, p_milestone uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  m public.readiness_milestones;
  v_loan public.loans;
  v_id uuid;
  v_name text;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  select * into m from public.readiness_milestones where id = p_milestone;
  if m.id is null or m.organization_id <> a.organization_id
     or not exists (select 1 from public.loan_borrowers lb where lb.loan_id = m.loan_id and lb.contact_id = a.contact_id) then
    raise exception 'That step isn''t in your plan.';
  end if;
  if not exists (select 1 from public.readiness_plans p where p.id = m.plan_id and p.status = 'approved') then
    raise exception 'Your plan changed. Refresh to see the latest one.';
  end if;
  select * into v_loan from public.loans where id = m.loan_id;
  if v_loan.stage <> 'nurture' then raise exception 'This plan isn''t active anymore.'; end if;
  if m.status = 'done' then raise exception 'This step is already checked off.'; end if;
  if p_note is not null and length(p_note) > 500 then raise exception 'Keep the note under 500 characters.'; end if;

  select u.id into v_id from public.nurture_updates u
  where u.milestone_id = m.id and u.source = 'myhome' and u.status in ('queued', 'unverified') limit 1;
  if v_id is not null then return v_id; end if;

  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = a.contact_id;
  insert into public.nurture_updates (organization_id, loan_id, contact_id, milestone_id, source, status, kind, summary)
  values (m.organization_id, m.loan_id, a.contact_id, m.id, 'myhome', 'unverified', 'reported_done',
    left(coalesce(v_name, 'The borrower') || ' says they finished "' || m.title || '".' || coalesce(' "' || nullif(trim(coalesce(p_note, '')), '') || '"', ''), 1000))
  returning id into v_id;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (m.organization_id, a.contact_id, m.loan_id, 'note',
    coalesce(v_name, 'The borrower') || ' said they finished "' || m.title || '" (MyHome).' || coalesce(' "' || nullif(trim(coalesce(p_note, '')), '') || '"', ''));
  perform public.notify_user(m.organization_id, v_loan.assigned_lo_id, 'myhome_request',
    coalesce(v_name, 'A borrower') || ' finished "' || m.title || '"', 'Verify it on the Nurture view', '/loans/' || m.loan_id::text, v_id);
  return v_id;
end;
$$;

revoke all on function public.myhome_milestone_done(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.myhome_milestone_done(uuid, uuid, text) to service_role;

select
  'MPS HQ MyHome plan view installed' as result,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'myhome_milestone_done') as functions;
