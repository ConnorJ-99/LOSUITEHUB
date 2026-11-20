-- MPS HQ: MyHome, Stage 2 (active files; plan docs/plans/myhome.md,
-- approved by Connor 2026-11-20: "go for it").
--
-- A signed-in MyHome borrower sees an open file the way the borrower portal
-- shows it, through the `myhome` Edge Function (service role). Everything is
-- read from the existing tables. The one new piece is "Request numbers" from
-- MyHome: submit_portal_request() needs a portal link, so this adds
-- submit_myhome_request(), which does the same for a MyHome account (the home
-- is added to the file as interested, the request keeps the Approval Limits
-- and how far over them it is, a note goes on the file and the loan officer
-- gets the usual portal_request notice). The request has no link (link_id is
-- null). Only the service role can run it; it checks that the account is on,
-- its person is a borrower on the file, and the file is open.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome active files installed").

create or replace function public.submit_myhome_request(
  p_account uuid, p_loan uuid, p_address text, p_city text, p_state text, p_zip text, p_price numeric,
  p_down_amount numeric, p_down_pct numeric, p_wants_letter boolean, p_wants_estimate boolean, p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  v_loan public.loans;
  v_amount numeric;
  v_property uuid;
  v_name text;
  v_over text;
  v_req public.portal_property_requests;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then
    raise exception 'This MyHome account is not on.';
  end if;
  select * into v_loan from public.loans where id = p_loan and organization_id = a.organization_id;
  if v_loan.id is null or not exists (select 1 from public.loan_borrowers lb where lb.loan_id = p_loan and lb.contact_id = a.contact_id) then
    raise exception 'That loan is not yours.';
  end if;
  if v_loan.stage in ('closed', 'lost', 'nurture') then
    raise exception 'This loan is not open.';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Enter the price.';
  end if;
  if p_down_amount is not null and p_down_pct is not null then
    raise exception 'Enter the down payment in dollars or as a percent, not both.';
  end if;
  v_amount := case
    when p_down_amount is not null then greatest(p_price - p_down_amount, 0)
    when p_down_pct is not null then round(p_price * (1 - p_down_pct / 100), 2)
  end;

  insert into public.properties (organization_id, loan_id, address_line, city, state, zip, status, list_price, created_by)
  values (a.organization_id, p_loan, trim(p_address), nullif(trim(p_city), ''), upper(coalesce(nullif(trim(p_state), ''), 'TX')), nullif(trim(p_zip), ''), 'interested', p_price, null)
  returning id into v_property;

  insert into public.portal_property_requests (
    organization_id, loan_id, contact_id, property_id, link_id, address_line, city, state, zip, price,
    down_payment_amount, down_payment_pct, wants_letter, wants_estimate, notes,
    max_price, max_loan_amount, loan_amount, over_price, over_loan_amount
  ) values (
    a.organization_id, p_loan, a.contact_id, v_property, null, trim(p_address), nullif(trim(p_city), ''), upper(coalesce(nullif(trim(p_state), ''), 'TX')), nullif(trim(p_zip), ''), p_price,
    p_down_amount, p_down_pct, coalesce(p_wants_letter, false), coalesce(p_wants_estimate, false), nullif(trim(p_notes), ''),
    v_loan.preapproval_max_price, v_loan.preapproval_max_loan_amount, v_amount,
    case when v_loan.preapproval_max_price is not null then greatest(p_price - v_loan.preapproval_max_price, 0) else 0 end,
    case when v_loan.preapproval_max_loan_amount is not null and v_amount is not null then greatest(v_amount - v_loan.preapproval_max_loan_amount, 0) else 0 end
  ) returning * into v_req;

  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = a.contact_id;
  v_over := case
    when v_req.over_price > 0 then ' · Over approved max by $' || to_char(v_req.over_price, 'FM999,999,999')
    when v_req.over_loan_amount > 0 then ' · Over approved loan amount by $' || to_char(v_req.over_loan_amount, 'FM999,999,999')
    else '' end;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (a.organization_id, a.contact_id, p_loan, 'note',
    coalesce(v_name, 'The borrower') || ' requested numbers for ' || trim(p_address) || ' at $' || to_char(p_price, 'FM999,999,999') || ' (MyHome)' || v_over || '.');
  perform public.notify_user(a.organization_id, v_loan.assigned_lo_id, 'portal_request',
    coalesce(v_name, 'A borrower') || ' requested numbers for ' || trim(p_address), ltrim(v_over, ' ·'), '/loans/' || p_loan::text || '?tab=properties', v_req.id);
  return v_req.id;
end;
$$;

revoke all on function public.submit_myhome_request(uuid, uuid, text, text, text, text, numeric, numeric, numeric, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_myhome_request(uuid, uuid, text, text, text, text, numeric, numeric, numeric, boolean, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ MyHome active files installed' as result,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'submit_myhome_request') as functions;
