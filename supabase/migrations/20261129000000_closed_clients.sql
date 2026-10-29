-- LOSuite: closed loan profile, loan officer visibility, deleting leads and
-- the bulk client import (follow-up plan Phases 1 and 2, Connor 2026-10-29).
--
-- 1. Closed loan profile: the facts a closed file needs that had no home yet.
--    Deal facts on loans (typed lender and program, monthly payment at
--    closing, the old site's record ID), home facts on properties (insurance
--    carrier and renewal date, homestead exemption filed), person facts on
--    contacts (OK to text, OK to email). A loan needs the borrower's email
--    and phone before it can be moved to Closed.
-- 2. Visibility: a loan officer sees only the files assigned to them. Admins
--    see every file. A processor sees the files they are on the team for.
--    Files with no loan officer are seen by admins only. Company settings
--    (lenders, fees, steps) keep their owner/admin/processor rules.
-- 3. delete_lead(): removes a file, and the people on it who have no other file.
-- 4. import_clients(): the bulk CSV import. The app reads and checks the
--    file; this matches each row to people and files already in LOSuite (old
--    site ID, then email, then 10-digit phone, then, for closed rows, name
--    plus property address), adds what's new and fills in blanks. It never
--    overwrites a value or moves a stage. With p_save = false nothing is
--    kept, so the preview shows exactly what saving would do.
--
-- Apply to the DEV Supabase project only, after the 5+ units script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite closed clients installed").

-- ---------------------------------------------------------------------------
-- 1. Closed loan profile
-- ---------------------------------------------------------------------------

alter table public.loans
  -- Typed for files whose lender isn't on the Lenders page (old closed loans).
  -- A program chosen in Product Search names its own lender and wins.
  add column if not exists lender_name      text,
  add column if not exists program_name     text,
  -- Principal, interest, taxes, insurance and MI at closing, as the borrower paid it.
  add column if not exists monthly_payment  numeric(12, 2) check (monthly_payment >= 0),
  -- The old site's record ID, so importing the same file again finds the same loan.
  add column if not exists import_key       text check (import_key is null or length(trim(import_key)) > 0);

do $$ begin
  alter table public.loans add constraint loans_one_per_import_key unique (organization_id, import_key);
exception when duplicate_object or duplicate_table then null;
end $$;

alter table public.properties
  add column if not exists insurance_carrier       text,
  add column if not exists insurance_renewal_date  date,
  add column if not exists homestead_filed         boolean;

-- Blank = not recorded yet.
alter table public.contacts
  add column if not exists sms_consent    boolean,
  add column if not exists email_consent  boolean;

-- Closed files keep the borrower reachable for follow-ups.
create or replace function public.loans_closed_needs_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage = 'closed' and old.stage is distinct from 'closed' and exists (
    select 1 from public.loan_borrowers lb
    join public.contacts c on c.id = lb.contact_id
    where lb.loan_id = new.id and lb.role = 'primary'
      and (nullif(trim(coalesce(c.email, '')), '') is null or c.phone_digits is null)
  ) then
    raise exception 'Add the borrower''s email and phone before moving this file to Closed.';
  end if;
  return new;
end;
$$;

drop trigger if exists loans_closed_needs_contact on public.loans;
create trigger loans_closed_needs_contact
  before update of stage on public.loans
  for each row execute function public.loans_closed_needs_contact();

-- ---------------------------------------------------------------------------
-- 2. Visibility
-- ---------------------------------------------------------------------------

-- Admins see every file in the company.
create or replace function public.sees_all_files(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(org, array['admin']::public.org_role[]);
$$;

-- On the file's team as a company user (e.g. its processor).
create or replace function public.on_loan_team(loan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loan_team_members t
    where t.loan_id = loan and t.profile_id = auth.uid()
  );
$$;

-- Whether a person is on any file at all (ignores who can see the file).
create or replace function public.contact_has_loans(contact uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.loan_borrowers lb where lb.contact_id = contact);
$$;

create or replace function public.can_see_loan(loan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loans l
    where l.id = loan
      and public.is_org_member(l.organization_id)
      and (
        public.sees_all_files(l.organization_id)
        or l.assigned_lo_id = auth.uid()
        or public.on_loan_team(l.id)
      )
  );
$$;

-- A person is seen through a file you can see. Someone you just added is
-- yours until they are put on a file.
create or replace function public.can_see_contact(contact uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.contacts c
    where c.id = contact
      and public.is_org_member(c.organization_id)
      and (
        public.sees_all_files(c.organization_id)
        or (c.created_by = auth.uid() and not public.contact_has_loans(c.id))
        or exists (
          select 1 from public.loan_borrowers lb
          where lb.contact_id = c.id and public.can_see_loan(lb.loan_id)
        )
      )
  );
$$;

-- contacts and loans check the row's own columns (not a lookup by id), so a
-- row is visible to its creator in the same statement that inserts it.
drop policy if exists "members see permitted contacts" on public.contacts;
create policy "members see permitted contacts"
  on public.contacts for select to authenticated
  using (public.is_org_member(organization_id)
    and (
      public.sees_all_files(organization_id)
      or (created_by = auth.uid() and not public.contact_has_loans(id))
      or exists (select 1 from public.loan_borrowers lb where lb.contact_id = contacts.id and public.can_see_loan(lb.loan_id))
    ));

drop policy if exists "members edit permitted contacts" on public.contacts;
create policy "members edit permitted contacts"
  on public.contacts for update to authenticated
  using (public.is_org_member(organization_id)
    and (
      public.sees_all_files(organization_id)
      or (created_by = auth.uid() and not public.contact_has_loans(id))
      or exists (select 1 from public.loan_borrowers lb where lb.contact_id = contacts.id and public.can_see_loan(lb.loan_id))
    ))
  with check (public.is_org_member(organization_id));

-- Loan officers, owners and admins delete people they can see. A person who
-- is still on another file can't be deleted (loan_borrowers foreign key).
drop policy if exists "owners and admins delete contacts" on public.contacts;
drop policy if exists "members delete permitted contacts" on public.contacts;
create policy "members delete permitted contacts"
  on public.contacts for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[])
    and public.can_see_contact(id));

drop policy if exists "members see permitted loans" on public.loans;
create policy "members see permitted loans"
  on public.loans for select to authenticated
  using (public.is_org_member(organization_id)
    and (public.sees_all_files(organization_id) or assigned_lo_id = auth.uid() or public.on_loan_team(id)));

drop policy if exists "members edit permitted loans" on public.loans;
create policy "members edit permitted loans"
  on public.loans for update to authenticated
  using (public.is_org_member(organization_id)
    and (public.sees_all_files(organization_id) or assigned_lo_id = auth.uid() or public.on_loan_team(id)))
  with check (public.is_org_member(organization_id));

drop policy if exists "owners and admins delete loans" on public.loans;
drop policy if exists "members delete permitted loans" on public.loans;
create policy "members delete permitted loans"
  on public.loans for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[])
    and (public.sees_all_files(organization_id) or assigned_lo_id = auth.uid()));

-- reassign_loan: hand a file to another loan officer (or take it back to
-- unassigned). A plain update can't move a row out of the caller's sight, so
-- this runs as the database owner after checking the caller may edit the file.
create or replace function public.reassign_loan(p_loan_id uuid, p_lo_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select l.organization_id into v_org from public.loans l where l.id = p_loan_id and public.can_see_loan(l.id);
  if v_org is null then
    raise exception 'This file can''t be reassigned. Only its loan officer or an admin can do that.';
  end if;
  if p_lo_id is not null and not exists (
    select 1 from public.organization_members m where m.organization_id = v_org and m.user_id = p_lo_id
  ) then
    raise exception 'That loan officer isn''t in this company.';
  end if;
  update public.loans set assigned_lo_id = p_lo_id where id = p_loan_id;
end;
$$;

revoke all on function public.reassign_loan(uuid, uuid) from public;
grant execute on function public.reassign_loan(uuid, uuid) to authenticated;

-- create_lead: a lead for another loan officer is built as the caller's
-- first (so the borrower link can be added), then handed over in the same step.
create or replace function public.create_lead(
  p_organization_id      uuid,
  p_first_name           text,
  p_last_name            text,
  p_email                text,
  p_phone                text,
  p_purpose              public.loan_purpose,
  p_referral_source      text,
  p_assigned_lo_id       uuid,
  p_existing_contact_id  uuid default null,
  p_prior_loan_id        uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contact_id uuid := p_existing_contact_id;
  v_loan_id uuid;
begin
  if v_contact_id is null then
    insert into public.contacts (organization_id, first_name, last_name, email, phone)
    values (
      p_organization_id,
      trim(p_first_name),
      coalesce(trim(p_last_name), ''),
      nullif(trim(p_email), ''),
      nullif(trim(p_phone), '')
    )
    returning id into v_contact_id;
  end if;

  insert into public.loans (organization_id, purpose, referral_source, assigned_lo_id, prior_loan_id)
  values (
    p_organization_id,
    p_purpose,
    nullif(trim(p_referral_source), ''),
    auth.uid(),
    p_prior_loan_id
  )
  returning id into v_loan_id;

  insert into public.loan_borrowers (loan_id, contact_id, organization_id, role)
  values (v_loan_id, v_contact_id, p_organization_id, 'primary');

  if p_assigned_lo_id is not null and p_assigned_lo_id <> auth.uid() then
    perform public.reassign_loan(v_loan_id, p_assigned_lo_id);
  end if;

  return v_loan_id;
end;
$$;

grant execute on function public.create_lead to authenticated;

-- ---------------------------------------------------------------------------
-- 3. delete_lead: the file, and anyone on it who has no other file.
-- ---------------------------------------------------------------------------

-- Runs as the database owner so people who were added by someone else are
-- removed too; the check below is the permission. Web forms for the file are
-- marked handled, so they don't reappear on Today without a file.
create or replace function public.delete_lead(p_loan_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_loan    public.loans;
  v_people  uuid[];
  v_removed integer;
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if v_loan.id is null
    or not public.has_org_role(v_loan.organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[])
    or not (public.sees_all_files(v_loan.organization_id) or v_loan.assigned_lo_id = auth.uid()) then
    raise exception 'This file can''t be deleted. Only its loan officer or an admin can delete it.';
  end if;
  select array_agg(contact_id) into v_people from public.loan_borrowers where loan_id = p_loan_id;
  update public.lead_submissions set handled_at = now(), handled_by = auth.uid()
  where loan_id = p_loan_id and handled_at is null;
  delete from public.loans where id = p_loan_id;
  get diagnostics v_removed = row_count;
  delete from public.contacts c
  where c.id = any (coalesce(v_people, '{}'))
    and not public.contact_has_loans(c.id);
  return v_removed;
end;
$$;

revoke all on function public.delete_lead(uuid) from public;
grant execute on function public.delete_lead(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. import_clients
-- ---------------------------------------------------------------------------
-- p_rows is a JSON array of rows the app has already checked and cleaned:
--   row, lo_email, first_name, last_name, email, phone (10 digits), birthday,
--   mailing {address, city, state, zip}, sms_ok, email_ok,
--   co {first_name, last_name, email, phone},
--   stage, lost_reason, purpose, loan_type, loan_amount, purchase_price,
--   monthly_payment, rate, term_months, lender, program, arive_loan_number,
--   referral_source, closing_date, first_payment_date,
--   property {address, city, state, zip, occupancy, estimated_value,
--             insurance_carrier, insurance_renewal_date, homestead_filed},
--   agent {name, email, phone}, title_company, old_site_id, notes
-- Returns one result per row: row, status (added / updated / unchanged /
-- skipped / error), person (new / matched), matched_by, loan_id, message.

-- Find a person by email or 10-digit phone (oldest record first).
create or replace function public.import_find_contact(p_org uuid, p_email text, p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.contacts c
  where c.organization_id = p_org
    and ((p_email is not null and lower(c.email) = lower(p_email))
      or (p_phone is not null and right(c.phone_digits, 10) = p_phone))
  order by (p_email is not null and lower(c.email) = lower(p_email)) desc, c.created_at
  limit 1;
$$;

revoke all on function public.import_find_contact(uuid, text, text) from public, anon, authenticated;

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
        -- date or property; otherwise their latest file that isn't closed.
        if v_loan is null and v_contact is not null then
          if v_closed then
            select l.id, l.assigned_lo_id into v_loan, v_loan_lo from public.loans l
            join public.loan_borrowers lb on lb.loan_id = l.id and lb.contact_id = v_contact
            where l.stage = 'closed'
              and (l.import_key is null or r->>'old_site_id' is null or l.import_key = trim(r->>'old_site_id'))
              and (l.closing_date = (r->>'closing_date')::date
                or (v_addr is not null and exists (select 1 from public.properties pr where pr.loan_id = l.id and lower(trim(pr.address_line)) = v_addr)))
            order by l.closing_date desc nulls last limit 1;
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
-- 5. Dave joins MPS Mortgage as a loan officer, once his login exists.
-- ---------------------------------------------------------------------------

insert into public.profiles (id, email, full_name)
select u.id, u.email, u.raw_user_meta_data ->> 'full_name'
from auth.users u
where lower(u.email) = 'dave@mps.mortgage'
  and not exists (select 1 from public.profiles p where p.id = u.id);

insert into public.organization_members (organization_id, user_id, role)
select (select id from public.organizations where nmls = '2501110' order by created_at limit 1), p.id, 'loan_officer'
from public.profiles p
where lower(p.email) = 'dave@mps.mortgage'
  and exists (select 1 from public.organizations where nmls = '2501110')
on conflict (organization_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite closed clients installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'loans' and column_name in ('lender_name', 'program_name', 'monthly_payment', 'import_key'))
       or (table_name = 'properties' and column_name in ('insurance_carrier', 'insurance_renewal_date', 'homestead_filed'))
       or (table_name = 'contacts' and column_name in ('sms_consent', 'email_consent')))) as new_fields,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('loans', 'contacts')
     and qual like '%sees_all_files%') as visibility_rules,
  (select count(*) from pg_proc where proname in ('delete_lead', 'import_clients', 'sees_all_files') and pronamespace = 'public'::regnamespace) as functions,
  (select string_agg(p.email || ' (' || m.role || ')', ', ' order by p.email) from public.organization_members m
     join public.profiles p on p.id = m.user_id) as team;
