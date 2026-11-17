-- MPS HQ: the application works out the loan type (Connor, 2026-11-16).
--
-- The borrower application now asks first what they want to do: buy, lower
-- the rate (Rate/Term), cash out with a new mortgage (Cash-Out), borrow
-- against the home and keep the mortgage (HELOC or HELOAN), or "not sure"
-- (a few yes/no questions pick it), plus how they will use the home and, for
-- an investment home, whether they qualify by its rent (DSCR). Lead intake
-- already gives a file the application makes that loan type. This script
-- redefines apply_application() (from 20270121000000_borrower_applications)
-- so the 1003 follows it:
--   * HELOC / HELOAN: the loan amount is what they want to borrow (not the
--     balance plus cash out); the home they live in becomes the subject and
--     its mortgage stays as the 1st lien, as on a refinance.
--   * DSCR: income documentation becomes DSCR on a file the application made
--     when the file has none yet.
-- The file's loan type is never changed here: on a file that was already
-- open, a different pick shows on the Application card for the loan officer.
-- No table changes. Safe to re-run; ends with a confirmation row
-- ("MPS HQ application loan type installed").

create or replace function public.apply_application(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_applications;
  v jsonb;
  v_loan public.loans;
  v_co uuid;
  v_email text;
  v_phone text;
  v_owner uuid;
  x jsonb;
  n_jobs integer := 0;
  n_assets integer := 0;
  n_debts integer := 0;
  n_homes integer := 0;
  v_months smallint;
  v_price numeric;
  v_down numeric;
  v_property uuid;
begin
  select * into a from public.borrower_applications where id = p_id;
  if a.id is null or a.status <> 'submitted' or a.loan_id is null or a.contact_id is null then
    raise exception 'This application has not been submitted yet.';
  end if;
  -- Connor's click runs as him: he must be able to see the file. The Edge Function runs as the service role.
  if auth.uid() is not null and not public.can_see_loan(a.loan_id) then
    raise exception 'You can''t see this file.';
  end if;
  v := a.answers;
  select * into v_loan from public.loans where id = a.loan_id;

  -- The borrower.
  perform public.application_person_into(a.organization_id, a.contact_id, v->'borrower');

  -- The co-borrower: matched by email or 10-digit phone in the company, else added; joined to the file.
  if coalesce((v->>'hasCoBorrower')::boolean, false) then
    v_email := nullif(lower(trim(v->'coBorrower'->>'email')), '');
    v_phone := nullif(right(regexp_replace(coalesce(v->'coBorrower'->>'phone', ''), '\D', '', 'g'), 10), '');
    select c.id into v_co from public.contacts c
    where c.organization_id = a.organization_id and c.id <> a.contact_id
      and ((v_email is not null and lower(c.email) = v_email) or (v_phone is not null and right(c.phone_digits, 10) = v_phone))
    order by c.updated_at desc limit 1;
    if v_co is null then
      insert into public.contacts (organization_id, first_name, last_name, email, phone)
      values (a.organization_id, left(coalesce(nullif(trim(v->'coBorrower'->>'firstName'), ''), 'Co-borrower'), 100), left(coalesce(trim(v->'coBorrower'->>'lastName'), ''), 100), v_email, v_phone)
      returning id into v_co;
    end if;
    insert into public.loan_borrowers (loan_id, contact_id, organization_id, role) values (a.loan_id, v_co, a.organization_id, 'co_borrower')
    on conflict do nothing;
    perform public.application_person_into(a.organization_id, v_co, v->'coBorrower');
  end if;

  -- Addresses: the current one if there's none yet, the previous one if it isn't there.
  x := v->'address';
  if coalesce(trim(x->>'line'), '') <> '' then
    v_months := (coalesce(nullif(x->>'years', '')::int, 0) * 12 + coalesce(nullif(x->>'months', '')::int, 0))::smallint;
    if not exists (select 1 from public.contact_addresses where contact_id = a.contact_id and kind = 'current') then
      insert into public.contact_addresses (organization_id, contact_id, kind, address_line, unit, city, state, zip, housing, monthly_rent, months_at_address)
      values (a.organization_id, a.contact_id, 'current', left(trim(x->>'line'), 200), nullif(trim(x->>'unit'), ''), nullif(trim(x->>'city'), ''), nullif(upper(trim(x->>'state')), ''), nullif(trim(x->>'zip'), ''),
        nullif(x->>'housing', '')::public.housing_kind, nullif(x->>'monthlyRent', '')::numeric, v_months);
    end if;
    if v_co is not null and coalesce((v->>'coSameAddress')::boolean, true) and not exists (select 1 from public.contact_addresses where contact_id = v_co and kind = 'current') then
      insert into public.contact_addresses (organization_id, contact_id, kind, address_line, unit, city, state, zip, housing, monthly_rent, months_at_address)
      values (a.organization_id, v_co, 'current', left(trim(x->>'line'), 200), nullif(trim(x->>'unit'), ''), nullif(trim(x->>'city'), ''), nullif(upper(trim(x->>'state')), ''), nullif(trim(x->>'zip'), ''),
        nullif(x->>'housing', '')::public.housing_kind, nullif(x->>'monthlyRent', '')::numeric, v_months);
    end if;
  end if;
  x := v->'previousAddress';
  if coalesce(trim(x->>'line'), '') <> '' and not exists (select 1 from public.contact_addresses where contact_id = a.contact_id and lower(trim(address_line)) = lower(trim(x->>'line'))) then
    insert into public.contact_addresses (organization_id, contact_id, kind, address_line, unit, city, state, zip)
    values (a.organization_id, a.contact_id, 'former', left(trim(x->>'line'), 200), nullif(trim(x->>'unit'), ''), nullif(trim(x->>'city'), ''), nullif(upper(trim(x->>'state')), ''), nullif(trim(x->>'zip'), ''));
  end if;

  -- Jobs and other income.
  n_jobs := public.application_jobs_into(a.organization_id, a.contact_id, v->'jobs', v->'otherIncome');
  if v_co is not null then
    n_jobs := n_jobs + public.application_jobs_into(a.organization_id, v_co, v->'coJobs', v->'coOtherIncome');
  end if;

  -- Assets and debts (on the loan, for their owner).
  for x in select * from jsonb_array_elements(coalesce(v->'assets', '[]'::jsonb)) loop
    v_owner := case when x->>'owner' = 'co' and v_co is not null then v_co else a.contact_id end;
    continue when nullif(x->>'amount', '') is null;
    continue when exists (select 1 from public.assets s where s.loan_id = a.loan_id and s.contact_id = v_owner and s.asset_type::text = x->>'kind'
      and lower(coalesce(s.institution_name, '')) = lower(coalesce(trim(x->>'institution'), '')));
    insert into public.assets (loan_id, contact_id, asset_type, institution_name, account_last4, amount)
    values (a.loan_id, v_owner, (x->>'kind')::public.asset_type, nullif(left(trim(coalesce(x->>'institution', '')), 120), ''),
      case when coalesce(x->>'last4', '') ~ '^[0-9]{4}$' then x->>'last4' end, (x->>'amount')::numeric);
    n_assets := n_assets + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(v->'debts', '[]'::jsonb)) loop
    v_owner := case when x->>'owner' = 'co' and v_co is not null then v_co else a.contact_id end;
    continue when nullif(x->>'monthlyPayment', '') is null;
    continue when exists (select 1 from public.liabilities l where l.loan_id = a.loan_id and l.contact_id = v_owner and l.liability_type::text = x->>'kind'
      and lower(coalesce(l.creditor_name, '')) = lower(coalesce(trim(x->>'creditor'), '')));
    insert into public.liabilities (loan_id, contact_id, liability_type, creditor_name, unpaid_balance, monthly_payment)
    values (a.loan_id, v_owner, (x->>'kind')::public.liability_type, nullif(left(trim(coalesce(x->>'creditor', '')), 120), ''), nullif(x->>'balance', '')::numeric, (x->>'monthlyPayment')::numeric);
    n_debts := n_debts + 1;
  end loop;

  -- Declarations.
  perform public.application_declarations_into(a.loan_id, a.contact_id, coalesce(v->'declarations', '{}'::jsonb));
  if v_co is not null then
    perform public.application_declarations_into(a.loan_id, v_co, coalesce(v->'coDeclarations', '{}'::jsonb));
  end if;

  -- The loan: blanks only; the purpose never changes (a file the application made already has the borrower's pick from lead intake).
  -- Occupancy, and DSCR when they qualify by the rent, only on a file the application made. HELOC / HELOAN: the amount is what they want to borrow.
  v_price := nullif(v->'loan'->>'price', '')::numeric;
  v_down := case when v->'loan'->>'downMode' = 'percent' then round(v_price * nullif(v->'loan'->>'down', '')::numeric / 100, 2) else nullif(v->'loan'->>'down', '')::numeric end;
  update public.loans l set
    purchase_price = case when l.purpose = 'purchase' then coalesce(l.purchase_price, v_price) else l.purchase_price end,
    loan_amount = coalesce(l.loan_amount, case
      when l.purpose = 'purchase' and v_price is not null and v_down is not null and v_down < v_price then v_price - v_down
      when l.purpose in ('heloc', 'heloan') then nullif(v->'loan'->>'cashOut', '')::numeric
      when l.purpose <> 'purchase' then nullif(v->'loan'->>'balance', '')::numeric + coalesce(nullif(v->'loan'->>'cashOut', '')::numeric, 0)
    end),
    cash_out_amount = coalesce(l.cash_out_amount, case when l.purpose = 'refinance_cash_out' then nullif(v->'loan'->>'cashOut', '')::numeric end),
    occupancy = case when a.outcome in ('new_lead', 'new_loan_existing_person') and nullif(v->'loan'->>'occupancy', '') is not null then (v->'loan'->>'occupancy')::public.occupancy else l.occupancy end,
    income_doc_type = case
      when l.income_doc_type is null and a.outcome in ('new_lead', 'new_loan_existing_person') and v->'loan'->>'occupancy' = 'investment'
        and coalesce((nullif(v->'loan'->>'qualifyByRent', ''))::boolean, false) then 'dscr'::public.income_doc_type
      else l.income_doc_type end,
    timeline = coalesce(l.timeline, nullif(left(coalesce(v->'loan'->>'timeline', ''), 200), ''))
  where l.id = a.loan_id;
  update public.loan_borrowers set estimated_credit_score = coalesce(estimated_credit_score, nullif(v->'loan'->>'creditScore', '')::smallint)
  where loan_id = a.loan_id and contact_id = a.contact_id;

  -- The home they live in, when they own it: on the file as the current home with its mortgage.
  -- A refinance, HELOC or HELOAN of it (primary) makes it the subject property when the file has none; the loan step's value and balance fill its blanks.
  if v->'address'->>'housing' = 'own' and coalesce(trim(v->'address'->>'line'), '') <> '' then
    x := coalesce(v->'address'->'owned', '{}'::jsonb) || jsonb_build_object('line', v->'address'->>'line', 'city', v->'address'->>'city', 'state', v->'address'->>'state', 'zip', v->'address'->>'zip');
    if v_loan.purpose in ('refinance_rate_term', 'refinance_cash_out', 'heloc', 'heloan') and coalesce(v->'loan'->>'occupancy', 'primary') = 'primary' then
      if nullif(x->>'value', '') is null then x := x || jsonb_build_object('value', v_price); end if;
      if nullif(v->'loan'->>'balance', '')::numeric > 0 and nullif(x->>'mortgageBalance', '') is null then
        x := x || jsonb_build_object('hasMortgage', true, 'mortgageBalance', (v->'loan'->>'balance')::numeric);
      end if;
    end if;
    v_property := public.application_home_into(a.organization_id, a.loan_id, x, 'current_home', 'primary');
    if v_property is not null then
      n_homes := n_homes + 1;
      if v_loan.purpose in ('refinance_rate_term', 'refinance_cash_out', 'heloc', 'heloan') and v_loan.subject_property_id is null and coalesce(v->'loan'->>'occupancy', 'primary') = 'primary' then
        update public.loans set subject_property_id = v_property where id = a.loan_id;
      end if;
    end if;
  end if;

  -- Every other home they own (second homes and rentals).
  if coalesce((v->>'ownsOtherHomes')::boolean, false) then
    for x in select * from jsonb_array_elements(coalesce(v->'otherHomes', '[]'::jsonb)) loop
      if public.application_home_into(a.organization_id, a.loan_id, x, 'owned', case when x->>'use' = 'second_home' then 'second_home' else 'investment' end) is not null then
        n_homes := n_homes + 1;
      end if;
    end loop;
  end if;

  perform set_config('mps.applying', 'on', true);
  update public.borrower_applications set applied_at = now(), applied_by = auth.uid() where id = a.id;
  perform set_config('mps.applying', '', true);
  return jsonb_build_object('jobs_and_income', n_jobs, 'assets', n_assets, 'debts', n_debts, 'homes', n_homes, 'co_borrower', v_co is not null);
end;
$$;

revoke all on function public.apply_application(uuid) from public, anon;
grant execute on function public.apply_application(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ application loan type installed' as result,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_application' and pg_get_functiondef(p.oid) like '%heloan%') as functions;
