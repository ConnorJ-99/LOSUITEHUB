-- LOSuite: conditions on a file (next build, Session 1; docs/plans/next-build.md decision 8).
--
-- loan_conditions: one row per underwriting condition, for tracking only
-- (no uploads): its text, who it's on, its status, a due date and notes.
-- status_changed_at is kept for the borrower reminders in Session 4. Anyone
-- who can see the loan sees and edits its conditions; deleting the loan
-- deletes them.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite loan conditions installed").

do $$ begin create type public.condition_party as enum ('borrower', 'title', 'realtor', 'processor_lo', 'appraisal'); exception when duplicate_object then null; end $$;
do $$ begin create type public.condition_status as enum ('outstanding', 'requested', 'received', 'submitted', 'cleared', 'waived'); exception when duplicate_object then null; end $$;

create table if not exists public.loan_conditions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  loan_id            uuid not null,
  position           integer not null default 0,
  body               text not null check (length(trim(body)) > 0),
  party              public.condition_party not null default 'borrower',
  status             public.condition_status not null default 'outstanding',
  due_on             date,
  notes              text,
  status_changed_at  timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint loan_conditions_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_conditions_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index if not exists loan_conditions_loan_idx on public.loan_conditions (loan_id, position);

create or replace trigger loan_conditions_set_updated_at
  before update on public.loan_conditions
  for each row execute function public.set_updated_at();

-- When the status changes, remember when (reminders count from it).
create or replace function public.stamp_condition_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_condition_status() from public;

drop trigger if exists loan_conditions_stamp_status on public.loan_conditions;
create trigger loan_conditions_stamp_status
  before update of status on public.loan_conditions
  for each row execute function public.stamp_condition_status();

alter table public.loan_conditions enable row level security;

drop policy if exists "members see conditions on permitted loans" on public.loan_conditions;
create policy "members see conditions on permitted loans" on public.loan_conditions
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add conditions on permitted loans" on public.loan_conditions;
create policy "members add conditions on permitted loans" on public.loan_conditions
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit conditions on permitted loans" on public.loan_conditions;
create policy "members edit conditions on permitted loans" on public.loan_conditions
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members remove conditions on permitted loans" on public.loan_conditions;
create policy "members remove conditions on permitted loans" on public.loan_conditions
  for delete to authenticated using (public.can_see_loan(loan_id));

select
  'LOSuite loan conditions installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'loan_conditions') as conditions_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'loan_conditions') as policies;
