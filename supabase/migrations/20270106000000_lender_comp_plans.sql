-- MPS HQ: lender comp plans (build plan Phase 5, first part).
--
-- lender_comp_plans: how each lender pays the company, so a file's revenue can
-- be filled in from its lender instead of typed. One row per plan:
--   comp_type        lender_paid or borrower_paid
--   comp_pct         % of the loan amount (2.750 = 2.75%)
--   min_amount / max_amount   optional floor and cap, in dollars
--   fees             flat fees the lender passes through: [{ name, amount, adds }]
--                    (adds = true adds to comp, false takes it off)
--   effective_from / effective_to   a lender's comp change is a new plan, so
--                    older loans keep the plan they closed on
--   program_ids      null = every program; or the catalog programs it covers
--                    (e.g. a different plan on HELOCs)
-- Only one plan per lender and comp type can be active on a day for the same
-- programs (a trigger refuses overlapping dates; a plan for some programs and
-- one for every program can overlap, and the narrower one is used).
-- Everyone in the company reads plans; owners and admins edit (like the catalog).
-- loans.comp_plan_id: the plan a file's revenue came from (cleared if the plan
-- is deleted), shown in the register; changes are logged in loan_change_log.
-- Apply after the partner stages script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ lender comp plans installed").

create table if not exists public.lender_comp_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lender_id        uuid not null,
  comp_type        text not null check (comp_type in ('lender_paid', 'borrower_paid')),
  comp_pct         numeric(6, 3) not null check (comp_pct >= 0 and comp_pct <= 10),
  min_amount       numeric(12, 2) check (min_amount >= 0),
  max_amount       numeric(12, 2) check (max_amount >= 0),
  fees             jsonb not null default '[]'::jsonb check (jsonb_typeof(fees) = 'array'),
  effective_from   date not null,
  effective_to     date,
  program_ids      uuid[],
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lender_comp_plans_dates check (effective_to is null or effective_to >= effective_from),
  constraint lender_comp_plans_min_max check (min_amount is null or max_amount is null or max_amount >= min_amount),
  constraint lender_comp_plans_programs check (program_ids is null or cardinality(program_ids) > 0),
  constraint lender_comp_plans_id_organization_id_key unique (id, organization_id),
  constraint lender_comp_plans_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade,
  constraint lender_comp_plans_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index if not exists lender_comp_plans_lender_idx on public.lender_comp_plans (lender_id, effective_from desc);

alter table public.lender_comp_plans enable row level security;
drop policy if exists "members see lender comp plans" on public.lender_comp_plans;
create policy "members see lender comp plans" on public.lender_comp_plans
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add lender comp plans" on public.lender_comp_plans;
create policy "managers add lender comp plans" on public.lender_comp_plans
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit lender comp plans" on public.lender_comp_plans;
create policy "managers edit lender comp plans" on public.lender_comp_plans
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
drop policy if exists "managers remove lender comp plans" on public.lender_comp_plans;
create policy "managers remove lender comp plans" on public.lender_comp_plans
  for delete to authenticated using (public.is_org_manager(organization_id));

create or replace trigger lender_comp_plans_set_updated_at before update on public.lender_comp_plans for each row execute function public.set_updated_at();

-- One plan per lender, comp type and programs on any day.
create or replace function public.lender_comp_plans_no_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  clash record;
begin
  select p.effective_from, p.effective_to into clash
  from public.lender_comp_plans p
  where p.lender_id = new.lender_id
    and p.comp_type = new.comp_type
    and p.id <> new.id
    -- The same programs: both for every program, or sharing a program.
    and ((p.program_ids is null and new.program_ids is null) or (p.program_ids && new.program_ids))
    and p.effective_from <= coalesce(new.effective_to, 'infinity'::date)
    and coalesce(p.effective_to, 'infinity'::date) >= new.effective_from
  limit 1;
  if found then
    raise exception 'Another % plan for these programs is already active from % to %. End that plan first (set its last day), then add this one.',
      replace(new.comp_type, '_', '-'), clash.effective_from, coalesce(clash.effective_to::text, 'no end date');
  end if;
  return new;
end;
$$;

drop trigger if exists lender_comp_plans_no_overlap on public.lender_comp_plans;
create trigger lender_comp_plans_no_overlap before insert or update on public.lender_comp_plans
  for each row execute function public.lender_comp_plans_no_overlap();

alter table public.loans add column if not exists comp_plan_id uuid;
do $$ begin
  alter table public.loans add constraint loans_comp_plan_id_fkey
    foreign key (comp_plan_id) references public.lender_comp_plans (id) on delete set null;
exception when duplicate_object then null; end $$;

-- The change log (Phase 1) now also records which comp plan a file's revenue came from.
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
    ('comp_plan_id', old.comp_plan_id::text, new.comp_plan_id::text)
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
  'MPS HQ lender comp plans installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'lender_comp_plans') as plans_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'lender_comp_plans') as plan_policies,
  (select count(*) from pg_trigger where tgname = 'lender_comp_plans_no_overlap') as overlap_check,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name = 'comp_plan_id') as loan_plan_column,
  (select count(*) from pg_proc where proname = 'log_loan_changes' and prosrc like '%comp_plan_id%') as change_log;
