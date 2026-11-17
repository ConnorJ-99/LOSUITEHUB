-- MPS HQ: Docs & Conditions shows conditions only (Connor, 2026-11-17).
--
-- The borrower document checklist card is gone from the file; every
-- document asked for now sits under a condition. This script:
--   condition_for_request()  a document request saved without a condition
--                            (the prequal request, "Request documents" with
--                            no condition, anything else) gets one made for
--                            it and linked, on every file that isn't closed
--   the existing ones        checklist items with no condition get one now,
--                            so nothing disappears from the tab
--
-- The condition reads like the item ("Pay stubs"), plus the borrower's first
-- name when the file has more than one borrower. Its status follows the
-- item: waiting or sent back = Requested, received or accepted = Received,
-- waived = Waived. Safe to run again: only items still without a condition
-- are touched. Ends with one confirmation row
-- ("MPS HQ conditions only installed").

-- ---------------------------------------------------------------------------
-- The condition for one item
-- ---------------------------------------------------------------------------

create or replace function public.condition_for_request_row(req public.document_requests)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  who text;
begin
  if req.condition_id is not null then
    return req.condition_id;
  end if;
  if not exists (select 1 from public.loans l where l.id = req.loan_id and l.stage::text <> 'closed') then
    return null;
  end if;
  -- A suggested condition may already point at this item.
  select c.id into cid from public.loan_conditions c where c.document_request_id = req.id limit 1;
  if cid is null then
    if req.contact_id is not null and (select count(*) from public.loan_borrowers b where b.loan_id = req.loan_id) > 1 then
      select nullif(trim(c.first_name), '') into who from public.contacts c where c.id = req.contact_id;
    end if;
    insert into public.loan_conditions (organization_id, loan_id, position, body, party, status, document_request_id)
    values (
      req.organization_id,
      req.loan_id,
      coalesce((select max(c.position) from public.loan_conditions c where c.loan_id = req.loan_id), 0) + 1,
      trim(req.label) || coalesce(' (' || who || ')', ''),
      'borrower',
      (case
         when req.status::text in ('received', 'reviewed') then 'received'
         when req.status::text = 'waived' then 'waived'
         else 'requested'
       end)::public.condition_status,
      req.id
    )
    returning id into cid;
  end if;
  update public.document_requests set condition_id = cid where id = req.id;
  return cid;
end;
$$;

revoke all on function public.condition_for_request_row(public.document_requests) from public, anon, authenticated;

create or replace function public.condition_for_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.condition_for_request_row(new);
  return new;
end;
$$;

revoke all on function public.condition_for_request() from public, anon, authenticated;

drop trigger if exists document_requests_condition_for_request on public.document_requests;
create trigger document_requests_condition_for_request after insert on public.document_requests
  for each row when (new.condition_id is null) execute function public.condition_for_request();

-- ---------------------------------------------------------------------------
-- Checklist items already on files, oldest first
-- ---------------------------------------------------------------------------

do $$
declare
  r public.document_requests;
begin
  for r in select * from public.document_requests where condition_id is null order by loan_id, requested_at, id loop
    perform public.condition_for_request_row(r);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ conditions only installed' as result,
  (select count(*) from pg_trigger where tgname = 'document_requests_condition_for_request') as triggers,
  (select count(*) from public.document_requests r join public.loans l on l.id = r.loan_id
    where r.condition_id is null and l.stage::text <> 'closed') as items_without_a_condition;
