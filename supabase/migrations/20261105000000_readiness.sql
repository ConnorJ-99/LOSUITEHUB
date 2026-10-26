-- LOSuite: call notes to pre-qual, part 4a (the readiness result).
--
-- Adds how income will be documented and the buyer's timeline to loans, and
-- a credit_events list on each person (bankruptcies, foreclosures, short
-- sales, deeds in lieu, late payments, collections). The readiness result
-- itself is worked out in code from these and the prequal, never stored.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite readiness installed").

do $$ begin
  create type public.income_doc_type as enum ('full_doc', 'bank_statement', 'form_1099', 'asset_based', 'dscr');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.credit_event_type as enum ('bankruptcy_ch7', 'bankruptcy_ch13', 'foreclosure', 'short_sale', 'deed_in_lieu', 'late_payment', 'collection');
exception when duplicate_object then null;
end $$;

alter table public.loans
  -- Null = not decided yet (treated as full documentation).
  add column if not exists income_doc_type public.income_doc_type,
  -- When they want to buy or refinance, in their words (e.g. "3-6 months, after the lease ends").
  add column if not exists timeline        text;

-- ---------------------------------------------------------------------------
-- credit_events: person facts, so they follow the person to every loan
-- ---------------------------------------------------------------------------

create table if not exists public.credit_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  event_type       public.credit_event_type not null,
  -- Discharge or completion date for bankruptcies, foreclosures, short sales and deeds in lieu;
  -- the month of a late payment; null when not known yet.
  event_date       date,
  -- Late payments only.
  days_late        smallint check (days_late in (30, 60, 90, 120)),
  is_mortgage      boolean not null default false,
  -- Collections only.
  amount           numeric(12, 2) check (amount >= 0),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting the person deletes their credit events.
  constraint credit_events_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint credit_events_late_needs_days
    check (event_type <> 'late_payment' or days_late is not null)
);

create index if not exists credit_events_contact_id_idx on public.credit_events (contact_id);

create or replace trigger credit_events_set_updated_at
  before update on public.credit_events
  for each row execute function public.set_updated_at();

alter table public.credit_events enable row level security;

drop policy if exists "members see credit events of permitted people" on public.credit_events;
create policy "members see credit events of permitted people" on public.credit_events
  for select to authenticated using (public.can_see_contact(contact_id));
drop policy if exists "members add credit events to permitted people" on public.credit_events;
create policy "members add credit events to permitted people" on public.credit_events
  for insert to authenticated with check (public.can_see_contact(contact_id) and public.is_org_member(organization_id));
drop policy if exists "members edit credit events of permitted people" on public.credit_events;
create policy "members edit credit events of permitted people" on public.credit_events
  for update to authenticated using (public.can_see_contact(contact_id)) with check (public.can_see_contact(contact_id));
drop policy if exists "members delete credit events of permitted people" on public.credit_events;
create policy "members delete credit events of permitted people" on public.credit_events
  for delete to authenticated using (public.can_see_contact(contact_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite readiness installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('income_doc_type', 'timeline')) as loan_columns,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'credit_events') as policies;
