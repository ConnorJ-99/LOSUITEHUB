-- MPS HQ: actual closing and funding dates (build plan Phase 1).
--
-- Marking a loan Closed only stamped stage_changed_at, so a loan that funded
-- Friday and was marked closed Monday reported on Monday.
--   loans.funding_date   the day the loan funded (closing_date stays the one closing date).
--   loan_change_log      an append-only log of changes to closing_date,
--                        funding_date, revenue_type, revenue_value and
--                        assigned_lo_id: written only by a trigger, read by
--                        whoever can see the loan, never edited or deleted.
--   close_loan()         Mark as Closed: the dates and the stage are saved together.
--   set_loan_dates()     corrects the dates on a closed file later (logged only).
-- Both take an optional reason, which the log keeps with each change.
-- stage_changed_at and loan_stage_history are unchanged and stay the system
-- record of when the status changed.
-- Apply after the product updates script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ closing and funding dates installed").

alter table public.loans add column if not exists funding_date date;

create table if not exists public.loan_change_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  field            text not null check (length(trim(field)) > 0),
  old_value        text,
  new_value        text,
  changed_by       uuid,
  changed_at       timestamptz not null default now(),
  reason           text,
  constraint loan_change_log_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint loan_change_log_loan_id_fkey
    foreign key (loan_id) references public.loans (id) on delete cascade,
  constraint loan_change_log_changed_by_fkey
    foreign key (changed_by) references public.profiles (id) on delete set null
);

create index if not exists loan_change_log_loan_idx on public.loan_change_log (loan_id, changed_at desc);

alter table public.loan_change_log enable row level security;
drop policy if exists "members see changes on loans they can see" on public.loan_change_log;
create policy "members see changes on loans they can see" on public.loan_change_log
  for select to authenticated using (public.can_see_loan(loan_id));
-- No insert, update or delete policy: only the trigger writes, and nothing is changed afterwards.
revoke insert, update, delete on public.loan_change_log from anon, authenticated;

-- The fields Phase 5 adds (comp plan and snapshot) join this list when they exist.
create or replace function public.log_loan_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(trim(current_setting('mps.change_reason', true)), '');
  v_by uuid := auth.uid();
begin
  insert into public.loan_change_log (organization_id, loan_id, field, old_value, new_value, changed_by, reason)
  select new.organization_id, new.id, f.field, f.old_value, f.new_value, v_by, v_reason
  from (values
    ('closing_date', old.closing_date::text, new.closing_date::text),
    ('funding_date', old.funding_date::text, new.funding_date::text),
    ('revenue_type', old.revenue_type::text, new.revenue_type::text),
    ('revenue_value', old.revenue_value::text, new.revenue_value::text),
    ('assigned_lo_id', old.assigned_lo_id::text, new.assigned_lo_id::text)
  ) as f(field, old_value, new_value)
  where f.old_value is distinct from f.new_value;
  return new;
end;
$$;

revoke all on function public.log_loan_changes() from public, anon, authenticated;

drop trigger if exists loans_log_changes on public.loans;
create trigger loans_log_changes after update on public.loans
  for each row execute function public.log_loan_changes();

-- ---------------------------------------------------------------------------
-- Mark as Closed with the dates, and correct the dates later.
-- Both run as the signed-in user, so the file rule decides who can.
-- ---------------------------------------------------------------------------

create or replace function public.close_loan(p_loan_id uuid, p_closing_date date, p_funding_date date, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_closing_date is null or p_funding_date is null then raise exception 'Enter both the closed and funded dates.'; end if;
  if p_funding_date < p_closing_date then raise exception 'The funded date can''t be before the closed date.'; end if;
  perform set_config('mps.change_reason', coalesce(p_reason, ''), true);
  update public.loans set stage = 'closed', closing_date = p_closing_date, funding_date = p_funding_date, lost_reason = null where id = p_loan_id;
  if not found then raise exception 'You do not have permission to change this loan.'; end if;
  perform set_config('mps.change_reason', '', true);
end;
$$;

revoke all on function public.close_loan(uuid, date, date, text) from public, anon;
grant execute on function public.close_loan(uuid, date, date, text) to authenticated;

create or replace function public.set_loan_dates(p_loan_id uuid, p_closing_date date, p_funding_date date, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_funding_date < p_closing_date then raise exception 'The funded date can''t be before the closed date.'; end if;
  perform set_config('mps.change_reason', coalesce(p_reason, ''), true);
  update public.loans set closing_date = p_closing_date, funding_date = p_funding_date where id = p_loan_id;
  if not found then raise exception 'You do not have permission to change this loan.'; end if;
  perform set_config('mps.change_reason', '', true);
end;
$$;

revoke all on function public.set_loan_dates(uuid, date, date, text) from public, anon;
grant execute on function public.set_loan_dates(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ closing and funding dates installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name = 'funding_date') as funding_date_column,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'loan_change_log') as change_log_table,
  (select count(*) from pg_trigger where tgname = 'loans_log_changes') as change_trigger,
  (select count(*) from pg_proc where proname in ('close_loan', 'set_loan_dates')) as date_functions;
