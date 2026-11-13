-- MPS HQ: confirming a closed loan's commission (Connor, 2026-11-13).
--
-- An owner or admin checks a closed loan's revenue and comp (the Comp panel)
-- and presses Confirm commission: who and when are recorded, and the numbers
-- the comp is worked out from are locked (revenue, loan amount, lead source,
-- the comp snapshot, the comp plan, the loan officer) until someone unlocks
-- it. "Paid on" records the payroll date and needs a confirmed commission;
-- clear it before unlocking. Every change is in loan_change_log.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ commission confirmation installed").

alter table public.loans
  add column if not exists comp_confirmed_at timestamptz,
  add column if not exists comp_confirmed_by uuid,
  add column if not exists comp_paid_on      date;

alter table public.loans drop constraint if exists loans_comp_confirmed_by_fkey;
alter table public.loans add constraint loans_comp_confirmed_by_fkey
  foreign key (comp_confirmed_by) references public.profiles (id) on delete set null;
alter table public.loans drop constraint if exists loans_comp_paid_needs_confirmed;
alter table public.loans add constraint loans_comp_paid_needs_confirmed check (comp_paid_on is null or comp_confirmed_at is not null);

-- Owners and admins only, for the lead source, the snapshot, confirming and paid on;
-- a confirmed commission's numbers don't change until it's unlocked.
create or replace function public.guard_loan_comp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new; -- The SQL Editor and service jobs aren't limited.
  end if;
  if coalesce(current_setting('mps.comp_snapshot', true), '') <> 'on'
    and (new.lead_source_type, new.comp_base_mode, new.comp_base_bps, new.comp_split_pct, new.comp_member_type, new.comp_snapshot_at)
      is distinct from (old.lead_source_type, old.comp_base_mode, old.comp_base_bps, old.comp_split_pct, old.comp_member_type, old.comp_snapshot_at)
    and not public.is_org_manager(new.organization_id) then
    raise exception 'Only owners and admins can change the lead source or the comp on a loan.';
  end if;
  if (new.comp_confirmed_at, new.comp_paid_on) is distinct from (old.comp_confirmed_at, old.comp_paid_on) and not public.is_org_manager(new.organization_id) then
    raise exception 'Only owners and admins can confirm a commission or mark it paid.';
  end if;
  -- Locked while confirmed (and staying confirmed).
  if old.comp_confirmed_at is not null and new.comp_confirmed_at is not null
    and (new.revenue_type, new.revenue_value, new.loan_amount, new.lead_source_type, new.comp_base_mode, new.comp_base_bps, new.comp_split_pct, new.comp_member_type, new.comp_plan_id, new.assigned_lo_id)
      is distinct from (old.revenue_type, old.revenue_value, old.loan_amount, old.lead_source_type, old.comp_base_mode, old.comp_base_bps, old.comp_split_pct, old.comp_member_type, old.comp_plan_id, old.assigned_lo_id) then
    raise exception 'This commission is confirmed. Unlock it on the Comp panel before changing the revenue, loan amount, lead source, comp or loan officer.';
  end if;
  -- Confirming: a closed loan with its revenue and comp snapshot; who confirmed is recorded here.
  if old.comp_confirmed_at is null and new.comp_confirmed_at is not null then
    if new.stage <> 'closed' or new.revenue_value is null or new.comp_snapshot_at is null then
      raise exception 'Only a closed loan with its revenue and comp saved can be confirmed.';
    end if;
    new.comp_confirmed_at := now();
    new.comp_confirmed_by := auth.uid();
  elsif new.comp_confirmed_at is null then
    new.comp_confirmed_by := null;
  else
    new.comp_confirmed_by := old.comp_confirmed_by;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_loan_comp() from public, anon, authenticated;
drop trigger if exists loans_guard_comp on public.loans;
create trigger loans_guard_comp before update on public.loans
  for each row execute function public.guard_loan_comp();

-- The change log also covers confirming and paid on.
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
    ('assigned_lo_id', old.assigned_lo_id::text, new.assigned_lo_id::text),
    ('comp_plan_id', old.comp_plan_id::text, new.comp_plan_id::text),
    ('lead_source_type', old.lead_source_type, new.lead_source_type),
    ('comp_base_mode', old.comp_base_mode, new.comp_base_mode),
    ('comp_base_bps', old.comp_base_bps::text, new.comp_base_bps::text),
    ('comp_split_pct', old.comp_split_pct::text, new.comp_split_pct::text),
    ('comp_member_type', old.comp_member_type, new.comp_member_type),
    ('comp_confirmed_at', old.comp_confirmed_at::text, new.comp_confirmed_at::text),
    ('comp_paid_on', old.comp_paid_on::text, new.comp_paid_on::text),
    ('review_status', old.review_status, new.review_status),
    ('review_received_on', old.review_received_on::text, new.review_received_on::text),
    ('review_skip', old.review_skip::text, new.review_skip::text)
  ) as f(field, old_value, new_value)
  where f.old_value is distinct from f.new_value;
  return new;
end;
$$;

revoke all on function public.log_loan_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ commission confirmation installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('comp_confirmed_at', 'comp_confirmed_by', 'comp_paid_on')) as columns,
  (select count(*) from pg_trigger where tgname in ('loans_guard_comp', 'loans_log_changes')) as triggers;
