-- LOSuite Phase 1b: loan file workspace.
--
-- loan_milestones:    the date each processing milestone was reached.
--                     Reaching one moves the file forward to its pipeline
--                     stage (never backward); the move is logged like any
--                     stage change. This trigger holds the one mapping.
-- loan_team_members:  processor, lender AE, title/escrow and agents per file.
--                     The loan officer stays loans.assigned_lo_id.
-- step_templates:     default workflow steps per loan purpose (Settings).
-- loan_steps:         per file, steps marked done (with date) or not applicable.
--                     "Ready" and "Blocked" are worked out in code, not stored.
-- loans.arive_loan_number: the file's number in Arive.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite loan file installed").

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.loan_milestone as enum (
    'application', 'disclosures_sent', 'submitted', 'in_underwriting', 'approved_conditions',
    'conditions_submitted', 'clear_to_close', 'docs_out', 'closed', 'funded'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.team_role as enum ('processor', 'lender_ae', 'title', 'escrow_officer', 'buyer_agent', 'listing_agent');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.step_group as enum ('origination', 'disclosure_setup', 'underwriting', 'closing_funding');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.step_owner as enum ('loan_officer', 'processor', 'borrower', 'lender', 'title');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.loan_step_status as enum ('done', 'na');
exception when duplicate_object then null;
end $$;

alter table public.loans add column if not exists arive_loan_number text;

-- ---------------------------------------------------------------------------
-- loan_milestones
-- ---------------------------------------------------------------------------

create table if not exists public.loan_milestones (
  loan_id          uuid not null,
  organization_id  uuid not null,
  milestone        public.loan_milestone not null,
  reached_on       date not null default current_date,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  primary key (loan_id, milestone),
  constraint loan_milestones_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_milestones_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

-- The one mapping from milestones to pipeline stages.
create or replace function public.milestone_stage(m public.loan_milestone)
returns public.pipeline_stage
language sql immutable
as $$
  select case m
    when 'application' then 'under_contract'
    when 'disclosures_sent' then 'under_contract'
    when 'submitted' then 'processing'
    when 'in_underwriting' then 'processing'
    when 'approved_conditions' then 'processing'
    when 'conditions_submitted' then 'processing'
    when 'clear_to_close' then 'clear_to_close'
    when 'docs_out' then 'clear_to_close'
    when 'closed' then 'closed'
    when 'funded' then 'closed'
  end::public.pipeline_stage
$$;

create or replace function public.stage_rank(s public.pipeline_stage)
returns integer
language sql immutable
as $$
  select case s
    when 'lead' then 1 when 'contacted' then 2 when 'pre_qualified' then 3 when 'pre_approved' then 4
    when 'under_contract' then 5 when 'processing' then 6 when 'clear_to_close' then 7 when 'closed' then 8
    else 0
  end
$$;

-- Reaching a milestone moves the file forward to its stage. Lost files stay lost.
create or replace function public.advance_stage_for_milestone()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.pipeline_stage := public.milestone_stage(new.milestone);
begin
  update public.loans
     set stage = target
   where id = new.loan_id
     and stage <> 'lost'
     and public.stage_rank(stage) < public.stage_rank(target);
  return new;
end;
$$;

create or replace trigger loan_milestones_advance_stage
  after insert on public.loan_milestones
  for each row execute function public.advance_stage_for_milestone();

-- ---------------------------------------------------------------------------
-- loan_team_members
-- ---------------------------------------------------------------------------

create table if not exists public.loan_team_members (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  role             public.team_role not null,
  -- A user in the company (e.g. a processor), or an outside contact by name.
  profile_id       uuid,
  name             text,
  company          text,
  email            text,
  phone            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint loan_team_members_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_team_members_profile_id_fkey
    foreign key (profile_id) references public.profiles (id) on delete set null,
  constraint loan_team_members_one_per_role unique (loan_id, role),
  constraint loan_team_members_has_someone check (profile_id is not null or length(trim(coalesce(name, ''))) > 0)
);

create or replace trigger loan_team_members_set_updated_at
  before update on public.loan_team_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- step_templates: default workflow steps (Settings)
-- ---------------------------------------------------------------------------

create table if not exists public.step_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  key              text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name             text not null check (length(trim(name)) > 0),
  step_group       public.step_group not null,
  owner            public.step_owner not null,
  -- Loan purposes this step applies to; null = all.
  purposes         public.loan_purpose[],
  sort_order       smallint not null default 0,
  -- Steps that must be done before this one is ready.
  requires         text[] not null default '{}',
  -- Code rule that can complete or block the step (see src/lib/loanfile/workflow.ts).
  rule_key         text,
  -- Marking this step done records this milestone.
  milestone        public.loan_milestone,
  -- What the step's button does: open a file section, or just mark it done (work done in Arive or elsewhere).
  action_label     text,
  action_target    text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint step_templates_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint step_templates_key_unique unique (organization_id, key)
);

create or replace trigger step_templates_set_updated_at
  before update on public.step_templates
  for each row execute function public.set_updated_at();

-- Default steps for a company. Re-running adds missing ones and leaves edited ones alone.
create or replace function public.seed_step_templates(org uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.step_templates (organization_id, key, name, step_group, owner, purposes, sort_order, requires, rule_key, milestone, action_label, action_target)
  values
    (org, 'prequal',            'Pre-qualify',                    'origination',      'loan_officer', null, 10, '{}', 'prequal', null, 'Open prequal', 'prequal'),
    (org, 'application',        'Complete the 1003',              'origination',      'loan_officer', null, 20, '{}', 'urla_complete', null, 'Open 1003', '1003'),
    (org, 'credit',             'Pull credit',                    'origination',      'loan_officer', null, 30, '{}', null, null, 'Mark done', null),
    (org, 'documents',          'Collect documents',              'origination',      'borrower',     null, 40, '{}', null, null, 'Mark done', null),
    (org, 'preapproval',        'Pre-approval letter',            'origination',      'loan_officer', '{purchase}', 50, '{application,credit}', null, null, 'Mark done', null),
    (org, 'contract',           'Executed contract received',     'origination',      'loan_officer', '{purchase}', 60, '{}', null, 'application', 'Mark received', null),
    (org, 'disclosures',        'Send disclosures',               'disclosure_setup', 'loan_officer', null, 10, '{application}', null, 'disclosures_sent', 'Mark sent', null),
    (org, 'disclosures_signed', 'Sign disclosures',               'disclosure_setup', 'borrower',     null, 20, '{disclosures}', null, null, 'Mark signed', null),
    (org, 'appraisal',          'Order appraisal',                'disclosure_setup', 'loan_officer', null, 30, '{disclosures}', null, null, 'Mark ordered', null),
    (org, 'title',              'Order title',                    'disclosure_setup', 'loan_officer', null, 40, '{}', null, null, 'Mark ordered', null),
    (org, 'submit',             'Submit to lender',               'disclosure_setup', 'loan_officer', null, 50, '{disclosures_signed}', 'ready_to_submit', 'submitted', 'Mark submitted', null),
    (org, 'approval',           'Conditional approval',           'underwriting',     'lender',       null, 10, '{submit}', null, 'approved_conditions', 'Mark approved', null),
    (org, 'appraisal_received', 'Appraisal received',             'underwriting',     'lender',       null, 20, '{appraisal}', null, null, 'Mark received', null),
    (org, 'conditions',         'Submit conditions',              'underwriting',     'processor',    null, 30, '{approval}', null, 'conditions_submitted', 'Mark submitted', null),
    (org, 'ctc',                'Clear to close',                 'underwriting',     'lender',       null, 40, '{conditions}', null, 'clear_to_close', 'Mark clear', null),
    (org, 'cd',                 'Closing Disclosure sent',        'closing_funding',  'loan_officer', null, 10, '{ctc}', null, null, 'Mark sent', null),
    (org, 'docs_out',           'Closing docs out',               'closing_funding',  'title',        null, 20, '{ctc}', null, 'docs_out', 'Mark out', null),
    (org, 'closing',            'Closing',                        'closing_funding',  'title',        null, 30, '{docs_out}', null, 'closed', 'Mark closed', null),
    (org, 'funded',             'Funded',                         'closing_funding',  'lender',       null, 40, '{closing}', null, 'funded', 'Mark funded', null)
  on conflict (organization_id, key) do nothing;
$$;

-- Every new company gets the default steps.
create or replace function public.seed_new_org_step_templates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_step_templates(new.id);
  return new;
end;
$$;

create or replace trigger organizations_seed_step_templates
  after insert on public.organizations
  for each row execute function public.seed_new_org_step_templates();

select public.seed_step_templates(id) from public.organizations;

-- Adjustment (2026-10-25): the Application milestone means the file is under
-- contract, so it belongs to "Executed contract received", not to finishing
-- the 1003 (done at pre-approval). Only rows still at the first defaults change.
update public.step_templates set milestone = null
 where key = 'application' and milestone = 'application' and rule_key = 'urla_complete';
update public.step_templates set milestone = 'application', rule_key = null, action_label = 'Mark received'
 where key = 'contract' and rule_key = 'contract' and milestone is null;

-- ---------------------------------------------------------------------------
-- loan_steps: what was marked on each file
-- ---------------------------------------------------------------------------

create table if not exists public.loan_steps (
  loan_id          uuid not null,
  organization_id  uuid not null,
  step_key         text not null,
  status           public.loan_step_status not null,
  done_on          date,
  note             text,
  updated_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  primary key (loan_id, step_key),
  constraint loan_steps_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_steps_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null,
  constraint loan_steps_done_has_date check (status <> 'done' or done_on is not null)
);

create or replace trigger loan_steps_set_updated_at
  before update on public.loan_steps
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.loan_milestones enable row level security;
alter table public.loan_team_members enable row level security;
alter table public.step_templates enable row level security;
alter table public.loan_steps enable row level security;

drop policy if exists "members see milestones on permitted loans" on public.loan_milestones;
create policy "members see milestones on permitted loans" on public.loan_milestones
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members record milestones on permitted loans" on public.loan_milestones;
create policy "members record milestones on permitted loans" on public.loan_milestones
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit milestones on permitted loans" on public.loan_milestones;
create policy "members edit milestones on permitted loans" on public.loan_milestones
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members remove milestones on permitted loans" on public.loan_milestones;
create policy "members remove milestones on permitted loans" on public.loan_milestones
  for delete to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "members see team on permitted loans" on public.loan_team_members;
create policy "members see team on permitted loans" on public.loan_team_members
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add team on permitted loans" on public.loan_team_members;
create policy "members add team on permitted loans" on public.loan_team_members
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit team on permitted loans" on public.loan_team_members;
create policy "members edit team on permitted loans" on public.loan_team_members
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members remove team on permitted loans" on public.loan_team_members;
create policy "members remove team on permitted loans" on public.loan_team_members
  for delete to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "members see step templates" on public.step_templates;
create policy "members see step templates" on public.step_templates
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add step templates" on public.step_templates;
create policy "managers add step templates" on public.step_templates
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit step templates" on public.step_templates;
create policy "managers edit step templates" on public.step_templates
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
drop policy if exists "managers remove step templates" on public.step_templates;
create policy "managers remove step templates" on public.step_templates
  for delete to authenticated using (public.is_org_manager(organization_id));

drop policy if exists "members see steps on permitted loans" on public.loan_steps;
create policy "members see steps on permitted loans" on public.loan_steps
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members mark steps on permitted loans" on public.loan_steps;
create policy "members mark steps on permitted loans" on public.loan_steps
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit steps on permitted loans" on public.loan_steps;
create policy "members edit steps on permitted loans" on public.loan_steps
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members clear steps on permitted loans" on public.loan_steps;
create policy "members clear steps on permitted loans" on public.loan_steps
  for delete to authenticated using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite loan file installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from public.step_templates) as default_steps;
