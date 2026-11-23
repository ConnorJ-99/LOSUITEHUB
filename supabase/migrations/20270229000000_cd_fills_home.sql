-- MPS HQ: the final Closing Disclosure fills in the home (Connor, 2026-11-23:
-- "when we update the CD, we want it to update the property as well").
--
-- apply_closing_disclosure() now also takes:
--   properties.address     the CD's property address as {line, city, state, zip}.
--                          With no subject home, a home on the file at that
--                          address becomes the subject home, else one is added
--                          (current home for a primary residence, else owned),
--                          and the taxes and insurance go on it. A file that
--                          already has a subject home is never renamed.
--   loans.appraised_value  the Appraised Prop. Value (MyHome's starting value on a refinance).
-- undo_closing_disclosure() takes the home back off the file (and removes it
-- when the CD added it, unless other records point to it).
-- Everything else is unchanged from 20270223000000_closing_disclosure_apply.sql.
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
           'appraised_value', appraised_value),
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
  perform set_config('mps.change_reason', '', true);

  select closing_date, funding_date into v_closing, v_funding from public.loans where id = v_loan;
  if v_funding < v_closing then raise exception 'The funded date can''t be before the closing date.'; end if;

  update public.closing_disclosure_readings set status = 'applied', applied = v_applied where id = p_reading_id;
  return v_applied;
end;
$$;

create or replace function public.undo_closing_disclosure(p_reading_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_loan uuid;
  v_status public.extraction_status;
  v_undone timestamptz;
  v_applied jsonb;
  v_item jsonb;
  v_table text;
  v_col text;
  v_now jsonb;
  v_loan_set jsonb := '{}'::jsonb;
  v_home_set jsonb := '{}'::jsonb;
  v_home uuid;
  v_skipped jsonb := '[]'::jsonb;
  v_restored integer := 0;
  v_cols text;
  v_rows integer;
  v_addr jsonb;
begin
  select loan_id, status, undone_at, applied into v_loan, v_status, v_undone, v_applied from public.closing_disclosure_readings where id = p_reading_id for update;
  if not found then raise exception 'That Closing Disclosure reading isn''t on a file you can see.'; end if;
  if v_status <> 'applied' then raise exception 'Only an applied Closing Disclosure reading can be undone.'; end if;
  if v_undone is not null then raise exception 'This Closing Disclosure reading was already undone.'; end if;

  for v_item in select value from jsonb_array_elements(v_applied) loop
    if v_item ->> 'target' = 'properties.address' then
      v_addr := v_item;
      continue;
    end if;
    v_table := split_part(v_item ->> 'target', '.', 1);
    v_col := split_part(v_item ->> 'target', '.', 2);
    if v_table = 'loans' then
      execute format('select to_jsonb(%I) from public.loans where id = $1', v_col) into v_now using v_loan;
    else
      v_home := (v_item ->> 'propertyId')::uuid;
      execute format('select to_jsonb(%I) from public.properties where id = $1', v_col) into v_now using v_home;
    end if;
    -- Changed again since the CD was applied: leave it, and say so.
    if not public.cd_same_value(coalesce(v_now, 'null'::jsonb), v_item -> 'after') then
      v_skipped := v_skipped || jsonb_build_array(v_item ->> 'label');
    elsif v_table = 'loans' then
      v_loan_set := v_loan_set || jsonb_build_object(v_col, v_item -> 'before');
      v_restored := v_restored + 1;
    else
      v_home_set := v_home_set || jsonb_build_object(v_col, v_item -> 'before');
      v_restored := v_restored + 1;
    end if;
  end loop;

  perform set_config('mps.change_reason', 'Undo final Closing Disclosure', true);
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
  -- The home the CD made the subject: no longer the subject, and removed when the CD added it.
  if v_addr is not null then
    update public.loans set subject_property_id = null where id = v_loan and subject_property_id = (v_addr ->> 'propertyId')::uuid;
    if (v_addr ->> 'createdHome')::boolean then
      begin
        delete from public.properties where id = (v_addr ->> 'propertyId')::uuid;
      exception when others then
        v_skipped := v_skipped || jsonb_build_array('the home it added (kept: other records point to it)');
      end;
    end if;
    v_restored := v_restored + 1;
  end if;
  perform set_config('mps.change_reason', '', true);

  update public.closing_disclosure_readings set undone_at = now() where id = p_reading_id;
  return jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
end;
$$;

revoke all on function public.apply_closing_disclosure(uuid, jsonb) from public, anon;
revoke all on function public.undo_closing_disclosure(uuid) from public, anon;
grant execute on function public.apply_closing_disclosure(uuid, jsonb) to authenticated;
grant execute on function public.undo_closing_disclosure(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ Closing Disclosure fills the home installed' as result,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('apply_closing_disclosure', 'undo_closing_disclosure') and pg_get_functiondef(p.oid) like '%properties.address%') as functions;
