-- MPS HQ: the final Closing Disclosure's sale price (Connor, 2026-11-23: "the
-- value when we update the CD should update the property for list price, which
-- when they are closed should be the purchase price").
--
-- apply_closing_disclosure() now also takes loans.purchase_price (the CD's
-- Sale Price, page 1, purchases only) and puts the same figure on the subject
-- home's list_price, so the Property tab and MyHome show the price paid. Undo
-- puts both back. Everything else is unchanged from 20270229000000_cd_fills_home.sql.
--
-- Safe to run more than once. A full run ends with a confirmation row.

create or replace function public.apply_closing_disclosure(p_reading_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_loan uuid;
  v_status public.extraction_status;
  v_home uuid;
  v_loan_now jsonb;
  v_home_now jsonb;
  v_loan_set jsonb := '{}'::jsonb;
  v_home_set jsonb := '{}'::jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_change jsonb;
  v_table text;
  v_col text;
  v_cols text;
  v_rows integer;
  v_closing date;
  v_funding date;
  v_org uuid;
  v_occupancy text;
  v_addr jsonb;
  v_created boolean := false;
begin
  select loan_id, status into v_loan, v_status from public.closing_disclosure_readings where id = p_reading_id for update;
  if not found then raise exception 'That Closing Disclosure reading isn''t on a file you can see.'; end if;
  if v_status <> 'pending_review' then raise exception 'This Closing Disclosure reading was already reviewed.'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then raise exception 'Pick at least one figure to apply.'; end if;

  select jsonb_build_object(
           'loan_amount', loan_amount, 'note_rate', note_rate, 'term_months', term_months, 'closing_date', closing_date,
           'funding_date', funding_date, 'first_payment_date', first_payment_date, 'monthly_payment', monthly_payment,
           'lender_credits', lender_credits, 'seller_credits', seller_credits, 'discount_points_amount', discount_points_amount,
           'prepaid_items_amount', prepaid_items_amount, 'lender_loan_number', lender_loan_number, 'lender_id', lender_id,
           'appraised_value', appraised_value, 'purchase_price', purchase_price),
         subject_property_id, organization_id, occupancy::text
    into v_loan_now, v_home, v_org, v_occupancy
    from public.loans where id = v_loan;
  if v_loan_now is null then raise exception 'You do not have permission to change this loan.'; end if;
  -- The CD's property address (2026-11-23): with no subject home, a home on the file at that
  -- address becomes the subject home, else one is added. A file that has one is never renamed.
  select value into v_addr from jsonb_array_elements(p_changes) where value ->> 'target' = 'properties.address' limit 1;
  if v_addr is not null and v_home is null then
    if coalesce(trim(v_addr #>> '{after,line}'), '') = '' or coalesce(trim(v_addr #>> '{after,city}'), '') = '' or coalesce(v_addr #>> '{after,state}', '') !~ '^[A-Za-z]{2}$' then
      raise exception 'The property address couldn''t be read into street, city and state.';
    end if;
    perform set_config('mps.change_reason', 'Final Closing Disclosure', true);
    select id into v_home from public.properties where loan_id = v_loan and lower(trim(address_line)) = lower(trim(v_addr #>> '{after,line}')) limit 1;
    if v_home is null then
      insert into public.properties (organization_id, loan_id, address_line, city, state, zip, status)
      values (v_org, v_loan, trim(v_addr #>> '{after,line}'), trim(v_addr #>> '{after,city}'), upper(v_addr #>> '{after,state}'), nullif(v_addr #>> '{after,zip}', ''),
        case when coalesce(v_occupancy, 'primary') = 'primary' then 'current_home' else 'owned' end::public.property_status)
      returning id into v_home;
      v_created := true;
    end if;
    update public.loans set subject_property_id = v_home where id = v_loan;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'You do not have permission to change this loan.'; end if;
    v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_addr ->> 'key', 'label', v_addr ->> 'label', 'target', 'properties.address', 'propertyId', v_home, 'before', null, 'after', v_addr -> 'after', 'createdHome', v_created));
  end if;
  if v_home is not null then
    select jsonb_build_object('annual_taxes', annual_taxes, 'annual_insurance', annual_insurance) into v_home_now from public.properties where id = v_home;
  end if;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    continue when v_change ->> 'target' = 'properties.address';
    v_table := split_part(v_change ->> 'target', '.', 1);
    v_col := split_part(v_change ->> 'target', '.', 2);
    if v_table = 'loans' and v_loan_now ? v_col and not v_loan_set ? v_col then
      v_loan_set := v_loan_set || jsonb_build_object(v_col, v_change -> 'after');
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_change ->> 'key', 'label', v_change ->> 'label', 'target', v_change ->> 'target', 'before', v_loan_now -> v_col, 'after', v_change -> 'after'));
    elsif v_table = 'properties' and v_home_now ? v_col and not v_home_set ? v_col then
      v_home_set := v_home_set || jsonb_build_object(v_col, v_change -> 'after');
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_change ->> 'key', 'label', v_change ->> 'label', 'target', v_change ->> 'target', 'propertyId', v_home, 'before', v_home_now -> v_col, 'after', v_change -> 'after'));
    elsif v_table = 'properties' and v_home is null then
      raise exception 'This file has no subject home for the taxes and insurance.';
    else
      raise exception 'The Closing Disclosure can''t change "%".', v_change ->> 'target';
    end if;
  end loop;

  perform set_config('mps.change_reason', 'Final Closing Disclosure', true);
  if v_loan_set <> '{}'::jsonb then
    select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(v_loan_set) as k;
    execute format('update public.loans set (%s) = (select %s from jsonb_populate_record(null::public.loans, $1)) where id = $2', v_cols, v_cols) using v_loan_set, v_loan;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'You do not have permission to change this loan.'; end if;
  end if;
  if v_home_set <> '{}'::jsonb then
    select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(v_home_set) as k;
    execute format('update public.properties set (%s) = (select %s from jsonb_populate_record(null::public.properties, $1)) where id = $2', v_cols, v_cols) using v_home_set, v_home;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'You do not have permission to change this home.'; end if;
  end if;
  -- The CD's sale price is the home's price too (on a closed purchase, the price paid; Connor 2026-11-23).
  if v_loan_set ? 'purchase_price' and v_home is not null then
    v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', 'sale_price_home', 'label', 'Home price', 'target', 'properties.list_price', 'propertyId', v_home,
      'before', (select to_jsonb(list_price) from public.properties where id = v_home), 'after', v_loan_set -> 'purchase_price'));
    update public.properties set list_price = (v_loan_set ->> 'purchase_price')::numeric where id = v_home;
  end if;
  perform set_config('mps.change_reason', '', true);

  select closing_date, funding_date into v_closing, v_funding from public.loans where id = v_loan;
  if v_funding < v_closing then raise exception 'The funded date can''t be before the closing date.'; end if;

  update public.closing_disclosure_readings set status = 'applied', applied = v_applied where id = p_reading_id;
  return v_applied;
end;
$$;

revoke all on function public.apply_closing_disclosure(uuid, jsonb) from public, anon;
grant execute on function public.apply_closing_disclosure(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ Closing Disclosure sale price installed' as result,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'apply_closing_disclosure' and pg_get_functiondef(p.oid) like '%sale_price_home%') as functions;
