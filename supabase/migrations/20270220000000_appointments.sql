-- Appointments booked from MPS HQ (Connor, 2026-11-18): from a client's text
-- thread, the file's loan officer (or an admin) books a time on the loan
-- officer's own GHL calendar. GHL holds the calendar; this table is MPS HQ's
-- record of each booking so it can show on the file and on Today.
--
-- Rows are written only by the `ghl` Edge Function (service role), after GHL
-- has booked the time. Whoever can see the file can see its appointments;
-- nobody edits them from the app.
--
-- Safe to run more than once. A full run ends with a confirmation row.

create table if not exists public.appointments (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  loan_id             uuid not null,
  contact_id          uuid not null,
  -- The loan officer whose calendar it's on, and who booked it.
  lo_user_id          uuid,
  booked_by           uuid,
  ghl_calendar_id     text not null check (length(trim(ghl_calendar_id)) > 0),
  ghl_appointment_id  text not null check (length(trim(ghl_appointment_id)) > 0),
  title               text not null check (length(trim(title)) > 0),
  notes               text,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  status              text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at          timestamptz not null default now(),
  constraint appointments_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint appointments_loan_id_fkey
    foreign key (loan_id) references public.loans (id) on delete cascade,
  constraint appointments_contact_id_fkey
    foreign key (contact_id) references public.contacts (id) on delete cascade,
  constraint appointments_lo_user_id_fkey
    foreign key (lo_user_id) references public.profiles (id) on delete set null,
  constraint appointments_booked_by_fkey
    foreign key (booked_by) references public.profiles (id) on delete set null,
  constraint appointments_one_per_ghl_appointment unique (organization_id, ghl_appointment_id),
  constraint appointments_ends_after_start check (ends_at > starts_at)
);

create index if not exists appointments_loan_idx on public.appointments (loan_id, starts_at);
create index if not exists appointments_lo_day_idx on public.appointments (lo_user_id, starts_at);

alter table public.appointments enable row level security;
drop policy if exists "people on the file see its appointments" on public.appointments;
create policy "people on the file see its appointments" on public.appointments
  for select to authenticated using (public.can_see_loan(loan_id));
-- No insert, update or delete policies: only the ghl function (service role) writes.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ appointments installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'appointments') as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'appointments') as policies;
