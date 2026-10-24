-- LOSuite Phase 1: contacts and pipeline.
--
-- A person (contacts) and a deal (loans) are separate: one person can have
-- many loans over the years and stays one record (CLAUDE.md rule 3).
-- loan_borrowers links people to loans; loan_stage_history logs every stage
-- change automatically. Apply to the DEV Supabase project only.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.pipeline_stage as enum (
  'lead',
  'contacted',
  'pre_qualified',
  'pre_approved',
  'under_contract',
  'processing',
  'clear_to_close',
  'closed',
  'nurture',
  'lost'
);

create type public.loan_purpose as enum (
  'purchase',
  'refinance_rate_term',
  'refinance_cash_out',
  'heloc',
  'heloan',
  'investment_dscr'
);

create type public.borrower_role as enum ('primary', 'co_borrower');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- contacts: one row per person
-- ---------------------------------------------------------------------------

create table public.contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  first_name       text not null check (length(trim(first_name)) > 0),
  last_name        text not null default '',
  email            text,
  phone            text,
  -- Digits only, used to spot duplicates however the number was typed.
  phone_digits     text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting the organization deletes its contacts.
  constraint contacts_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- If the creating user is deleted, keep the contact and forget who created it.
  constraint contacts_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  -- Lets child tables require "same organization" in their foreign keys.
  constraint contacts_id_organization_id_key unique (id, organization_id)
);

create index contacts_organization_id_idx on public.contacts (organization_id);
create index contacts_email_idx on public.contacts (organization_id, lower(email));
create index contacts_phone_digits_idx on public.contacts (organization_id, phone_digits);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- loans: one row per deal; owns the pipeline stage
-- ---------------------------------------------------------------------------

create table public.loans (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  purpose           public.loan_purpose not null default 'purchase',
  stage             public.pipeline_stage not null default 'lead',
  lost_reason       text,
  referral_source   text,
  assigned_lo_id    uuid default auth.uid(),
  -- Repeat and refi business links back to the person's earlier loan.
  prior_loan_id     uuid,
  stage_changed_at  timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint loans_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- If the LO leaves, the loan stays and becomes unassigned.
  constraint loans_assigned_lo_id_fkey
    foreign key (assigned_lo_id) references public.profiles (id) on delete set null,
  constraint loans_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint loans_id_organization_id_key unique (id, organization_id),
  -- Prior loan must be in the same organization; deleting it just clears the link.
  constraint loans_prior_loan_id_fkey
    foreign key (prior_loan_id, organization_id) references public.loans (id, organization_id)
    on delete set null (prior_loan_id),
  constraint loans_prior_loan_not_self check (prior_loan_id is null or prior_loan_id <> id),
  -- Lost loans must say why.
  constraint loans_lost_needs_reason
    check (stage <> 'lost' or (lost_reason is not null and length(trim(lost_reason)) > 0))
);

create index loans_organization_stage_idx on public.loans (organization_id, stage);
create index loans_assigned_lo_id_idx on public.loans (assigned_lo_id);
create index loans_prior_loan_id_idx on public.loans (prior_loan_id);

create trigger loans_set_updated_at
  before update on public.loans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- loan_borrowers: which people are on which loan
-- ---------------------------------------------------------------------------

create table public.loan_borrowers (
  loan_id          uuid not null,
  contact_id       uuid not null,
  organization_id  uuid not null,
  role             public.borrower_role not null default 'primary',
  created_at       timestamptz not null default now(),
  primary key (loan_id, contact_id),
  -- Deleting a loan removes its borrower links.
  constraint loan_borrowers_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  -- A person who is on a loan cannot be deleted (no orphaned loans). The check
  -- is deferred to the end of the transaction, so removing an organization still
  -- cleans up its loans and people together.
  constraint loan_borrowers_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete no action
    deferrable initially deferred
);

-- At most one primary borrower per loan.
create unique index loan_borrowers_one_primary_idx on public.loan_borrowers (loan_id) where role = 'primary';
create index loan_borrowers_contact_id_idx on public.loan_borrowers (contact_id);

-- ---------------------------------------------------------------------------
-- loan_stage_history: written only by triggers, never edited
-- ---------------------------------------------------------------------------

create table public.loan_stage_history (
  id               bigint generated always as identity primary key,
  loan_id          uuid not null,
  organization_id  uuid not null,
  from_stage       public.pipeline_stage,
  to_stage         public.pipeline_stage not null,
  lost_reason      text,
  changed_by       uuid default auth.uid(),
  changed_at       timestamptz not null default now(),
  constraint loan_stage_history_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_stage_history_changed_by_fkey
    foreign key (changed_by) references public.profiles (id) on delete set null
);

create index loan_stage_history_loan_id_idx on public.loan_stage_history (loan_id, changed_at);

-- Stamp stage_changed_at and clear a stale lost reason when the stage moves.
create function public.loans_before_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at = now();
    if new.stage <> 'lost' then
      new.lost_reason = null;
    end if;
  end if;
  return new;
end;
$$;

create trigger loans_before_stage_change
  before update of stage on public.loans
  for each row execute function public.loans_before_stage_change();

-- Log the starting stage and every change after that.
create function public.loans_log_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.loan_stage_history (loan_id, organization_id, from_stage, to_stage, lost_reason, changed_by)
    values (
      new.id,
      new.organization_id,
      case when tg_op = 'UPDATE' then old.stage end,
      new.stage,
      new.lost_reason,
      auth.uid()
    );
  end if;
  return null;
end;
$$;

create trigger loans_log_stage
  after insert or update of stage on public.loans
  for each row execute function public.loans_log_stage();

-- ---------------------------------------------------------------------------
-- Visibility helpers. Owners, admins and processors see the whole
-- organization; loan officers see loans assigned to or created by them.
-- ---------------------------------------------------------------------------

create function public.is_org_manager(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_org_role(org, array['owner', 'admin', 'processor']::public.org_role[]);
$$;

create function public.can_see_loan(loan uuid)
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
        public.is_org_manager(l.organization_id)
        or l.assigned_lo_id = auth.uid()
        or l.created_by = auth.uid()
      )
  );
$$;

create function public.can_see_contact(contact uuid)
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
        public.is_org_manager(c.organization_id)
        or c.created_by = auth.uid()
        or exists (
          select 1 from public.loan_borrowers lb
          where lb.contact_id = c.id and public.can_see_loan(lb.loan_id)
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.contacts enable row level security;
alter table public.loans enable row level security;
alter table public.loan_borrowers enable row level security;
alter table public.loan_stage_history enable row level security;

-- contacts and loans check the row's own columns (not a lookup by id), so a
-- row is visible to its creator in the same statement that inserts it.
-- contacts
create policy "members see permitted contacts"
  on public.contacts for select to authenticated
  using (public.is_org_member(organization_id)
    and (
      public.is_org_manager(organization_id)
      or created_by = auth.uid()
      or exists (select 1 from public.loan_borrowers lb where lb.contact_id = contacts.id and public.can_see_loan(lb.loan_id))
    ));

create policy "members add contacts to their organization"
  on public.contacts for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid());

create policy "members edit permitted contacts"
  on public.contacts for update to authenticated
  using (public.is_org_member(organization_id)
    and (
      public.is_org_manager(organization_id)
      or created_by = auth.uid()
      or exists (select 1 from public.loan_borrowers lb where lb.contact_id = contacts.id and public.can_see_loan(lb.loan_id))
    ))
  with check (public.is_org_member(organization_id));

create policy "owners and admins delete contacts"
  on public.contacts for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- loans
create policy "members see permitted loans"
  on public.loans for select to authenticated
  using (public.is_org_member(organization_id)
    and (public.is_org_manager(organization_id) or assigned_lo_id = auth.uid() or created_by = auth.uid()));

create policy "members add loans to their organization"
  on public.loans for insert to authenticated
  with check (public.is_org_member(organization_id) and created_by = auth.uid());

create policy "members edit permitted loans"
  on public.loans for update to authenticated
  using (public.is_org_member(organization_id)
    and (public.is_org_manager(organization_id) or assigned_lo_id = auth.uid() or created_by = auth.uid()))
  with check (public.is_org_member(organization_id));

create policy "owners and admins delete loans"
  on public.loans for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- loan_borrowers
create policy "members see borrowers on permitted loans"
  on public.loan_borrowers for select to authenticated
  using (public.can_see_loan(loan_id));

create policy "members add borrowers to permitted loans"
  on public.loan_borrowers for insert to authenticated
  with check (public.can_see_loan(loan_id) and public.can_see_contact(contact_id));

create policy "members change borrowers on permitted loans"
  on public.loan_borrowers for update to authenticated
  using (public.can_see_loan(loan_id))
  with check (public.can_see_loan(loan_id) and public.can_see_contact(contact_id));

create policy "members remove borrowers from permitted loans"
  on public.loan_borrowers for delete to authenticated
  using (public.can_see_loan(loan_id));

-- loan_stage_history: read-only for users; rows come from the trigger.
create policy "members see history on permitted loans"
  on public.loan_stage_history for select to authenticated
  using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- create_lead: add a person (or reuse an existing one), their loan and the
-- borrower link in one step, so a half-created lead can never exist.
-- Runs with the caller's permissions, so all the policies above apply.
-- ---------------------------------------------------------------------------

create function public.create_lead(
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
    coalesce(p_assigned_lo_id, auth.uid()),
    p_prior_loan_id
  )
  returning id into v_loan_id;

  insert into public.loan_borrowers (loan_id, contact_id, organization_id, role)
  values (v_loan_id, v_contact_id, p_organization_id, 'primary');

  return v_loan_id;
end;
$$;

grant execute on function public.create_lead to authenticated;
