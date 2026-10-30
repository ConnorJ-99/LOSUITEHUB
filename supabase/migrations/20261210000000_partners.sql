-- LOSuite: the Partner center (GHL messaging plan, step C).
--
-- partners: one record per outside partner (realtors, title, builders and
--   other referral partners), matched by email (lowercased, trimmed) or the
--   10-digit phone, never by name. Consent fields have the same shape as
--   contacts', so realtor updates (step D) pass the same checks.
-- loan_team_members.partner_id: who the agent or title contact on a file is.
--   Putting someone on a file's team (by hand, from a contract, or from the
--   CSV import) finds them by email or phone, or adds them. Someone with
--   neither can only be linked by choosing them.
-- lead_submissions.partner_id: the website's partner form does the same.
-- A partner's details live on the partner. Editing one updates every file
--   they're on; a file only fills in what the partner is missing.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite partners installed").

-- ---------------------------------------------------------------------------
-- 1. partners
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.partner_kind as enum ('realtor', 'title', 'builder', 'referral', 'other');
exception when duplicate_object then null;
end $$;

create table if not exists public.partners (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  kind                public.partner_kind not null default 'realtor',
  name                text not null check (length(trim(name)) > 0),
  company             text,
  email               text,
  -- Lowercased and trimmed: two partners can't share an email.
  email_key           text generated always as (nullif(lower(trim(coalesce(email, ''))), '')) stored,
  phone               text,
  -- Digits only, without a leading US 1, so it's 10 digits for a US number.
  phone_digits        text generated always as (
    case when regexp_replace(coalesce(phone, ''), '\D', '', 'g') ~ '^1[0-9]{10}$'
      then substr(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 2)
      else nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')
    end
  ) stored,
  -- Same shape as contacts: null = not recorded.
  sms_consent         boolean,
  email_consent       boolean,
  sms_opted_out_at    timestamptz,
  email_opted_out_at  timestamptz,
  -- Set by GHL matching only (step D); empty for now.
  ghl_contact_id      text,
  notes               text,
  -- Where the partner first came from: a file's team, the website, or added by hand.
  added_from          text not null default 'manual' check (added_from in ('file_team', 'website', 'manual')),
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Deleting the company deletes its partners.
  constraint partners_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- If the creating user is deleted, keep the partner and forget who added it.
  constraint partners_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  -- Lets other tables require "same company" in their foreign keys.
  constraint partners_id_organization_id_key unique (id, organization_id)
);

create unique index if not exists partners_email_key on public.partners (organization_id, email_key) where email_key is not null;
create index if not exists partners_phone_digits_idx on public.partners (organization_id, phone_digits);
create index if not exists partners_name_idx on public.partners (organization_id, lower(name));

create or replace trigger partners_set_updated_at
  before update on public.partners
  for each row execute function public.set_updated_at();

alter table public.partners enable row level security;

-- Everyone in the company sees partners; owners, admins and loan officers add and edit them.
drop policy if exists "members see partners" on public.partners;
create policy "members see partners" on public.partners
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "loan officers add partners" on public.partners;
create policy "loan officers add partners" on public.partners
  for insert to authenticated with check (public.has_org_role(organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[]));
drop policy if exists "loan officers edit partners" on public.partners;
create policy "loan officers edit partners" on public.partners
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[]));
-- A partner on any file can't be deleted (the team's foreign key refuses it).
drop policy if exists "loan officers remove partners" on public.partners;
create policy "loan officers remove partners" on public.partners
  for delete to authenticated using (public.has_org_role(organization_id, array['owner', 'admin', 'loan_officer']::public.org_role[]));

-- Like contacts: someone who opted out stays opted out until a person turns it
-- back on (step D adds the note), and only GHL matching sets ghl_contact_id.
-- Edge Functions using the service role and the SQL Editor aren't limited.
create or replace function public.guard_partner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if new.ghl_contact_id is distinct from (case when tg_op = 'UPDATE' then old.ghl_contact_id end) then
      raise exception 'Only GHL matching links a partner to GHL.';
    end if;
    if tg_op = 'UPDATE' and coalesce(current_setting('losuite.consent_restore', true), '') <> 'on'
      and ((old.sms_opted_out_at is not null and (new.sms_opted_out_at is null or new.sms_consent is true))
        or (old.email_opted_out_at is not null and (new.email_opted_out_at is null or new.email_consent is true))) then
      raise exception 'This partner opted out. Their consent can''t be turned back on here.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_partner_change() from public;

drop trigger if exists guard_partner_change on public.partners;
create trigger guard_partner_change
  before insert or update on public.partners
  for each row execute function public.guard_partner_change();

-- ---------------------------------------------------------------------------
-- 2. Matching: email, else the 10-digit phone, never the name
-- ---------------------------------------------------------------------------

-- Ten digits without a leading US 1; null when it isn't a 10-digit number.
create or replace function public.partner_phone10(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^1[0-9]{10}$' then substr(d, 2)
    when d ~ '^[0-9]{10}$' then d
  end
  from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x;
$$;

-- Which team roles are partners. Processors are company users or contract
-- processors, and lender account execs belong to the Lenders page.
create or replace function public.partner_kind_for_role(p_role public.team_role)
returns public.partner_kind
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'buyer_agent' then 'realtor'::public.partner_kind
    when 'listing_agent' then 'realtor'::public.partner_kind
    when 'title' then 'title'::public.partner_kind
    when 'escrow_officer' then 'title'::public.partner_kind
  end;
$$;

-- The partner with this email, else the one partner with this phone (when
-- one side has no email, so two coworkers on an office line aren't merged),
-- else a new partner. Null when there's no email or phone to match by, or
-- when several partners share the phone and there's no email to tell them
-- apart. Never matches by name.
create or replace function public.find_or_create_partner(
  p_org uuid, p_kind public.partner_kind, p_name text, p_company text, p_email text, p_phone text, p_added_from text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := public.partner_phone10(p_phone);
  v_id    uuid;
  v_count int;
begin
  if v_email is null and v_phone is null then
    return null;
  end if;

  if v_email is not null then
    select p.id into v_id from public.partners p where p.organization_id = p_org and p.email_key = v_email;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if v_phone is not null then
    select count(*), (array_agg(p.id))[1] into v_count, v_id
    from public.partners p
    where p.organization_id = p_org and p.phone_digits = v_phone and (v_email is null or p.email_key is null);
    if v_count = 1 then
      return v_id;
    elsif v_count > 1 then
      return null;
    end if;
  end if;

  insert into public.partners (organization_id, kind, name, company, email, phone, added_from)
  values (
    p_org,
    coalesce(p_kind, 'other'),
    left(coalesce(nullif(trim(coalesce(p_name, '')), ''), nullif(trim(coalesce(p_company, '')), ''), v_email, trim(p_phone)), 200),
    nullif(trim(coalesce(p_company, '')), ''),
    v_email,
    nullif(trim(coalesce(p_phone, '')), ''),
    p_added_from
  )
  on conflict (organization_id, email_key) where email_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select p.id into v_id from public.partners p where p.organization_id = p_org and p.email_key = v_email;
  end if;
  return v_id;
end;
$$;

-- Fills in a partner's missing company, email or phone. Never overwrites, and
-- never takes an email another partner already has.
create or replace function public.fill_partner_blanks(p_id uuid, p_company text, p_email text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text := nullif(trim(coalesce(p_company, '')), '');
  v_email   text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone   text := nullif(trim(coalesce(p_phone, '')), '');
begin
  update public.partners p set
    company = coalesce(p.company, v_company),
    email = coalesce(p.email, case when not exists (select 1 from public.partners o where o.organization_id = p.organization_id and o.email_key = v_email) then v_email end),
    phone = coalesce(p.phone, v_phone)
  where p.id = p_id
    and ((p.company is null and v_company is not null) or (p.email is null and v_email is not null) or (p.phone is null and v_phone is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. File teams link to partners
-- ---------------------------------------------------------------------------

alter table public.loan_team_members add column if not exists partner_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'loan_team_members_partner_id_fkey') then
    -- "No action": a partner on a file can't be deleted, but deleting the
    -- company still removes its files and partners together.
    alter table public.loan_team_members
      add constraint loan_team_members_partner_id_fkey
      foreign key (partner_id, organization_id) references public.partners (id, organization_id) on delete no action;
  end if;
end $$;

create index if not exists loan_team_members_partner_id_idx on public.loan_team_members (partner_id);

-- Before a team row is saved: link it to its partner and show the partner's
-- details on the file.
create or replace function public.link_team_partner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind    public.partner_kind := public.partner_kind_for_role(new.role);
  v_partner public.partners;
  v_id      uuid;
begin
  -- A partner edit copying its details to the files it's on.
  if coalesce(current_setting('losuite.partner_sync', true), '') = 'on' then
    return new;
  end if;
  if new.profile_id is not null or v_kind is null then
    new.partner_id := null;
    return new;
  end if;
  -- An upsert onto a role the file already has: matching runs on its update.
  if tg_op = 'INSERT' and exists (select 1 from public.loan_team_members t where t.loan_id = new.loan_id and t.role = new.role) then
    return new;
  end if;

  if new.partner_id is not null and (tg_op = 'INSERT' or new.partner_id is distinct from old.partner_id) then
    -- Chosen on purpose.
    v_id := new.partner_id;
  elsif tg_op = 'UPDATE' and new.partner_id is not null
    and nullif(lower(trim(coalesce(new.email, ''))), '') is not distinct from nullif(lower(trim(coalesce(old.email, ''))), '')
    and public.partner_phone10(new.phone) is not distinct from public.partner_phone10(old.phone)
    and (new.email is not null or new.phone is not null or lower(trim(new.name)) is not distinct from lower(trim(old.name))) then
    -- Same email and phone (or, with neither, the same name): the same person.
    return new;
  else
    v_id := public.find_or_create_partner(new.organization_id, v_kind, new.name, new.company, new.email, new.phone, 'file_team');
  end if;

  new.partner_id := v_id;
  if v_id is not null then
    select * into v_partner from public.partners p where p.id = v_id and p.organization_id = new.organization_id;
    if found then
      new.name := v_partner.name;
      new.company := coalesce(v_partner.company, new.company);
      new.email := coalesce(v_partner.email, new.email);
      new.phone := coalesce(v_partner.phone, new.phone);
    end if;
  end if;
  return new;
end;
$$;

-- After a team row is saved: anything it has that its partner is missing goes
-- to the partner (and from there to the partner's other files).
create or replace function public.fill_partner_from_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.partner_id is not null and coalesce(current_setting('losuite.partner_sync', true), '') <> 'on' then
    perform public.fill_partner_blanks(new.partner_id, new.company, new.email, new.phone);
  end if;
  return null;
end;
$$;

-- After a partner is edited: every file they're on shows the new details.
create or replace function public.sync_partner_to_teams()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('losuite.partner_sync', 'on', true);
  update public.loan_team_members t
  set name = new.name, company = new.company, email = new.email, phone = new.phone
  where t.partner_id = new.id
    and (t.name, t.company, t.email, t.phone) is distinct from (new.name, new.company, new.email, new.phone);
  perform set_config('losuite.partner_sync', '', true);
  return null;
end;
$$;

revoke all on function public.partner_phone10(text) from public;
revoke all on function public.partner_kind_for_role(public.team_role) from public;
revoke all on function public.find_or_create_partner(uuid, public.partner_kind, text, text, text, text, text) from public;
revoke all on function public.fill_partner_blanks(uuid, text, text, text) from public;
revoke all on function public.link_team_partner() from public;
revoke all on function public.fill_partner_from_team() from public;
revoke all on function public.sync_partner_to_teams() from public;
do $$ begin
  revoke all on function public.partner_phone10(text) from anon, authenticated;
  revoke all on function public.partner_kind_for_role(public.team_role) from anon, authenticated;
  revoke all on function public.find_or_create_partner(uuid, public.partner_kind, text, text, text, text, text) from anon, authenticated;
  revoke all on function public.fill_partner_blanks(uuid, text, text, text) from anon, authenticated;
  revoke all on function public.link_team_partner() from anon, authenticated;
  revoke all on function public.fill_partner_from_team() from anon, authenticated;
  revoke all on function public.sync_partner_to_teams() from anon, authenticated;
exception when undefined_object then null;
end $$;

drop trigger if exists link_team_partner on public.loan_team_members;
create trigger link_team_partner
  before insert or update of role, profile_id, partner_id, name, company, email, phone on public.loan_team_members
  for each row execute function public.link_team_partner();

drop trigger if exists fill_partner_from_team on public.loan_team_members;
create trigger fill_partner_from_team
  after insert or update of partner_id, company, email, phone on public.loan_team_members
  for each row execute function public.fill_partner_from_team();

drop trigger if exists sync_partner_to_teams on public.partners;
create trigger sync_partner_to_teams
  after update of name, company, email, phone on public.partners
  for each row execute function public.sync_partner_to_teams();

-- ---------------------------------------------------------------------------
-- 4. The website's partner form
-- ---------------------------------------------------------------------------

alter table public.lead_submissions add column if not exists partner_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lead_submissions_partner_id_fkey') then
    -- Deleting a partner keeps the submission.
    alter table public.lead_submissions
      add constraint lead_submissions_partner_id_fkey
      foreign key (partner_id, organization_id) references public.partners (id, organization_id) on delete set null (partner_id);
  end if;
end $$;

create index if not exists lead_submissions_partner_id_idx on public.lead_submissions (partner_id);

-- The partner a partner-form submission came from: the cleaned-up name,
-- email and phone the intake function sends, else the form's own answers
-- (for submissions saved before partners existed).
create or replace function public.partner_from_submission(
  p_org uuid, p_form_type text, p_answers jsonb, p_first text, p_last text, p_email text, p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        jsonb := coalesce(p_answers, '{}'::jsonb);
  v_first  text := coalesce(nullif(trim(coalesce(p_first, '')), ''), nullif(trim(coalesce(a->>'first_name', a->>'firstName', a->>'fname', '')), ''));
  v_last   text := coalesce(nullif(trim(coalesce(p_last, '')), ''), nullif(trim(coalesce(a->>'last_name', a->>'lastName', a->>'lname', '')), ''));
  v_name   text := coalesce(nullif(concat_ws(' ', v_first, v_last), ''), nullif(trim(coalesce(a->>'name', a->>'full_name', a->>'fullName', '')), ''));
  v_company text := nullif(trim(coalesce(a->>'company', a->>'company_name', a->>'companyName', a->>'brokerage', a->>'business_name', a->>'builder_name', '')), '');
  v_email  text := coalesce(nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(a->>'email', a->>'email_address', '')), ''));
  v_phone  text := coalesce(nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(a->>'phone', a->>'phone_number', a->>'mobile', a->>'cell', '')), ''));
  v_about  text := lower(concat_ws(' ', p_form_type, a->>'partner_type', a->>'partnerType', a->>'role', a->>'type', a->>'company_type', a->>'profession'));
  v_id     uuid;
begin
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    v_email := null;
  end if;
  v_id := public.find_or_create_partner(
    p_org,
    case
      when v_about like '%builder%' then 'builder'::public.partner_kind
      when v_about like '%title%' or v_about like '%escrow%' then 'title'::public.partner_kind
      else 'realtor'::public.partner_kind
    end,
    v_name, v_company, v_email, v_phone, 'website'
  );
  if v_id is not null then
    perform public.fill_partner_blanks(v_id, v_company, v_email, v_phone);
  end if;
  return v_id;
end;
$$;

revoke all on function public.partner_from_submission(uuid, text, jsonb, text, text, text, text) from public;
do $$ begin
  revoke all on function public.partner_from_submission(uuid, text, jsonb, text, text, text, text) from anon, authenticated;
exception when undefined_object then null;
end $$;

-- intake_web_lead as in 20261107000000_lead_intake.sql; partner inquiries now
-- also find or add the partner. The payload is unchanged.
create or replace function public.intake_web_lead(p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     text := coalesce(nullif(p_lead->>'kind', ''), 'lead');
  v_email    text := nullif(lower(trim(coalesce(p_lead->>'email', ''))), '');
  v_phone    text := nullif(right(regexp_replace(coalesce(p_lead->>'phone', ''), '\D', '', 'g'), 10), '');
  v_ext      text := nullif(trim(coalesce(p_lead->>'external_id', '')), '');
  v_first    text := coalesce(nullif(trim(coalesce(p_lead->>'first_name', '')), ''), 'Web lead');
  v_purpose  public.loan_purpose := coalesce(nullif(p_lead->>'purpose', ''), 'purchase')::public.loan_purpose;
  v_price    numeric := nullif(p_lead->>'purchase_price', '')::numeric;
  v_down     numeric := nullif(p_lead->>'down_payment', '')::numeric;
  v_source   text := left(concat_ws(' · ', nullif(p_lead->>'source', ''), nullif(p_lead->>'form_type', '')), 200);
  v_org      uuid;
  v_lo       uuid;
  v_contact  uuid;
  v_loan     uuid;
  v_prior    uuid;
  v_outcome  text;
  v_existing record;
  v_sub      uuid;
  v_partner  uuid;
begin
  if v_email is null and (v_phone is null or length(v_phone) < 10) then
    raise exception 'An email or phone number is required.';
  end if;
  if v_kind not in ('lead', 'partner') then
    raise exception 'Unknown kind: %', v_kind;
  end if;

  -- Who it's for: the named loan officer, otherwise the company owner.
  select m.user_id, m.organization_id into v_lo, v_org
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where nullif(p_lead->>'assigned_to_email', '') is not null
    and lower(p.email) = lower(p_lead->>'assigned_to_email')
  order by m.created_at
  limit 1;
  if v_org is null then
    select m.user_id, m.organization_id into v_lo, v_org
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
    where m.role = 'owner'
    order by o.created_at, m.created_at
    limit 1;
  end if;
  if v_org is null then
    raise exception 'No company is set up to receive leads.';
  end if;

  -- The same submission sent again: answer as before, save nothing.
  if v_ext is not null then
    select id, contact_id, loan_id, outcome into v_existing
    from public.lead_submissions
    where organization_id = v_org and external_id = v_ext;
    if found then
      return jsonb_build_object('outcome', 'already_received', 'first_outcome', v_existing.outcome, 'submission_id', v_existing.id, 'contact_id', v_existing.contact_id, 'loan_id', v_existing.loan_id);
    end if;
  end if;

  if v_kind = 'partner' then
    v_partner := public.partner_from_submission(v_org, p_lead->>'form_type', p_lead->'answers', p_lead->>'first_name', p_lead->>'last_name', v_email, v_phone);
    insert into public.lead_submissions (organization_id, partner_id, kind, form_type, source, external_id, tracking, answers, outcome)
    values (v_org, v_partner, 'partner', p_lead->>'form_type', v_source, v_ext, coalesce(p_lead->'tracking', '{}'::jsonb), coalesce(p_lead->'answers', '{}'::jsonb), 'partner_inquiry')
    returning id into v_sub;
    return jsonb_build_object('outcome', 'partner_inquiry', 'submission_id', v_sub);
  end if;

  -- Same person: same email or same 10-digit phone.
  select c.id into v_contact
  from public.contacts c
  where c.organization_id = v_org
    and ((v_email is not null and lower(c.email) = v_email) or (v_phone is not null and right(c.phone_digits, 10) = v_phone))
  order by c.updated_at desc
  limit 1;

  if v_contact is not null then
    select l.id, l.assigned_lo_id into v_existing
    from public.loans l
    join public.loan_borrowers lb on lb.loan_id = l.id
    where lb.contact_id = v_contact and l.stage not in ('closed', 'lost')
    order by l.created_at desc
    limit 1;
    if found then
      v_loan := v_existing.id;
      v_outcome := 'existing_open_loan';
      insert into public.notes (organization_id, contact_id, loan_id, kind, body)
      values (v_org, v_contact, v_loan, 'note', format('New web form: %s. Answers are on the Overview under Web forms.', coalesce(v_source, 'website')));
      insert into public.tasks (organization_id, loan_id, title, due_on, assigned_to)
      values (v_org, v_loan, format('Follow up on a new web form from %s', v_first), current_date, coalesce(v_existing.assigned_lo_id, v_lo));
    else
      select l.id into v_prior
      from public.loans l
      join public.loan_borrowers lb on lb.loan_id = l.id
      where lb.contact_id = v_contact
      order by l.created_at desc
      limit 1;
      v_outcome := 'new_loan_existing_person';
    end if;
  else
    insert into public.contacts (organization_id, first_name, last_name, email, phone)
    values (v_org, left(v_first, 100), left(coalesce(trim(p_lead->>'last_name'), ''), 100), v_email, v_phone)
    returning id into v_contact;
    v_outcome := 'new_lead';
  end if;

  if v_loan is null then
    insert into public.loans (organization_id, purpose, referral_source, assigned_lo_id, prior_loan_id, purchase_price, loan_amount, cash_out_amount, timeline)
    values (
      v_org,
      v_purpose,
      v_source,
      v_lo,
      v_prior,
      case when v_purpose = 'purchase' then v_price end,
      case when v_purpose = 'purchase' and v_price is not null and v_down is not null and v_down < v_price then v_price - v_down end,
      case when v_purpose = 'refinance_cash_out' then nullif(p_lead->>'cash_out', '')::numeric end,
      nullif(left(coalesce(p_lead->>'timeline', ''), 200), '')
    )
    returning id into v_loan;
    insert into public.loan_borrowers (loan_id, contact_id, organization_id, role, estimated_credit_score)
    values (v_loan, v_contact, v_org, 'primary', nullif(p_lead->>'credit_score', '')::smallint);
  end if;

  insert into public.lead_submissions (organization_id, contact_id, loan_id, kind, form_type, source, external_id, tracking, answers, outcome)
  values (v_org, v_contact, v_loan, 'lead', p_lead->>'form_type', v_source, v_ext, coalesce(p_lead->'tracking', '{}'::jsonb), coalesce(p_lead->'answers', '{}'::jsonb), v_outcome)
  returning id into v_sub;

  return jsonb_build_object('outcome', v_outcome, 'submission_id', v_sub, 'contact_id', v_contact, 'loan_id', v_loan);
end;
$$;

-- Only the intake Edge Function (service role) may run it.
revoke all on function public.intake_web_lead(jsonb) from public;
do $$ begin
  revoke all on function public.intake_web_lead(jsonb) from anon, authenticated;
exception when undefined_object then null;
end $$;
do $$ begin
  grant execute on function public.intake_web_lead(jsonb) to service_role;
exception when undefined_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Existing files and partner forms (only rows not linked yet)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  -- Oldest first, so the first time someone was entered names the partner.
  for r in
    select t.id from public.loan_team_members t
    where t.partner_id is null and t.profile_id is null and public.partner_kind_for_role(t.role) is not null
      and (nullif(trim(coalesce(t.email, '')), '') is not null or public.partner_phone10(t.phone) is not null)
    order by t.created_at, t.id
  loop
    update public.loan_team_members set partner_id = null where id = r.id;
  end loop;

  for r in
    select s.id, s.organization_id, s.form_type, s.answers from public.lead_submissions s
    where s.kind = 'partner' and s.partner_id is null
    order by s.received_at, s.id
  loop
    update public.lead_submissions
    set partner_id = public.partner_from_submission(r.organization_id, r.form_type, r.answers, null, null, null, null)
    where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite partners installed' as result,
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'partners' and column_name in ('email_key', 'phone_digits', 'sms_consent', 'email_consent', 'sms_opted_out_at', 'email_opted_out_at', 'ghl_contact_id'))
        or (table_name in ('loan_team_members', 'lead_submissions') and column_name = 'partner_id'))) as columns,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('find_or_create_partner', 'fill_partner_blanks', 'link_team_partner', 'fill_partner_from_team', 'sync_partner_to_teams', 'partner_from_submission', 'guard_partner_change', 'partner_phone10', 'partner_kind_for_role')) as functions,
  (select count(*) from public.partners) as partners,
  (select count(*) from public.loan_team_members where partner_id is not null) as linked_team_rows;
