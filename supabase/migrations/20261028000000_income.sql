-- LOSuite Phase 4: the income calculator.
--
-- Each worksheet keeps the numbers the LO typed (from pay stubs, W-2s, tax
-- returns or bank statements) so the math can be reopened and explained.
-- The qualifying figure itself still lives in one place: the job on the
-- 1003 (employments) or the property (rental income). "Push to 1003" copies
-- the worksheet result there and records what was pushed and when.
-- Apply to the DEV Supabase project only. Safe to run more than once: each
-- step skips what already exists. A full run ends with a confirmation row
-- ("LOSuite Phase 4 installed"); if you do not see it, the whole script did not run.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.income_worksheet_kind as enum (
    'salary', 'hourly', 'variable', 'schedule_c', 's_corp', 'partnership', 'bank_statement', 'rental'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.rental_income_method as enum ('lease', 'schedule_e');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Rental income on properties: 75% of the lease, or the Schedule E figure
-- ---------------------------------------------------------------------------

alter table public.properties
  add column if not exists rental_income_method      public.rental_income_method not null default 'lease',
  -- Schedule E monthly income before the property's payment (can be negative).
  add column if not exists schedule_e_monthly_income numeric(12, 2);

-- Lets a worksheet point at a job that belongs to the same person.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employments_id_contact_id_key') then
    alter table public.employments add constraint employments_id_contact_id_key unique (id, contact_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- income_worksheets: one calculation for one borrower on one loan
-- ---------------------------------------------------------------------------

create table if not exists public.income_worksheets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  -- The borrower whose income this is; must be a borrower on this loan.
  contact_id       uuid not null,
  kind             public.income_worksheet_kind not null,
  label            text,
  -- The numbers typed into the worksheet (shape depends on kind).
  inputs           jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object'),
  -- Latest calculated monthly figure, for lists and the divergence notice.
  result_monthly   numeric(14, 2),
  -- Where "Push to 1003" sends the result: a job, or a property for rental income.
  employment_id    uuid,
  property_id      uuid,
  pushed_monthly   numeric(14, 2),
  pushed_at        timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its worksheets.
  constraint income_worksheets_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  -- Removing the borrower from the loan removes their worksheets.
  constraint income_worksheets_loan_borrower_fkey
    foreign key (loan_id, contact_id) references public.loan_borrowers (loan_id, contact_id) on delete cascade,
  -- The job must be this borrower's; deleting the job just clears the link.
  constraint income_worksheets_employment_id_fkey
    foreign key (employment_id, contact_id) references public.employments (id, contact_id) on delete set null (employment_id),
  -- The property must be on this loan; deleting it just clears the link.
  constraint income_worksheets_property_id_fkey
    foreign key (property_id, loan_id) references public.properties (id, loan_id) on delete set null (property_id),
  constraint income_worksheets_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint income_worksheets_rental_targets_property check (kind = 'rental' or property_id is null),
  constraint income_worksheets_job_targets_employment check (kind <> 'rental' or employment_id is null)
);

create index if not exists income_worksheets_loan_id_idx on public.income_worksheets (loan_id);

create or replace trigger income_worksheets_set_updated_at
  before update on public.income_worksheets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: same people who can see the loan
-- ---------------------------------------------------------------------------

alter table public.income_worksheets enable row level security;

drop policy if exists "members see worksheets on permitted loans" on public.income_worksheets;
create policy "members see worksheets on permitted loans" on public.income_worksheets
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add worksheets to permitted loans" on public.income_worksheets;
create policy "members add worksheets to permitted loans" on public.income_worksheets
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit worksheets on permitted loans" on public.income_worksheets;
create policy "members edit worksheets on permitted loans" on public.income_worksheets
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members delete worksheets on permitted loans" on public.income_worksheets;
create policy "members delete worksheets on permitted loans" on public.income_worksheets
  for delete to authenticated using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite Phase 4 installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables;
