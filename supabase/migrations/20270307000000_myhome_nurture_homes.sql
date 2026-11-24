-- MPS HQ: MyHome "Homes I like" on Nurture purchase files (Connor 2026-11-24:
-- "add properties to MyHome, so borrowers can submit properties").
--
-- Open purchase files already have My properties → Request numbers
-- (submit_myhome_request). A borrower who is still getting ready (Nurture)
-- can now save homes they like, without asking for a letter or estimate yet:
-- myhome_add_home() (the myhome Edge Function, service role) adds the home to
-- the file's Properties as "interested" (address, price, listing link), leaves
-- a note with what they wrote, a home_request event and a myhome_request
-- notice to the file's loan officer. Ten a day per account.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome nurture homes installed").

create or replace function public.myhome_add_home(p_account uuid, p_loan uuid, p_address text, p_city text, p_zip text, p_price numeric, p_link text, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  v_loan public.loans;
  v_property uuid;
  v_name text;
  v_line text;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  select * into v_loan from public.loans where id = p_loan and organization_id = a.organization_id;
  if v_loan.id is null or not exists (select 1 from public.loan_borrowers lb where lb.loan_id = p_loan and lb.contact_id = a.contact_id) then
    raise exception 'That loan is not yours.';
  end if;
  if v_loan.stage <> 'nurture' then raise exception 'This plan isn''t active anymore.'; end if;
  if v_loan.purpose <> 'purchase' then raise exception 'Saving homes is for buying a home.'; end if;
  if coalesce(trim(p_address), '') = '' or length(trim(p_address)) > 200 then raise exception 'Enter the home''s street address.'; end if;
  if p_price is not null and (p_price <= 0 or p_price >= 100000000) then raise exception 'Check the price.'; end if;
  if p_link is not null and trim(p_link) <> '' and (trim(p_link) !~* '^https://' or length(trim(p_link)) > 500) then
    raise exception 'The listing link should start with https://';
  end if;
  if p_notes is not null and length(p_notes) > 500 then raise exception 'Keep the note under 500 characters.'; end if;
  if (select count(*) from public.myhome_events e where e.account_id = a.id and e.kind = 'home_request' and e.created_at > now() - interval '1 day') >= 10 then
    raise exception 'That''s a lot of homes for one day. Try again tomorrow, or contact your loan officer.';
  end if;

  insert into public.properties (organization_id, loan_id, address_line, city, state, zip, status, list_price, listing_url, created_by)
  values (a.organization_id, p_loan, trim(p_address), nullif(trim(coalesce(p_city, '')), ''), 'TX', nullif(trim(coalesce(p_zip, '')), ''), 'interested',
    round(p_price, 2), nullif(trim(coalesce(p_link, '')), ''), null)
  returning id into v_property;

  insert into public.myhome_events (organization_id, account_id, contact_id, loan_id, kind, detail)
  values (a.organization_id, a.id, a.contact_id, p_loan, 'home_request', jsonb_build_object('propertyId', v_property, 'saved', true));

  select trim(c.first_name || ' ' || coalesce(c.last_name, '')) into v_name from public.contacts c where c.id = a.contact_id;
  v_line := trim(p_address) || coalesce(', ' || nullif(trim(coalesce(p_city, '')), ''), '') || case when p_price is not null then ' at $' || to_char(p_price, 'FM999,999,999') else '' end;
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (a.organization_id, a.contact_id, p_loan, 'note',
    coalesce(v_name, 'The borrower') || ' saved a home they like: ' || v_line || ' (MyHome).' || coalesce(' "' || nullif(trim(coalesce(p_notes, '')), '') || '"', ''));
  perform public.notify_user(a.organization_id, v_loan.assigned_lo_id, 'myhome_request',
    coalesce(v_name, 'A borrower') || ' saved a home they like', v_line, '/loans/' || p_loan::text || '?tab=properties', v_property);
  return v_property;
end;
$$;

revoke all on function public.myhome_add_home(uuid, uuid, text, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.myhome_add_home(uuid, uuid, text, text, text, numeric, text, text) to service_role;

select
  'MPS HQ MyHome nurture homes installed' as result,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'myhome_add_home') as functions;
