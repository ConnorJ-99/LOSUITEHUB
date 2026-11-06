-- MPS HQ: Refi Watch, step 1 (benchmark pricing).
--
-- refi_benchmark_scenarios  the standard scenarios an admin prices (Settings ›
--                           Refi Watch). Seeded with Connor's five for every
--                           company. A scenario that has been priced can't be
--                           deleted, only turned off (active = false).
-- refi_benchmark_runs       one row per Mon/Wed/Fri pricing run (or a run an
--                           admin starts by hand): open, saved or skipped. A
--                           skipped (or never answered) run means screening
--                           keeps the last saved set and alerts say
--                           "Stale pricing" until the next save.
-- refi_benchmarks           what was priced: rate, points (negative = credit)
--                           and lender per scenario per day.
-- save_refi_benchmarks()    saves a run's pricing and closes the admin task.
-- skip_refi_benchmark_run() skips the open run and closes the admin task.
-- scheduled_refi_benchmark_task()  pg_cron, Mon/Wed/Fri 8:00 AM Central:
--                           opens a run and gives each Admin a "Price refi
--                           benchmarks" task on their Today page.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ Refi Watch benchmarks installed").

-- ---------------------------------------------------------------------------
-- 1. Scenarios
-- ---------------------------------------------------------------------------

create table if not exists public.refi_benchmark_scenarios (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- Set on the seeded five so re-running never adds them twice; null for ones added in Settings.
  seed_key          text,
  name              text not null check (length(trim(name)) > 0),
  program           text not null check (program in ('conventional', 'fha')),
  purpose           text not null check (purpose in ('rate_term', 'streamline')),
  fico              integer not null check (fico between 300 and 850),
  -- Null for an FHA Streamline (no appraisal, so no LTV).
  ltv               numeric(5, 2) check (ltv is null or (ltv > 0 and ltv <= 125)),
  -- The scenario FHA loans are compared against for MIP removal (one per company).
  mip_removal       boolean not null default false,
  active            boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint refi_benchmark_scenarios_streamline_program check (purpose <> 'streamline' or program = 'fha'),
  constraint refi_benchmark_scenarios_ltv_needed check (purpose = 'streamline' or ltv is not null),
  constraint refi_benchmark_scenarios_mip_conv check (not mip_removal or program = 'conventional'),
  unique (id, organization_id)
);

create unique index if not exists refi_benchmark_scenarios_seed_idx on public.refi_benchmark_scenarios (organization_id, seed_key) where seed_key is not null;
create unique index if not exists refi_benchmark_scenarios_one_mip_idx on public.refi_benchmark_scenarios (organization_id) where mip_removal;

drop trigger if exists refi_benchmark_scenarios_set_updated_at on public.refi_benchmark_scenarios;
create trigger refi_benchmark_scenarios_set_updated_at
  before update on public.refi_benchmark_scenarios
  for each row execute function public.set_updated_at();

alter table public.refi_benchmark_scenarios enable row level security;

drop policy if exists "members read refi scenarios" on public.refi_benchmark_scenarios;
create policy "members read refi scenarios"
  on public.refi_benchmark_scenarios for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "owners and admins add refi scenarios" on public.refi_benchmark_scenarios;
create policy "owners and admins add refi scenarios"
  on public.refi_benchmark_scenarios for insert to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists "owners and admins edit refi scenarios" on public.refi_benchmark_scenarios;
create policy "owners and admins edit refi scenarios"
  on public.refi_benchmark_scenarios for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists "owners and admins delete refi scenarios" on public.refi_benchmark_scenarios;
create policy "owners and admins delete refi scenarios"
  on public.refi_benchmark_scenarios for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Connor's five, for every company that doesn't have them yet.
create or replace function public.seed_refi_benchmark_scenarios(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.refi_benchmark_scenarios (organization_id, seed_key, name, program, purpose, fico, ltv, mip_removal, sort_order)
  select p_org, s.seed_key, s.name, s.program, s.purpose, s.fico, s.ltv, s.mip_removal, s.sort_order
  from (values
    ('conv_720_90', 'Conventional R/T', 'conventional', 'rate_term', 720, 90::numeric, false, 1),
    ('conv_660_90', 'Conventional R/T', 'conventional', 'rate_term', 660, 90::numeric, false, 2),
    ('conv_720_80', 'Conventional R/T', 'conventional', 'rate_term', 720, 80::numeric, true, 3),
    ('fha_640_975', 'FHA R/T', 'fha', 'rate_term', 640, 97.5::numeric, false, 4),
    ('fha_streamline_640', 'FHA Streamline', 'fha', 'streamline', 640, null::numeric, false, 5)
  ) as s (seed_key, name, program, purpose, fico, ltv, mip_removal, sort_order)
  where not exists (select 1 from public.refi_benchmark_scenarios x where x.organization_id = p_org and x.seed_key = s.seed_key)
    -- A company that already picked its own MIP-removal scenario keeps it.
    and not (s.mip_removal and exists (select 1 from public.refi_benchmark_scenarios x where x.organization_id = p_org and x.mip_removal));
$$;

revoke all on function public.seed_refi_benchmark_scenarios(uuid) from public;
revoke all on function public.seed_refi_benchmark_scenarios(uuid) from anon, authenticated;

select public.seed_refi_benchmark_scenarios(id) from public.organizations;

-- ---------------------------------------------------------------------------
-- 2. Runs
-- ---------------------------------------------------------------------------

create table if not exists public.refi_benchmark_runs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  -- The day the run was for (Central time).
  run_date          date not null,
  -- scheduled = made by the Mon/Wed/Fri timer; manual = an admin priced outside the schedule.
  kind              text not null default 'scheduled' check (kind in ('scheduled', 'manual')),
  -- open = waiting for the admin; missed = the next run came before anyone answered (counts as skipped).
  status            text not null default 'open' check (status in ('open', 'saved', 'skipped', 'missed')),
  acted_by          uuid references public.profiles (id) on delete set null,
  acted_at          timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, organization_id)
);

-- One scheduled run per company per day.
create unique index if not exists refi_benchmark_runs_one_scheduled_idx on public.refi_benchmark_runs (organization_id, run_date) where kind = 'scheduled';
create index if not exists refi_benchmark_runs_latest_idx on public.refi_benchmark_runs (organization_id, created_at desc);

alter table public.refi_benchmark_runs enable row level security;

-- Everyone in the company reads runs (an alert's "Stale pricing" badge comes from here).
-- Changes go through the functions below only.
drop policy if exists "members read refi runs" on public.refi_benchmark_runs;
create policy "members read refi runs"
  on public.refi_benchmark_runs for select to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- 3. Benchmarks
-- ---------------------------------------------------------------------------

create table if not exists public.refi_benchmarks (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  run_id            uuid,
  benchmark_date    date not null,
  scenario_id       uuid not null,
  rate              numeric(6, 3) not null check (rate > 0 and rate < 20),
  -- Points the borrower pays; negative = a lender credit.
  points_or_credit  numeric(6, 3) not null default 0 check (points_or_credit between -10 and 10),
  lender            text,
  entered_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  -- A priced scenario can't be deleted; turn it off instead.
  constraint refi_benchmarks_scenario_fkey
    foreign key (scenario_id, organization_id) references public.refi_benchmark_scenarios (id, organization_id) on delete restrict,
  constraint refi_benchmarks_run_fkey
    foreign key (run_id, organization_id) references public.refi_benchmark_runs (id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create index if not exists refi_benchmarks_latest_idx on public.refi_benchmarks (scenario_id, created_at desc);
create index if not exists refi_benchmarks_run_idx on public.refi_benchmarks (run_id);

alter table public.refi_benchmarks enable row level security;

drop policy if exists "members read refi benchmarks" on public.refi_benchmarks;
create policy "members read refi benchmarks"
  on public.refi_benchmarks for select to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- 4. Save and skip (owners and admins)
-- ---------------------------------------------------------------------------

-- Closes every open "Price refi benchmarks" task in the company, whoever it's assigned to.
create or replace function public.close_refi_benchmark_tasks(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tasks set completed_at = now()
  where organization_id = p_org and loan_id is null and completed_at is null and source_key like 'refi_benchmarks:%';
$$;

revoke all on function public.close_refi_benchmark_tasks(uuid) from public;
revoke all on function public.close_refi_benchmark_tasks(uuid) from anon, authenticated;

-- p_rows: [{ "scenario_id": "...", "rate": 6.375, "points_or_credit": 0, "lender": "..." }, ...]
-- Rows with no rate are left out; those scenarios keep their last price.
-- Saves into today's open run, else a new manual run. Returns the run id.
create or replace function public.save_refi_benchmarks(p_org uuid, p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_run uuid;
  v_count integer;
begin
  if not public.has_org_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only an owner or admin can price refi benchmarks.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'No pricing was sent.';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_rows) r where nullif(r ->> 'rate', '') is not null;
  if v_count = 0 then
    raise exception 'Enter at least one rate.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where nullif(r ->> 'rate', '') is not null
      and not exists (select 1 from public.refi_benchmark_scenarios s where s.id = (r ->> 'scenario_id')::uuid and s.organization_id = p_org)
  ) then
    raise exception 'A scenario in this pricing doesn''t belong to your company.';
  end if;

  -- The open run (the newest one), else a manual run for today.
  select id into v_run from public.refi_benchmark_runs
  where organization_id = p_org and status = 'open'
  order by created_at desc limit 1;
  if v_run is null then
    insert into public.refi_benchmark_runs (organization_id, run_date, kind, status)
    values (p_org, v_today, 'manual', 'open') returning id into v_run;
  end if;

  insert into public.refi_benchmarks (organization_id, run_id, benchmark_date, scenario_id, rate, points_or_credit, lender, entered_by)
  select p_org, v_run, v_today, (r ->> 'scenario_id')::uuid, (r ->> 'rate')::numeric,
         coalesce(nullif(r ->> 'points_or_credit', '')::numeric, 0), nullif(trim(r ->> 'lender'), ''), auth.uid()
  from jsonb_array_elements(p_rows) r
  where nullif(r ->> 'rate', '') is not null;

  update public.refi_benchmark_runs set status = 'saved', acted_by = auth.uid(), acted_at = now() where id = v_run;
  -- Older runs nobody answered are done with too.
  update public.refi_benchmark_runs set status = 'missed' where organization_id = p_org and status = 'open';
  perform public.close_refi_benchmark_tasks(p_org);
  return v_run;
end;
$$;

revoke all on function public.save_refi_benchmarks(uuid, jsonb) from public;
revoke all on function public.save_refi_benchmarks(uuid, jsonb) from anon;
grant execute on function public.save_refi_benchmarks(uuid, jsonb) to authenticated;

-- Skips the open run: screening keeps the last saved set, now marked stale.
create or replace function public.skip_refi_benchmark_run(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(p_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only an owner or admin can skip a refi benchmark run.';
  end if;
  if not exists (select 1 from public.refi_benchmark_runs where organization_id = p_org and status = 'open') then
    raise exception 'There''s no pricing run waiting to be skipped.';
  end if;
  update public.refi_benchmark_runs set status = 'skipped', acted_by = auth.uid(), acted_at = now()
  where organization_id = p_org and status = 'open';
  perform public.close_refi_benchmark_tasks(p_org);
end;
$$;

revoke all on function public.skip_refi_benchmark_run(uuid) from public;
revoke all on function public.skip_refi_benchmark_run(uuid) from anon;
grant execute on function public.skip_refi_benchmark_run(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Mon/Wed/Fri 8:00 AM Central task
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

-- pg_cron runs on UTC, so the job fires at 13:00 and 14:00 UTC and only the
-- one that is 8 AM in Chicago (summer or winter time) does anything.
-- p_force skips the clock check (for testing in the SQL Editor).
create or replace function public.scheduled_refi_benchmark_task(p_force boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := now() at time zone 'America/Chicago';
  v_today date := v_local::date;
  v_org record;
  v_admin record;
  v_run uuid;
  v_tasks integer := 0;
  v_runs integer := 0;
  v_no_admin integer := 0;
begin
  if not p_force and (extract(hour from v_local) <> 8 or extract(isodow from v_local) not in (1, 3, 5)) then
    return 'Not 8 AM Mon/Wed/Fri in Chicago; nothing to do.';
  end if;

  for v_org in select o.id from public.organizations o
    where exists (select 1 from public.refi_benchmark_scenarios s where s.organization_id = o.id and s.active)
  loop
    if exists (select 1 from public.refi_benchmark_runs where organization_id = v_org.id and run_date = v_today and kind = 'scheduled') then
      continue;
    end if;
    -- The run before this one that nobody answered counts as skipped.
    update public.refi_benchmark_runs set status = 'missed' where organization_id = v_org.id and status = 'open';
    perform public.close_refi_benchmark_tasks(v_org.id);
    insert into public.refi_benchmark_runs (organization_id, run_date, kind, status)
    values (v_org.id, v_today, 'scheduled', 'open') returning id into v_run;
    v_runs := v_runs + 1;

    if not exists (select 1 from public.organization_members m where m.organization_id = v_org.id and m.role = 'admin') then
      v_no_admin := v_no_admin + 1;
    end if;
    for v_admin in select m.user_id from public.organization_members m where m.organization_id = v_org.id and m.role = 'admin'
    loop
      insert into public.tasks (organization_id, loan_id, title, due_on, assigned_to, created_by, action, source_key)
      values (v_org.id, null, 'Price refi benchmarks', v_today, v_admin.user_id, v_admin.user_id, 'other', 'refi_benchmarks:' || v_today);
      v_tasks := v_tasks + 1;
    end loop;
  end loop;

  return 'Opened ' || v_runs || ' run(s) and made ' || v_tasks || ' task(s)'
    || case when v_no_admin > 0 then '; ' || v_no_admin || ' company(ies) have no Admin to give the task to.' else '.' end;
end;
$$;

revoke all on function public.scheduled_refi_benchmark_task(boolean) from public;
revoke all on function public.scheduled_refi_benchmark_task(boolean) from anon, authenticated;

-- Scheduling the same name again replaces it.
select cron.schedule('mpshq-refi-benchmark-task', '0 13,14 * * 1,3,5', 'select public.scheduled_refi_benchmark_task()');

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ Refi Watch benchmarks installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('refi_benchmark_scenarios', 'refi_benchmark_runs', 'refi_benchmarks')) as tables,
  (select count(*) from public.refi_benchmark_scenarios where seed_key is not null) as seeded_scenarios,
  (select count(*) from public.organizations) as companies,
  (select count(*) from pg_proc where proname in ('save_refi_benchmarks', 'skip_refi_benchmark_run', 'scheduled_refi_benchmark_task')) as functions,
  (select count(*) from cron.job where jobname = 'mpshq-refi-benchmark-task') as scheduled_jobs;
