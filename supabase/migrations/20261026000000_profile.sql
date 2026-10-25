-- LOSuite Phase 2: borrower profile (Overview, Notes, Properties).
--
-- One source of truth per value (CLAUDE.md rule 4):
--   deal facts (price, loan amount, rate, dates)  -> loans
--   home facts (value, taxes, insurance, rent)    -> properties
--   existing mortgages on a home                  -> property_liens
-- Notes belong to the person and remember which loan they were written on.
-- Apply to the DEV Supabase project only.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.occupancy as enum ('primary', 'second_home', 'investment');

create type public.property_status as enum ('interested', 'offer_made', 'under_contract', 'passed', 'current_home');

create type public.property_type as enum ('single_family', 'condo', 'townhouse', 'two_to_four_unit', 'manufactured', 'other');

create type public.lien_position as enum ('first', 'second');

create type public.note_kind as enum ('note', 'call', 'text', 'email', 'meeting');

-- ---------------------------------------------------------------------------
-- Deal facts on loans
-- ---------------------------------------------------------------------------

alter table public.loans
  add column occupancy                 public.occupancy not null default 'primary',
  add column purchase_price            numeric(14, 2) check (purchase_price >= 0),
  add column loan_amount               numeric(14, 2) check (loan_amount >= 0),
  add column note_rate                 numeric(6, 3) check (note_rate >= 0 and note_rate <= 30),
  add column term_months               smallint check (term_months between 1 and 480),
  add column cash_out_amount           numeric(14, 2) check (cash_out_amount >= 0),
  add column contract_date             date,
  add column option_end_date           date,
  add column closing_date              date,
  add column vesting_entity            text,
  add column financed_properties_count smallint check (financed_properties_count >= 0),
  -- Points at one of this loan's own properties (constraint added below).
  add column subject_property_id       uuid;

-- ---------------------------------------------------------------------------
-- properties: homes on a loan (interested in, under contract, or current home)
-- ---------------------------------------------------------------------------

create table public.properties (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  loan_id           uuid not null,
  address_line      text not null check (length(trim(address_line)) > 0),
  city              text,
  state             text not null default 'TX' check (state ~ '^[A-Z]{2}$'),
  zip               text,
  county            text,
  property_type     public.property_type,
  status            public.property_status not null default 'interested',
  list_price        numeric(14, 2) check (list_price >= 0),
  estimated_value   numeric(14, 2) check (estimated_value >= 0),
  annual_taxes      numeric(12, 2) check (annual_taxes >= 0),
  annual_insurance  numeric(12, 2) check (annual_insurance >= 0),
  monthly_hoa       numeric(10, 2) check (monthly_hoa >= 0),
  monthly_rent      numeric(10, 2) check (monthly_rent >= 0),
  is_homestead      boolean not null default false,
  listing_url       text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint properties_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  -- Deleting a loan deletes its properties.
  constraint properties_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint properties_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint properties_id_organization_id_key unique (id, organization_id),
  constraint properties_id_loan_id_key unique (id, loan_id)
);

create index properties_loan_id_idx on public.properties (loan_id);

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

-- The subject property must be one of the loan's own properties. Deleting
-- that property just clears the choice.
alter table public.loans
  add constraint loans_subject_property_id_fkey
    foreign key (subject_property_id, id) references public.properties (id, loan_id)
    on delete set null (subject_property_id);

-- ---------------------------------------------------------------------------
-- property_liens: existing mortgages on a property
-- ---------------------------------------------------------------------------

create table public.property_liens (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  property_id        uuid not null,
  position           public.lien_position not null default 'first',
  lender             text,
  balance            numeric(14, 2) check (balance >= 0),
  note_rate          numeric(6, 3) check (note_rate >= 0 and note_rate <= 30),
  -- Principal and interest only.
  monthly_payment    numeric(12, 2) check (monthly_payment >= 0),
  is_heloc           boolean not null default false,
  originated_on      date,
  -- An earlier Texas §50(a)(6) cash-out loan (drives the 1-year seasoning check).
  is_texas_cash_out  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Deleting a property deletes its liens.
  constraint property_liens_property_id_fkey
    foreign key (property_id, organization_id) references public.properties (id, organization_id) on delete cascade,
  constraint property_liens_one_per_position unique (property_id, position)
);

create trigger property_liens_set_updated_at
  before update on public.property_liens
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- notes: belong to the person; remember which loan they were written on
-- ---------------------------------------------------------------------------

create table public.notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  loan_id          uuid,
  kind             public.note_kind not null default 'note',
  body             text not null check (length(trim(body)) > 0),
  pinned           boolean not null default false,
  author_id        uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting the person deletes their notes.
  constraint notes_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  -- Deleting the loan keeps the note and forgets the loan.
  constraint notes_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id),
  constraint notes_author_id_fkey
    foreign key (author_id) references public.profiles (id) on delete set null
);

create index notes_contact_id_idx on public.notes (contact_id, created_at desc);
create index notes_loan_id_idx on public.notes (loan_id);

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tasks: follow-ups on a loan
-- ---------------------------------------------------------------------------

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  title            text not null check (length(trim(title)) > 0),
  due_on           date,
  completed_at     timestamptz,
  assigned_to      uuid default auth.uid(),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its tasks.
  constraint tasks_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint tasks_assigned_to_fkey
    foreign key (assigned_to) references public.profiles (id) on delete set null,
  constraint tasks_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index tasks_loan_id_idx on public.tasks (loan_id);
create index tasks_open_by_assignee_idx on public.tasks (assigned_to, due_on) where completed_at is null;

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: everything follows the loan (or person) it belongs to.
-- ---------------------------------------------------------------------------

create function public.can_see_property(property uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.properties p
    where p.id = property and public.can_see_loan(p.loan_id)
  );
$$;

alter table public.properties enable row level security;
alter table public.property_liens enable row level security;
alter table public.notes enable row level security;
alter table public.tasks enable row level security;

-- properties
create policy "members see properties on permitted loans"
  on public.properties for select to authenticated
  using (public.can_see_loan(loan_id));

create policy "members add properties to permitted loans"
  on public.properties for insert to authenticated
  with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));

create policy "members edit properties on permitted loans"
  on public.properties for update to authenticated
  using (public.can_see_loan(loan_id))
  with check (public.can_see_loan(loan_id));

create policy "members delete properties on permitted loans"
  on public.properties for delete to authenticated
  using (public.can_see_loan(loan_id));

-- property_liens
create policy "members see liens on permitted properties"
  on public.property_liens for select to authenticated
  using (public.can_see_property(property_id));

create policy "members add liens to permitted properties"
  on public.property_liens for insert to authenticated
  with check (public.can_see_property(property_id));

create policy "members edit liens on permitted properties"
  on public.property_liens for update to authenticated
  using (public.can_see_property(property_id))
  with check (public.can_see_property(property_id));

create policy "members delete liens on permitted properties"
  on public.property_liens for delete to authenticated
  using (public.can_see_property(property_id));

-- notes: anyone who can see the person can read and add notes; only the
-- author (or an owner/admin) can edit or delete one.
create policy "members see notes on permitted people"
  on public.notes for select to authenticated
  using (public.can_see_contact(contact_id));

create policy "members add notes to permitted people"
  on public.notes for insert to authenticated
  with check (
    public.can_see_contact(contact_id)
    and author_id = auth.uid()
    and (loan_id is null or public.can_see_loan(loan_id))
  );

create policy "authors and admins edit notes"
  on public.notes for update to authenticated
  using (
    public.can_see_contact(contact_id)
    and (author_id = auth.uid() or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  )
  with check (public.can_see_contact(contact_id));

create policy "authors and admins delete notes"
  on public.notes for delete to authenticated
  using (
    public.can_see_contact(contact_id)
    and (author_id = auth.uid() or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  );

-- tasks
create policy "members see tasks on permitted loans"
  on public.tasks for select to authenticated
  using (public.can_see_loan(loan_id));

create policy "members add tasks to permitted loans"
  on public.tasks for insert to authenticated
  with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));

create policy "members edit tasks on permitted loans"
  on public.tasks for update to authenticated
  using (public.can_see_loan(loan_id))
  with check (public.can_see_loan(loan_id));

create policy "members delete tasks on permitted loans"
  on public.tasks for delete to authenticated
  using (public.can_see_loan(loan_id));
