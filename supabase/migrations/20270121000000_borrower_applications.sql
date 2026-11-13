-- MPS HQ: the borrower application (Stage 5, Connor 2026-11-13; plan docs/plans/borrower-application.md).
--
-- borrower_applications: one application, as the borrower typed it (answers
-- jsonb, shape in supabase/functions/apply/form.ts), how far they got, and
-- where it landed. Two ways in:
--   * a standalone link (/apply, for mps.mortgage): progress is kept with a
--     resume code on the borrower's device (only its hash here); on submit the
--     apply Edge Function runs lead intake (intake_web_lead(): matched by
--     email or phone, never by name) and the answers fill the new file's 1003;
--   * a borrower's portal link (Stage 2): the application belongs to that
--     file; the answers wait as a draft until Connor clicks "Add to the 1003".
--   An application that lands on a file that was already open waits for that
--   click too (the outcome says so).
-- apply_application(): fills blanks and adds what's missing on the 1003
-- (person details, addresses, jobs, other income, assets, debts,
-- declarations, the loan's price and amount); it never overwrites or deletes.
-- Credit authorization consent: when, the wording version and a one-way IP
-- code. No Social Security number is ever stored (the Edge Function refuses
-- one). Only the Edge Function (service role) adds or changes applications;
-- people on the file read them and may only attach the saved MISMO file.
-- A new kind of notification, application_submitted, goes to the file's
-- loan officer. document_kind gains mismo_file.
-- Apply after the hot for script. Safe to run more than once. A full run
-- ends with a confirmation row ("MPS HQ borrower applications installed").

alter type public.document_kind add value if not exists 'mismo_file';

create table if not exists public.borrower_applications (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  -- Set on submit for a standalone application; from the start for a portal one.
  loan_id              uuid,
  contact_id           uuid,
  link_id              uuid,
  -- Standalone: sha-256 of the resume code kept on the borrower's device.
  resume_hash          text check (resume_hash is null or resume_hash ~ '^[0-9a-f]{64}$'),
  -- Standalone: the loan officer the link names (?lo=), else the owner.
  assigned_to_email    text,
  answers              jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  step                 text,
  status               text not null default 'in_progress' check (status in ('in_progress', 'submitted')),
  submitted_at         timestamptz,
  -- new_lead | new_loan_existing_person | existing_open_loan (intake's words) | portal
  outcome              text check (outcome is null or outcome in ('new_lead', 'new_loan_existing_person', 'existing_open_loan', 'portal')),
  applied_at           timestamptz,
  applied_by           uuid,
  mismo_document_id    uuid,
  -- When MPS-HQ added the file's suggested conditions after this application (once).
  conditions_added_at  timestamptz,
  credit_auth_at       timestamptz,
  credit_auth_version  text,
  ip_hash              text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint borrower_applications_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint borrower_applications_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint borrower_applications_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id),
  constraint borrower_applications_link_id_fkey
    foreign key (link_id) references public.document_upload_links (id) on delete set null,
  constraint borrower_applications_mismo_document_id_fkey
    foreign key (mismo_document_id) references public.loan_documents (id) on delete set null,
  constraint borrower_applications_applied_by_fkey
    foreign key (applied_by) references public.profiles (id) on delete set null,
  constraint borrower_applications_submitted_check check (status = 'in_progress' or (submitted_at is not null and loan_id is not null and credit_auth_at is not null))
);

alter table public.borrower_applications add column if not exists conditions_added_at timestamptz;

-- The borrower's mortgage payment may already include taxes and insurance (escrowed).
alter table public.property_liens add column if not exists payment_includes_escrow boolean;

create index if not exists borrower_applications_loan_idx on public.borrower_applications (loan_id, created_at desc);
create unique index if not exists borrower_applications_resume_idx on public.borrower_applications (resume_hash) where resume_hash is not null;
-- One application in progress per portal link.
create unique index if not exists borrower_applications_one_open_per_link on public.borrower_applications (link_id) where status = 'in_progress' and link_id is not null;

create or replace trigger borrower_applications_set_updated_at
  before update on public.borrower_applications
  for each row execute function public.set_updated_at();

alter table public.borrower_applications enable row level security;
drop policy if exists "people on the file see applications" on public.borrower_applications;
create policy "people on the file see applications" on public.borrower_applications
  for select to authenticated using (loan_id is not null and public.can_see_loan(loan_id));
drop policy if exists "people on the file attach the MISMO file" on public.borrower_applications;
create policy "people on the file attach the MISMO file" on public.borrower_applications
  for update to authenticated using (loan_id is not null and public.can_see_loan(loan_id)) with check (loan_id is not null and public.can_see_loan(loan_id));
revoke insert, delete on public.borrower_applications from anon, authenticated;

-- In the app only the saved MISMO file can be attached; the rest comes from the borrower or apply_application().
create or replace function public.guard_borrower_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and current_setting('mps.applying', true) is distinct from 'on' and (
    (new.organization_id, new.loan_id, new.contact_id, new.link_id, new.resume_hash, new.answers, new.status, new.submitted_at, new.outcome, new.applied_at, new.applied_by, new.credit_auth_at, new.credit_auth_version)
    is distinct from
    (old.organization_id, old.loan_id, old.contact_id, old.link_id, old.resume_hash, old.answers, old.status, old.submitted_at, old.outcome, old.applied_at, old.applied_by, old.credit_auth_at, old.credit_auth_version)
  ) then
    raise exception 'An application can''t be edited in MPS HQ. Use Add to the 1003, then edit the 1003.';
  end if;
  return new;
end;
$$;

drop trigger if exists borrower_applications_guard on public.borrower_applications;
create trigger borrower_applications_guard before update on public.borrower_applications
  for each row execute function public.guard_borrower_application();

-- ---------------------------------------------------------------------------
-- The answers into the 1003: fill blanks, add what's missing, never overwrite.
-- ---------------------------------------------------------------------------

create or replace function public.application_person_into(p_org uuid, p_contact uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contacts c set
    date_of_birth = coalesce(c.date_of_birth, nullif(p->>'dateOfBirth', '')::date),
    citizenship = coalesce(c.citizenship, nullif(p->>'citizenship', '')::public.citizenship),
    marital_status = coalesce(c.marital_status, nullif(p->>'maritalStatus', '')::public.marital_status),
    dependents_count = coalesce(c.dependents_count, nullif(p->>'dependents', '')::smallint),
    military_service = coalesce(c.military_service, nullif(p->>'military', '')::boolean),
    email = coalesce(c.email, nullif(lower(trim(p->>'email')), '')),
    phone = coalesce(c.phone, nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), ''))
  where c.id = p_contact and c.organization_id = p_org;
end;
$$;

create or replace function public.application_jobs_into(p_org uuid, p_contact uuid, p_jobs jsonb, p_other jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  j jsonb;
  n integer := 0;
  v_kind text;
  v_se boolean;
  v_current boolean;
  v_income numeric;
begin
  for j in select * from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) loop
    -- Answers from before job types were W-2 or self-employed; school isn't employment (it only explains the dates).
    v_kind := coalesce(nullif(j->>'kind', ''), case when coalesce((j->>'selfEmployed')::boolean, false) then 'self_employed' else 'w2' end);
    continue when v_kind = 'school';
    continue when coalesce(trim(j->>'employer'), '') = '';
    continue when exists (select 1 from public.employments e where e.contact_id = p_contact and lower(trim(e.employer_name)) = lower(trim(j->>'employer')));
    v_se := v_kind in ('1099', 'self_employed');
    v_current := coalesce((j->>'current')::boolean, true);
    -- monthlyIncome is worked out by the apply function: W-2 base pay, or the 1099 / business net a month.
    v_income := nullif(j->>'monthlyIncome', '')::numeric;
    insert into public.employments (organization_id, contact_id, status, employer_name, position_title, start_date, end_date, is_self_employed, ownership_25_or_more,
      base_income, overtime_income, bonus_income, commission_income, self_employed_income, sort_order)
    values (p_org, p_contact, case when v_current then 'current' else 'previous' end::public.employment_status, left(trim(j->>'employer'), 200), nullif(left(trim(coalesce(j->>'title', '')), 120), ''),
      nullif(j->>'startDate', '')::date, case when v_current then null else nullif(j->>'endDate', '')::date end, v_se,
      case when v_kind = 'self_employed' and nullif(j->>'ownershipPct', '') is not null then (j->>'ownershipPct')::numeric >= 25 end,
      case when not v_se and v_income >= 0 then v_income end,
      case when not v_se and nullif(j->>'overtimeYearly', '')::numeric > 0 then round((j->>'overtimeYearly')::numeric / 12, 2) end,
      case when not v_se and nullif(j->>'bonusYearly', '')::numeric > 0 then round((j->>'bonusYearly')::numeric / 12, 2) end,
      case when not v_se and nullif(j->>'commissionYearly', '')::numeric > 0 then round((j->>'commissionYearly')::numeric / 12, 2) end,
      case when v_se then v_income end, 100);
    n := n + 1;
  end loop;
  for j in select * from jsonb_array_elements(coalesce(p_other, '[]'::jsonb)) loop
    continue when nullif(j->>'monthly', '') is null;
    continue when exists (select 1 from public.other_incomes o where o.contact_id = p_contact and o.income_type::text = j->>'kind');
    insert into public.other_incomes (organization_id, contact_id, income_type, monthly_amount)
    values (p_org, p_contact, (j->>'kind')::public.other_income_type, (j->>'monthly')::numeric);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.application_declarations_into(p_loan uuid, p_contact uuid, d jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
begin
  insert into public.borrower_declarations (loan_id, contact_id) values (p_loan, p_contact) on conflict (loan_id, contact_id) do nothing;
  update public.borrower_declarations x set
    will_occupy_as_primary = coalesce(x.will_occupy_as_primary, (d->>'willOccupyAsPrimary')::boolean),
    owned_property_past_3_years = coalesce(x.owned_property_past_3_years, (d->>'ownedPropertyPast3Years')::boolean),
    outstanding_judgments = coalesce(x.outstanding_judgments, (d->>'outstandingJudgments')::boolean),
    delinquent_federal_debt = coalesce(x.delinquent_federal_debt, (d->>'delinquentFederalDebt')::boolean),
    party_to_lawsuit = coalesce(x.party_to_lawsuit, (d->>'partyToLawsuit')::boolean),
    bankruptcy_past_7_years = coalesce(x.bankruptcy_past_7_years, (d->>'bankruptcyPast7Years')::boolean),
    foreclosure_past_7_years = coalesce(x.foreclosure_past_7_years, (d->>'foreclosurePast7Years')::boolean),
    short_sale_past_7_years = coalesce(x.short_sale_past_7_years, (d->>'shortSalePast7Years')::boolean),
    cosigner_or_guarantor = coalesce(x.cosigner_or_guarantor, (d->>'cosignerOrGuarantor')::boolean),
    borrowing_undisclosed_money = coalesce(x.borrowing_undisclosed_money, (d->>'borrowingUndisclosedMoney')::boolean),
    application_method = coalesce(x.application_method, 'email_or_internet')
  where x.loan_id = p_loan and x.contact_id = p_contact;
end;
$$;

-- One home they own into the file's real estate (the 1003's REO): value, taxes,
-- insurance, HOA, rent, use and plan, plus its 1st mortgage. Skipped when the
-- file already has a home at that address. Returns the property id (or null).
create or replace function public.application_home_into(p_org uuid, p_loan uuid, h jsonb, p_status text, p_occupancy text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_escrow boolean := coalesce((h->>'hasMortgage')::boolean, false) and coalesce((h->>'paymentIncludesEscrow')::boolean, false);
begin
  if coalesce(trim(h->>'line'), '') = '' then return null; end if;
  if exists (select 1 from public.properties where loan_id = p_loan and lower(trim(address_line)) = lower(trim(h->>'line'))) then return null; end if;
  insert into public.properties (organization_id, loan_id, address_line, city, state, zip, status, estimated_value, annual_taxes, annual_insurance, monthly_hoa, monthly_rent,
    reo_occupancy, reo_disposition, created_by)
  values (p_org, p_loan, left(trim(h->>'line'), 200), nullif(trim(h->>'city'), ''), upper(coalesce(nullif(trim(h->>'state'), ''), 'TX')), nullif(trim(h->>'zip'), ''),
    p_status::public.property_status, nullif(h->>'value', '')::numeric,
    case when not v_escrow then nullif(h->>'annualTaxes', '')::numeric end, case when not v_escrow then nullif(h->>'annualInsurance', '')::numeric end,
    nullif(h->>'monthlyHoa', '')::numeric, case when p_occupancy = 'investment' then nullif(h->>'monthlyRent', '')::numeric end,
    p_occupancy::public.occupancy, case when coalesce((h->>'selling')::boolean, false) then 'pending_sale' else 'retain' end::public.reo_disposition, null)
  returning id into v_id;
  if coalesce((h->>'hasMortgage')::boolean, false) then
    insert into public.property_liens (organization_id, property_id, position, balance, monthly_payment, payment_includes_escrow)
    values (p_org, v_id, 'first', nullif(h->>'mortgageBalance', '')::numeric, nullif(h->>'mortgagePayment', '')::numeric, v_escrow);
  end if;
  return v_id;
end;
$$;

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

  -- The loan: blanks only; the purpose never changes. Occupancy only on a file the application made.
  v_price := nullif(v->'loan'->>'price', '')::numeric;
  v_down := case when v->'loan'->>'downMode' = 'percent' then round(v_price * nullif(v->'loan'->>'down', '')::numeric / 100, 2) else nullif(v->'loan'->>'down', '')::numeric end;
  update public.loans l set
    purchase_price = case when l.purpose = 'purchase' then coalesce(l.purchase_price, v_price) else l.purchase_price end,
    loan_amount = coalesce(l.loan_amount, case
      when l.purpose = 'purchase' and v_price is not null and v_down is not null and v_down < v_price then v_price - v_down
      when l.purpose <> 'purchase' then nullif(v->'loan'->>'balance', '')::numeric + coalesce(nullif(v->'loan'->>'cashOut', '')::numeric, 0)
    end),
    cash_out_amount = coalesce(l.cash_out_amount, case when l.purpose = 'refinance_cash_out' then nullif(v->'loan'->>'cashOut', '')::numeric end),
    occupancy = case when a.outcome in ('new_lead', 'new_loan_existing_person') and nullif(v->'loan'->>'occupancy', '') is not null then (v->'loan'->>'occupancy')::public.occupancy else l.occupancy end,
    timeline = coalesce(l.timeline, nullif(left(coalesce(v->'loan'->>'timeline', ''), 200), ''))
  where l.id = a.loan_id;
  update public.loan_borrowers set estimated_credit_score = coalesce(estimated_credit_score, nullif(v->'loan'->>'creditScore', '')::smallint)
  where loan_id = a.loan_id and contact_id = a.contact_id;

  -- The home they live in, when they own it: on the file as the current home with its mortgage.
  -- A refinance of it (primary) makes it the subject property when the file has none; the loan step's value and balance fill its blanks.
  if v->'address'->>'housing' = 'own' and coalesce(trim(v->'address'->>'line'), '') <> '' then
    x := coalesce(v->'address'->'owned', '{}'::jsonb) || jsonb_build_object('line', v->'address'->>'line', 'city', v->'address'->>'city', 'state', v->'address'->>'state', 'zip', v->'address'->>'zip');
    if v_loan.purpose in ('refinance_rate_term', 'refinance_cash_out') and coalesce(v->'loan'->>'occupancy', 'primary') = 'primary' then
      if nullif(x->>'value', '') is null then x := x || jsonb_build_object('value', v_price); end if;
      if nullif(v->'loan'->>'balance', '')::numeric > 0 and nullif(x->>'mortgageBalance', '') is null then
        x := x || jsonb_build_object('hasMortgage', true, 'mortgageBalance', (v->'loan'->>'balance')::numeric);
      end if;
    end if;
    v_property := public.application_home_into(a.organization_id, a.loan_id, x, 'current_home', 'primary');
    if v_property is not null then
      n_homes := n_homes + 1;
      if v_loan.purpose in ('refinance_rate_term', 'refinance_cash_out') and v_loan.subject_property_id is null and coalesce(v->'loan'->>'occupancy', 'primary') = 'primary' then
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

revoke all on function public.application_person_into(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.application_jobs_into(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.application_declarations_into(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.application_home_into(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.apply_application(uuid) from public, anon;
grant execute on function public.apply_application(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notification: a submitted application tells the file's loan officer.
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('reply', 'needs_matching', 'send_failed', 'opted_out', 'scheduled_sent', 'scheduled_stopped', 'test', 'page_submission', 'estimate_picked', 'portal_request', 'portal_upload', 'application_submitted'));

create or replace function public.borrower_application_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lo uuid;
  v_name text;
begin
  if new.status <> 'submitted' or old.status = 'submitted' then
    return new;
  end if;
  select assigned_lo_id into v_lo from public.loans where id = new.loan_id;
  v_name := trim(coalesce(new.answers->'borrower'->>'firstName', '') || ' ' || coalesce(new.answers->'borrower'->>'lastName', ''));
  insert into public.notes (organization_id, contact_id, loan_id, kind, body)
  values (new.organization_id, new.contact_id, new.loan_id, 'note',
    coalesce(nullif(v_name, ''), 'The borrower') || ' submitted an application' ||
    case new.outcome
      when 'existing_open_loan' then ' (matched to this open file by email or phone: review it and click Add to the 1003).'
      when 'portal' then ' from their portal (review it and click Add to the 1003).'
      when 'new_loan_existing_person' then ' (a past client: a new file was started).'
      else '.' end);
  perform public.notify_user(new.organization_id, v_lo, 'application_submitted', 'New application: ' || coalesce(nullif(v_name, ''), 'a borrower'),
    case when new.outcome in ('existing_open_loan', 'portal') then 'Review it and add it to the 1003' else 'Added to the 1003' end,
    '/loans/' || new.loan_id::text, new.id);
  return new;
end;
$$;

revoke all on function public.borrower_application_submitted() from public, anon, authenticated;
drop trigger if exists borrower_applications_submitted on public.borrower_applications;
create trigger borrower_applications_submitted after update of status on public.borrower_applications
  for each row execute function public.borrower_application_submitted();

-- ---------------------------------------------------------------------------
-- The MISMO file saved from an application is XML: let the private
-- "loan-files" bucket take it (it took only PDFs and photos).
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = allowed_mime_types || array['application/xml']
     where id = 'loan-files'
       and allowed_mime_types is not null
       and not ('application/xml' = any (allowed_mime_types));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ borrower applications installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'borrower_applications') as application_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'borrower_applications') as policies,
  (select count(*) from pg_trigger where tgname in ('borrower_applications_guard', 'borrower_applications_submitted')) as triggers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('apply_application', 'application_person_into', 'application_jobs_into', 'application_declarations_into', 'application_home_into')) as functions,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel = 'mismo_file') as mismo_kind,
  (select count(*) from storage.buckets where id = 'loan-files' and (allowed_mime_types is null or 'application/xml' = any (allowed_mime_types))) as xml_allowed;
