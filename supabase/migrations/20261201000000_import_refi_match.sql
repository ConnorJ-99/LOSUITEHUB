-- LOSuite: the closed-clients import keeps each closing its own loan
-- (Connor, 2026-10-29: "some borrowers buy multiple houses or refi").
--
-- import_clients() looks for the matched person's closed loan before adding
-- one. It used to take a closed loan with the same closing date OR the same
-- property address, so a refi of a home already in LOSuite was folded into
-- the purchase loan (only its blanks were filled). Now:
--   - same closing date → the same loan (importing a file twice);
--   - same property address → the same loan only when one of the two closing
--     dates is blank;
--   - same address, both dates filled in and different → a new closed loan
--     for the same person (a refi).
-- Everything else in the import is unchanged.
--
-- Apply to the DEV Supabase project only, after the team settings script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite import refi match installed").

create or replace function public.import_clients(p_org uuid, p_rows jsonb, p_save boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role        public.org_role;
  v_me_email    text;
  v_results     jsonb := '[]'::jsonb;
  r             jsonb;
  v_lo          uuid;
  v_contact     uuid;
  v_co          uuid;
  v_loan        uuid;
  v_loan_lo     uuid;
  v_prop        uuid;
  v_matched_by  text;
  v_person      text;
  v_status      text;
  v_message     text;
  v_before      jsonb;
  v_after       jsonb;
  v_closed      boolean;
  v_stage       public.pipeline_stage;
  v_addr        text;
begin
  select m.role into v_role from public.organization_members m
  where m.organization_id = p_org and m.user_id = auth.uid();
  if v_role is null or v_role = 'processor' then
    raise exception 'Only loan officers, owners and admins can import clients.';
  end if;
  select lower(p.email) into v_me_email from public.profiles p where p.id = auth.uid();

  begin
    for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
      begin
        v_contact := null; v_co := null; v_loan := null; v_loan_lo := null; v_prop := null;
        v_matched_by := null; v_person := 'new'; v_status := null; v_message := null; v_before := null;
        v_stage := (r->>'stage')::public.pipeline_stage;
        v_closed := v_stage = 'closed';
        v_addr := nullif(lower(trim(coalesce(r#>>'{property,address}', ''))), '');

        -- Loan officer: a user in this company, by email.
        select p.id into v_lo from public.profiles p
        join public.organization_members m on m.user_id = p.id and m.organization_id = p_org
        where lower(p.email) = lower(trim(r->>'lo_email'));
        if v_lo is null then
          v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'error',
            'message', format('%s isn''t a LOSuite user in this company.', r->>'lo_email'));
          continue;
        end if;
        if v_role = 'loan_officer' and lower(trim(r->>'lo_email')) <> v_me_email then
          v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'error',
            'message', 'Loan officers can only import their own clients.');
          continue;
        end if;

        -- 1. The old site's record ID.
        if nullif(trim(coalesce(r->>'old_site_id', '')), '') is not null then
          select l.id, l.assigned_lo_id into v_loan, v_loan_lo from public.loans l
          where l.organization_id = p_org and l.import_key = trim(r->>'old_site_id');
          if v_loan is not null then
            v_matched_by := 'old site ID';
            select lb.contact_id into v_contact from public.loan_borrowers lb
            where lb.loan_id = v_loan and lb.role = 'primary';
          end if;
        end if;

        -- 2-3. Email, then phone.
        if v_contact is null then
          v_contact := public.import_find_contact(p_org, nullif(lower(trim(coalesce(r->>'email', ''))), ''), nullif(r->>'phone', ''));
          if v_contact is not null then
            v_matched_by := case when exists (select 1 from public.contacts c where c.id = v_contact and lower(c.email) = lower(r->>'email')) then 'email' else 'phone' end;
          end if;
        end if;

        -- 4. Closed rows: same name and property address.
        if v_contact is null and v_closed and v_addr is not null then
          select c.id into v_contact from public.contacts c
          join public.loan_borrowers lb on lb.contact_id = c.id
          join public.properties pr on pr.loan_id = lb.loan_id
          where c.organization_id = p_org
            and lower(trim(c.first_name)) = lower(trim(r->>'first_name'))
            and lower(trim(c.last_name)) = lower(trim(coalesce(r->>'last_name', '')))
            and lower(trim(pr.address_line)) = v_addr
          order by c.created_at limit 1;
          if v_contact is not null then v_matched_by := 'name and property address'; end if;
        end if;

        if v_contact is not null then v_person := 'matched'; end if;

        -- Their file: for a closed row, a closed loan with the same closing
        -- date, or at the same property when either closing date is blank (a
        -- refi of the same home has its own date, so it's its own loan);
        -- otherwise their latest file that isn't closed.
        if v_loan is null and v_contact is not null then
          if v_closed then
            select l.id, l.assigned_lo_id into v_loan, v_loan_lo from public.loans l
            join public.loan_borrowers lb on lb.loan_id = l.id and lb.contact_id = v_contact
            where l.stage = 'closed'
              and (l.import_key is null or r->>'old_site_id' is null or l.import_key = trim(r->>'old_site_id'))
              and (l.closing_date = (r->>'closing_date')::date
                or ((l.closing_date is null or r->>'closing_date' is null)
                  and v_addr is not null and exists (select 1 from public.properties pr where pr.loan_id = l.id and lower(trim(pr.address_line)) = v_addr)))
            order by (l.closing_date = (r->>'closing_date')::date) desc nulls last, l.closing_date desc nulls last limit 1;
          else
            select l.id, l.assigned_lo_id into v_loan, v_loan_lo from public.loans l
            join public.loan_borrowers lb on lb.loan_id = l.id and lb.contact_id = v_contact
            where l.stage <> 'closed'
              and (l.import_key is null or r->>'old_site_id' is null or l.import_key = trim(r->>'old_site_id'))
            order by (l.stage = 'lost'), l.created_at desc limit 1;
          end if;
        end if;

        if v_loan is not null and v_loan_lo is not null and v_loan_lo <> v_lo then
          v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'skipped', 'person', v_person,
            'matched_by', v_matched_by, 'message', 'This file belongs to another loan officer. Nothing was changed.');
          continue;
        end if;

        -- The person: add them, or fill in what's blank.
        if v_contact is null then
          insert into public.contacts (organization_id, first_name, last_name, email, phone, date_of_birth, sms_consent, email_consent)
          values (p_org, trim(r->>'first_name'), coalesce(trim(r->>'last_name'), ''), nullif(lower(trim(coalesce(r->>'email', ''))), ''),
            nullif(r->>'phone', ''), (r->>'birthday')::date, (r->>'sms_ok')::boolean, (r->>'email_ok')::boolean)
          returning id into v_contact;
        else
          v_before := (select to_jsonb(c) - 'updated_at' from public.contacts c where c.id = v_contact);
          update public.contacts c set
            email = coalesce(c.email, nullif(lower(trim(coalesce(r->>'email', ''))), '')),
            phone = coalesce(c.phone, nullif(r->>'phone', '')),
            date_of_birth = coalesce(c.date_of_birth, (r->>'birthday')::date),
            sms_consent = coalesce(c.sms_consent, (r->>'sms_ok')::boolean),
            email_consent = coalesce(c.email_consent, (r->>'email_ok')::boolean)
          where c.id = v_contact;
          if v_before <> (select to_jsonb(c) - 'updated_at' from public.contacts c where c.id = v_contact) then v_status := 'updated'; end if;
        end if;

        if nullif(trim(coalesce(r#>>'{mailing,address}', '')), '') is not null
          and not exists (select 1 from public.contact_addresses a where a.contact_id = v_contact and a.kind = 'mailing') then
          insert into public.contact_addresses (organization_id, contact_id, kind, address_line, city, state, zip)
          values (p_org, v_contact, 'mailing', trim(r#>>'{mailing,address}'), nullif(r#>>'{mailing,city}', ''),
            nullif(upper(r#>>'{mailing,state}'), ''), nullif(r#>>'{mailing,zip}', ''));
          v_status := coalesce(v_status, 'updated');
        end if;

        -- The file: add it, or fill in what's blank. The stage never moves.
        if v_loan is null then
          insert into public.loans (organization_id, purpose, stage, lost_reason, referral_source, assigned_lo_id, prior_loan_id,
            occupancy, purchase_price, loan_amount, note_rate, term_months, closing_date, first_payment_date, mortgage_type,
            arive_loan_number, lender_name, program_name, monthly_payment, import_key, stage_changed_at)
          values (p_org, coalesce((r->>'purpose')::public.loan_purpose, 'purchase'), v_stage, nullif(r->>'lost_reason', ''),
            nullif(r->>'referral_source', ''), v_lo,
            case when not v_closed then (select l.id from public.loans l join public.loan_borrowers lb on lb.loan_id = l.id
              where lb.contact_id = v_contact and l.stage = 'closed' order by l.closing_date desc nulls last limit 1) end,
            coalesce((r#>>'{property,occupancy}')::public.occupancy, 'primary'), (r->>'purchase_price')::numeric, (r->>'loan_amount')::numeric,
            (r->>'rate')::numeric, (r->>'term_months')::smallint, (r->>'closing_date')::date, (r->>'first_payment_date')::date,
            (r->>'loan_type')::public.mortgage_type, nullif(r->>'arive_loan_number', ''), nullif(r->>'lender', ''), nullif(r->>'program', ''),
            (r->>'monthly_payment')::numeric, nullif(trim(coalesce(r->>'old_site_id', '')), ''),
            case when v_closed and r->>'closing_date' is not null then (r->>'closing_date')::date::timestamptz else now() end)
          returning id into v_loan;
          insert into public.loan_borrowers (loan_id, contact_id, organization_id, role) values (v_loan, v_contact, p_org, 'primary');
          v_status := 'added';
        else
          v_before := (select to_jsonb(l) - 'updated_at' from public.loans l where l.id = v_loan);
          update public.loans l set
            assigned_lo_id = coalesce(l.assigned_lo_id, v_lo),
            referral_source = coalesce(l.referral_source, nullif(r->>'referral_source', '')),
            purchase_price = coalesce(l.purchase_price, (r->>'purchase_price')::numeric),
            loan_amount = coalesce(l.loan_amount, (r->>'loan_amount')::numeric),
            note_rate = coalesce(l.note_rate, (r->>'rate')::numeric),
            term_months = coalesce(l.term_months, (r->>'term_months')::smallint),
            closing_date = coalesce(l.closing_date, (r->>'closing_date')::date),
            first_payment_date = coalesce(l.first_payment_date, (r->>'first_payment_date')::date),
            mortgage_type = coalesce(l.mortgage_type, (r->>'loan_type')::public.mortgage_type),
            arive_loan_number = coalesce(l.arive_loan_number, nullif(r->>'arive_loan_number', '')),
            lender_name = coalesce(l.lender_name, nullif(r->>'lender', '')),
            program_name = coalesce(l.program_name, nullif(r->>'program', '')),
            monthly_payment = coalesce(l.monthly_payment, (r->>'monthly_payment')::numeric),
            import_key = coalesce(l.import_key, nullif(trim(coalesce(r->>'old_site_id', '')), ''))
          where l.id = v_loan;
          if v_before <> (select to_jsonb(l) - 'updated_at' from public.loans l where l.id = v_loan) then v_status := 'updated'; end if;
        end if;

        -- The home.
        if v_addr is not null then
          select pr.id into v_prop from public.properties pr where pr.loan_id = v_loan and lower(trim(pr.address_line)) = v_addr limit 1;
          if v_prop is null then
            insert into public.properties (organization_id, loan_id, address_line, city, state, zip, status, estimated_value,
              insurance_carrier, insurance_renewal_date, homestead_filed)
            values (p_org, v_loan, trim(r#>>'{property,address}'), nullif(r#>>'{property,city}', ''),
              coalesce(nullif(upper(r#>>'{property,state}'), ''), 'TX'), nullif(r#>>'{property,zip}', ''),
              case when not v_closed then 'interested'
                when coalesce(r#>>'{property,occupancy}', 'primary') = 'primary' then 'current_home'
                else 'owned' end::public.property_status,
              (r#>>'{property,estimated_value}')::numeric, nullif(r#>>'{property,insurance_carrier}', ''),
              (r#>>'{property,insurance_renewal_date}')::date, (r#>>'{property,homestead_filed}')::boolean)
            returning id into v_prop;
            v_status := coalesce(v_status, 'updated');
          else
            v_before := (select to_jsonb(pr) - 'updated_at' from public.properties pr where pr.id = v_prop);
            update public.properties pr set
              city = coalesce(pr.city, nullif(r#>>'{property,city}', '')),
              zip = coalesce(pr.zip, nullif(r#>>'{property,zip}', '')),
              estimated_value = coalesce(pr.estimated_value, (r#>>'{property,estimated_value}')::numeric),
              insurance_carrier = coalesce(pr.insurance_carrier, nullif(r#>>'{property,insurance_carrier}', '')),
              insurance_renewal_date = coalesce(pr.insurance_renewal_date, (r#>>'{property,insurance_renewal_date}')::date),
              homestead_filed = coalesce(pr.homestead_filed, (r#>>'{property,homestead_filed}')::boolean)
            where pr.id = v_prop;
            if v_before <> (select to_jsonb(pr) - 'updated_at' from public.properties pr where pr.id = v_prop) then v_status := coalesce(v_status, 'updated'); end if;
          end if;
          update public.loans set subject_property_id = v_prop where id = v_loan and subject_property_id is null;
        end if;

        -- The co-borrower, when the file has none.
        if nullif(trim(coalesce(r#>>'{co,first_name}', '')), '') is not null
          and not exists (select 1 from public.loan_borrowers lb where lb.loan_id = v_loan and lb.role = 'co_borrower') then
          v_co := public.import_find_contact(p_org, nullif(lower(trim(coalesce(r#>>'{co,email}', ''))), ''), nullif(r#>>'{co,phone}', ''));
          if v_co is null then
            insert into public.contacts (organization_id, first_name, last_name, email, phone)
            values (p_org, trim(r#>>'{co,first_name}'), coalesce(trim(r#>>'{co,last_name}'), ''),
              nullif(lower(trim(coalesce(r#>>'{co,email}', ''))), ''), nullif(r#>>'{co,phone}', ''))
            returning id into v_co;
          end if;
          if v_co <> v_contact then
            insert into public.loan_borrowers (loan_id, contact_id, organization_id, role) values (v_loan, v_co, p_org, 'co_borrower')
            on conflict do nothing;
            v_status := coalesce(v_status, 'updated');
          end if;
        end if;

        -- Buyer's agent and title company, when the file has none.
        if nullif(trim(coalesce(r#>>'{agent,name}', '')), '') is not null then
          insert into public.loan_team_members (organization_id, loan_id, role, name, email, phone)
          values (p_org, v_loan, 'buyer_agent', trim(r#>>'{agent,name}'), nullif(lower(trim(coalesce(r#>>'{agent,email}', ''))), ''), nullif(r#>>'{agent,phone}', ''))
          on conflict (loan_id, role) do nothing;
          if found then v_status := coalesce(v_status, 'updated'); end if;
        end if;
        if nullif(trim(coalesce(r->>'title_company', '')), '') is not null then
          insert into public.loan_team_members (organization_id, loan_id, role, name, company)
          values (p_org, v_loan, 'title', trim(r->>'title_company'), trim(r->>'title_company'))
          on conflict (loan_id, role) do nothing;
          if found then v_status := coalesce(v_status, 'updated'); end if;
        end if;

        -- Notes: saved once.
        if nullif(trim(coalesce(r->>'notes', '')), '') is not null
          and not exists (select 1 from public.notes n where n.contact_id = v_contact and n.body = trim(r->>'notes')) then
          insert into public.notes (organization_id, contact_id, loan_id, body) values (p_org, v_contact, v_loan, trim(r->>'notes'));
          v_status := coalesce(v_status, 'updated');
        end if;

        v_results := v_results || jsonb_build_object('row', r->'row', 'status', coalesce(v_status, 'unchanged'),
          'person', v_person, 'matched_by', v_matched_by, 'loan_id', v_loan,
          'message', case when v_status is null then 'Already in LOSuite. Nothing new to add.' end);
      exception when others then
        v_results := v_results || jsonb_build_object('row', r->'row', 'status', 'error', 'message', sqlerrm);
      end;
    end loop;

    -- A preview keeps nothing.
    if not p_save then
      raise exception using errcode = 'LSPRV', message = 'preview only';
    end if;
  exception when sqlstate 'LSPRV' then
    null;
  end;

  return v_results;
end;
$$;

revoke all on function public.import_clients(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_clients(uuid, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite import refi match installed' as result,
  (select count(*) from pg_proc where proname = 'import_clients' and pronamespace = 'public'::regnamespace
     and prosrc like '%l.closing_date is null or r->>''closing_date'' is null%') as refi_rule;
