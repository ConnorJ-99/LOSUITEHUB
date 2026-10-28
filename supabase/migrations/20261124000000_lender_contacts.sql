-- LOSuite: lender contacts (lender detail page, mockup 09).
--
-- A lender's account executive stays on the lender (one place). This table
-- holds everyone else Connor works with there: the scenario desk, broker
-- support, underwriting, closing. Everyone in the company sees them; owners
-- and admins add, change and remove them, like the lender itself. Deleting a
-- lender deletes its contacts.
-- Apply to the DEV Supabase project only, after the program terms script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite lender contacts installed").

create table if not exists public.lender_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lender_id        uuid not null,
  name             text not null check (length(trim(name)) > 0),
  -- e.g. "Scenario desk", "Broker support", "Underwriting", "Closing".
  role             text not null default 'Other' check (length(trim(role)) > 0),
  phone            text,
  email            text,
  notes            text,
  sort_order       integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lender_contacts_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint lender_contacts_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade
);

create index if not exists lender_contacts_lender_id_idx on public.lender_contacts (lender_id, sort_order);

create or replace trigger lender_contacts_set_updated_at
  before update on public.lender_contacts
  for each row execute function public.set_updated_at();

alter table public.lender_contacts enable row level security;
drop policy if exists "members see lender contacts" on public.lender_contacts;
create policy "members see lender contacts" on public.lender_contacts
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add lender contacts" on public.lender_contacts;
create policy "managers add lender contacts" on public.lender_contacts
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit lender contacts" on public.lender_contacts;
create policy "managers edit lender contacts" on public.lender_contacts
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
drop policy if exists "managers remove lender contacts" on public.lender_contacts;
create policy "managers remove lender contacts" on public.lender_contacts
  for delete to authenticated using (public.is_org_manager(organization_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite lender contacts installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'lender_contacts') as contacts_table,
  (select count(*) from pg_policies where tablename = 'lender_contacts') as policies;
