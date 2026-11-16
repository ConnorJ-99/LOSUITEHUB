-- MPS HQ: Buyer Readiness Plans and the roadmap PDF, Steps 4–5 (Connor,
-- 2026-11-16; plan docs/plans/buyer-nurture.md).
--
-- A plan is structured records, not text:
--   readiness_plans       one per version per file: draft → approved →
--                         superseded; obstacles, intro, goal, review date,
--                         where it came from (ai / starter), who approved
--   readiness_actions     what to do, why it matters, steps, documents to
--                         verify, status
--   readiness_milestones  measurable milestones (per action, or plan-wide
--                         like "Month 3: reassess"), target and follow-up
--                         dates, outstanding / done
-- The loan officer edits a draft freely (save_readiness_draft replaces its
-- actions and milestones in one step), then approve_readiness_plan() locks
-- it: an approved plan's words and dates can't change (revise_readiness_plan
-- makes a new draft version from it), only milestone and action status.
-- Marking a milestone done needs a person: the service role (AI, timers)
-- can't. Approving moves the file from Initial Review / Plan Needed to Plan
-- Generated and leaves a note. Nothing goes to the borrower from here.
--
-- The roadmap PDF is document kind readiness_roadmap, each one linked to the
-- plan version it was made from (loan_documents.readiness_plan_id), so every
-- version is kept. The upload reader skips it (and income analyses).
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ readiness plans installed").

alter type public.document_kind add value if not exists 'readiness_roadmap';

create table if not exists public.readiness_plans (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  version          smallint not null check (version between 1 and 999),
  status           text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  obstacles        text[] not null default '{}',
  intro            text check (intro is null or length(intro) <= 2000),
  goal             text check (goal is null or length(goal) <= 300),
  review_on        date,
  source           text not null default 'starter' check (source in ('ai', 'starter')),
  ai_run_id        uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  approved_by      uuid,
  approved_at      timestamptz,
  constraint readiness_plans_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint readiness_plans_ai_run_id_fkey foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint readiness_plans_created_by_fkey foreign key (created_by) references public.profiles (id) on delete set null,
  constraint readiness_plans_approved_by_fkey foreign key (approved_by) references public.profiles (id) on delete set null,
  constraint readiness_plans_version_key unique (loan_id, version),
  constraint readiness_plans_approval_recorded check (status = 'draft' or approved_at is not null)
);
create unique index if not exists readiness_plans_one_draft on public.readiness_plans (loan_id) where status = 'draft';
create unique index if not exists readiness_plans_one_approved on public.readiness_plans (loan_id) where status = 'approved';

create table if not exists public.readiness_actions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  plan_id          uuid not null references public.readiness_plans (id) on delete cascade,
  sort_order       smallint not null default 0,
  obstacle         text,
  title            text not null check (length(trim(title)) between 1 and 200),
  why              text check (why is null or length(why) <= 1000),
  steps            text[] not null default '{}',
  docs             text[] not null default '{}',
  status           text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done')),
  constraint readiness_actions_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade
);
create index if not exists readiness_actions_plan_idx on public.readiness_actions (plan_id, sort_order);

create table if not exists public.readiness_milestones (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  plan_id          uuid not null references public.readiness_plans (id) on delete cascade,
  action_id        uuid references public.readiness_actions (id) on delete cascade,
  sort_order       smallint not null default 0,
  title            text not null check (length(trim(title)) between 1 and 200),
  measure          text check (measure is null or length(measure) <= 300),
  target_date      date,
  follow_up_date   date,
  status           text not null default 'outstanding' check (status in ('outstanding', 'done')),
  completed_at     timestamptz,
  completed_by     uuid,
  constraint readiness_milestones_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint readiness_milestones_completed_by_fkey foreign key (completed_by) references public.profiles (id) on delete set null,
  constraint readiness_milestones_done_recorded check (status = 'outstanding' or completed_at is not null)
);
create index if not exists readiness_milestones_plan_idx on public.readiness_milestones (plan_id, sort_order);
create index if not exists readiness_milestones_due_idx on public.readiness_milestones (loan_id, target_date) where status = 'outstanding';

alter table public.loan_documents add column if not exists readiness_plan_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'loan_documents_readiness_plan_id_fkey') then
    alter table public.loan_documents add constraint loan_documents_readiness_plan_id_fkey foreign key (readiness_plan_id) references public.readiness_plans (id) on delete set null;
  end if;
end $$;

drop trigger if exists readiness_plans_set_updated_at on public.readiness_plans;
create trigger readiness_plans_set_updated_at before update on public.readiness_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Who sees and changes them: whoever can see the file
-- ---------------------------------------------------------------------------

alter table public.readiness_plans enable row level security;
alter table public.readiness_actions enable row level security;
alter table public.readiness_milestones enable row level security;

do $$
declare t text;
begin
  foreach t in array array['readiness_plans', 'readiness_actions', 'readiness_milestones'] loop
    execute format('drop policy if exists "file members see %1$s" on public.%1$I', t);
    execute format('create policy "file members see %1$s" on public.%1$I for select to authenticated using (public.can_see_loan(loan_id))', t);
    execute format('drop policy if exists "file members add %1$s" on public.%1$I', t);
    execute format('create policy "file members add %1$s" on public.%1$I for insert to authenticated with check (public.can_see_loan(loan_id))', t);
    execute format('drop policy if exists "file members change %1$s" on public.%1$I', t);
    execute format('create policy "file members change %1$s" on public.%1$I for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id))', t);
    execute format('drop policy if exists "file members remove %1$s" on public.%1$I', t);
    execute format('create policy "file members remove %1$s" on public.%1$I for delete to authenticated using (public.can_see_loan(loan_id))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- An approved plan is locked (only statuses change); only a person completes a milestone
-- ---------------------------------------------------------------------------

create or replace function public.guard_readiness_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if (new.obstacles, new.intro, new.goal, new.review_on, new.loan_id, new.version) is distinct from (old.obstacles, old.intro, old.goal, old.review_on, old.loan_id, old.version)
       or (old.status = 'superseded') then
      raise exception 'An approved plan can''t be edited. Revise it to make a new version.';
    end if;
  end if;
  -- Deleting the whole file (cascade) still works: the file is already gone.
  if tg_op = 'DELETE' and old.status <> 'draft' and exists (select 1 from public.loans where id = old.loan_id) then
    raise exception 'An approved plan is kept. Revise it to make a new version.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists readiness_plans_guard on public.readiness_plans;
create trigger readiness_plans_guard before update or delete on public.readiness_plans
  for each row execute function public.guard_readiness_plan();

create or replace function public.guard_readiness_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.readiness_plans where id = coalesce(new.plan_id, old.plan_id);
  if v_status is null or not exists (select 1 from public.loans where id = coalesce(new.loan_id, old.loan_id)) then
    return coalesce(new, old); -- The plan or the whole file is being deleted.
  end if;
  if v_status <> 'draft' then
    if tg_op <> 'UPDATE' then
      raise exception 'An approved plan can''t be edited. Revise it to make a new version.';
    end if;
    if tg_table_name = 'readiness_actions'
       and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'An approved plan can''t be edited. Revise it to make a new version.';
    end if;
    if tg_table_name = 'readiness_milestones'
       and (to_jsonb(new) - 'status' - 'completed_at' - 'completed_by') is distinct from (to_jsonb(old) - 'status' - 'completed_at' - 'completed_by') then
      raise exception 'An approved plan can''t be edited. Revise it to make a new version.';
    end if;
  end if;
  if tg_table_name = 'readiness_milestones' and tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Only a person marks a milestone done (never the AI or a timer).
    if current_user = 'service_role' or (auth.uid() is null and current_user not in ('postgres', 'supabase_admin')) then
      raise exception 'Only the loan officer can mark a milestone done.';
    end if;
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists readiness_actions_guard on public.readiness_actions;
create trigger readiness_actions_guard before insert or update or delete on public.readiness_actions
  for each row execute function public.guard_readiness_item();
drop trigger if exists readiness_milestones_guard on public.readiness_milestones;
create trigger readiness_milestones_guard before insert or update or delete on public.readiness_milestones
  for each row execute function public.guard_readiness_item();

-- ---------------------------------------------------------------------------
-- Save a draft: the plan's words and its actions and milestones, replaced in one step
-- p_plan: { intro, goal, reviewOn, actions: [{ obstacle, title, why, steps[], docs[],
--           milestones: [{ title, measure, targetDate, followUpDate }] }],
--           milestones: [ plan-wide, same shape ] }
-- ---------------------------------------------------------------------------

create or replace function public.save_readiness_draft(p_loan_id uuid, p_obstacles text[], p_plan jsonb, p_source text default 'starter', p_ai_run_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_plan uuid;
  v_action uuid;
  a jsonb;
  m jsonb;
  i integer := 0;
  j integer := 0;
begin
  select organization_id into v_org from public.loans where id = p_loan_id;
  if v_org is null then raise exception 'You do not have permission to change this file.'; end if;
  if jsonb_typeof(p_plan->'actions') is distinct from 'array' or jsonb_array_length(p_plan->'actions') = 0 then
    raise exception 'A plan needs at least one action.';
  end if;
  if exists (select 1 from unnest(p_obstacles) o where not public.nurture_obstacle_ok(o)) then
    raise exception 'Unknown readiness obstacle.';
  end if;
  select id into v_plan from public.readiness_plans where loan_id = p_loan_id and status = 'draft';
  if v_plan is null then
    insert into public.readiness_plans (organization_id, loan_id, version, obstacles, source, ai_run_id)
    values (v_org, p_loan_id, coalesce((select max(version) from public.readiness_plans where loan_id = p_loan_id), 0) + 1, p_obstacles, p_source, p_ai_run_id)
    returning id into v_plan;
  end if;
  update public.readiness_plans set
    obstacles = p_obstacles,
    intro = nullif(trim(p_plan->>'intro'), ''),
    goal = nullif(trim(p_plan->>'goal'), ''),
    review_on = nullif(p_plan->>'reviewOn', '')::date,
    source = coalesce(p_source, source),
    ai_run_id = coalesce(p_ai_run_id, ai_run_id)
  where id = v_plan;
  delete from public.readiness_milestones where plan_id = v_plan;
  delete from public.readiness_actions where plan_id = v_plan;
  for a in select * from jsonb_array_elements(p_plan->'actions') loop
    i := i + 1;
    insert into public.readiness_actions (organization_id, loan_id, plan_id, sort_order, obstacle, title, why, steps, docs, status)
    values (v_org, p_loan_id, v_plan, i, nullif(a->>'obstacle', ''), trim(a->>'title'), nullif(trim(a->>'why'), ''),
      coalesce(array(select trim(x) from jsonb_array_elements_text(coalesce(a->'steps', '[]')) x where trim(x) <> ''), '{}'),
      coalesce(array(select trim(x) from jsonb_array_elements_text(coalesce(a->'docs', '[]')) x where trim(x) <> ''), '{}'),
      coalesce(nullif(a->>'status', ''), 'not_started'))
    returning id into v_action;
    for m in select * from jsonb_array_elements(coalesce(a->'milestones', '[]')) loop
      j := j + 1;
      insert into public.readiness_milestones (organization_id, loan_id, plan_id, action_id, sort_order, title, measure, target_date, follow_up_date)
      values (v_org, p_loan_id, v_plan, v_action, j, trim(m->>'title'), nullif(trim(m->>'measure'), ''), nullif(m->>'targetDate', '')::date, nullif(m->>'followUpDate', '')::date);
    end loop;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_plan->'milestones', '[]')) loop
    j := j + 1;
    insert into public.readiness_milestones (organization_id, loan_id, plan_id, action_id, sort_order, title, measure, target_date, follow_up_date)
    values (v_org, p_loan_id, v_plan, null, j, trim(m->>'title'), nullif(trim(m->>'measure'), ''), nullif(m->>'targetDate', '')::date, nullif(m->>'followUpDate', '')::date);
  end loop;
  return v_plan;
end;
$$;

revoke all on function public.save_readiness_draft(uuid, text[], jsonb, text, uuid) from public, anon;
grant execute on function public.save_readiness_draft(uuid, text[], jsonb, text, uuid) to authenticated;

-- Approve: the draft becomes the plan (the last approved one is kept as superseded).
create or replace function public.approve_readiness_plan(p_plan_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p public.readiness_plans;
  v_contact uuid;
begin
  if auth.uid() is null then raise exception 'Only a signed-in person can approve a plan.'; end if;
  select * into p from public.readiness_plans where id = p_plan_id;
  if p.id is null then raise exception 'You do not have permission to change this file.'; end if;
  if p.status <> 'draft' then raise exception 'Only a draft can be approved.'; end if;
  if not exists (select 1 from public.readiness_actions where plan_id = p.id) then raise exception 'A plan needs at least one action.'; end if;
  if not exists (select 1 from public.readiness_milestones where plan_id = p.id) then raise exception 'A plan needs at least one milestone.'; end if;
  update public.readiness_plans set status = 'superseded' where loan_id = p.loan_id and status = 'approved';
  update public.readiness_plans set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p.id;
  update public.loans set nurture_stage = 'plan_generated'
  where id = p.loan_id and stage::text = 'nurture' and nurture_stage in ('initial_review', 'plan_needed');
  select b.contact_id into v_contact from public.loan_borrowers b where b.loan_id = p.loan_id and b.role = 'primary' limit 1;
  if v_contact is not null then
    insert into public.notes (organization_id, contact_id, loan_id, kind, body)
    values (p.organization_id, v_contact, p.loan_id, 'note', 'Buyer Readiness Plan v' || p.version || ' approved.');
  end if;
end;
$$;

revoke all on function public.approve_readiness_plan(uuid) from public, anon;
grant execute on function public.approve_readiness_plan(uuid) to authenticated;

-- Revise: a new draft version copied from the approved plan (milestone progress kept).
create or replace function public.revise_readiness_plan(p_plan_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p public.readiness_plans;
  v_new uuid;
  a public.readiness_actions;
  v_action uuid;
begin
  select * into p from public.readiness_plans where id = p_plan_id;
  if p.id is null then raise exception 'You do not have permission to change this file.'; end if;
  select id into v_new from public.readiness_plans where loan_id = p.loan_id and status = 'draft';
  if v_new is not null then return v_new; end if; -- A draft is already open.
  insert into public.readiness_plans (organization_id, loan_id, version, obstacles, intro, goal, review_on, source)
  values (p.organization_id, p.loan_id, (select max(version) from public.readiness_plans where loan_id = p.loan_id) + 1, p.obstacles, p.intro, p.goal, p.review_on, p.source)
  returning id into v_new;
  for a in select * from public.readiness_actions where plan_id = p.id order by sort_order loop
    insert into public.readiness_actions (organization_id, loan_id, plan_id, sort_order, obstacle, title, why, steps, docs, status)
    values (a.organization_id, a.loan_id, v_new, a.sort_order, a.obstacle, a.title, a.why, a.steps, a.docs, a.status)
    returning id into v_action;
    insert into public.readiness_milestones (organization_id, loan_id, plan_id, action_id, sort_order, title, measure, target_date, follow_up_date)
    select m.organization_id, m.loan_id, v_new, v_action, m.sort_order, m.title, m.measure, m.target_date, m.follow_up_date
    from public.readiness_milestones m where m.plan_id = p.id and m.action_id = a.id;
  end loop;
  insert into public.readiness_milestones (organization_id, loan_id, plan_id, action_id, sort_order, title, measure, target_date, follow_up_date)
  select m.organization_id, m.loan_id, v_new, null, m.sort_order, m.title, m.measure, m.target_date, m.follow_up_date
  from public.readiness_milestones m where m.plan_id = p.id and m.action_id is null;
  return v_new;
end;
$$;

revoke all on function public.revise_readiness_plan(uuid) from public, anon;
grant execute on function public.revise_readiness_plan(uuid) to authenticated;

-- Sending the roadmap moves the file to Plan Delivered (from Plan Generated or earlier).
create or replace function public.mark_roadmap_delivered(p_loan_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.loans set nurture_stage = 'plan_delivered'
  where id = p_loan_id and stage::text = 'nurture' and nurture_stage in ('initial_review', 'plan_needed', 'plan_generated');
$$;

revoke all on function public.mark_roadmap_delivered(uuid) from public, anon;
grant execute on function public.mark_roadmap_delivered(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The upload reader skips MPS HQ's own PDFs (now the roadmap and income analyses too)
-- ---------------------------------------------------------------------------

create or replace function public.queue_document_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.content_type, '') in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')
     and new.kind::text not in ('preapproval_letter', 'fee_worksheet', 'loan_comparison', 'quick_quote', 'prequal_results', 'income_analysis', 'readiness_roadmap', 'purchase_contract', 'contract_addendum', 'appraisal', 'title_commitment') then
    insert into public.document_analyses (organization_id, loan_id, document_id)
    values (new.organization_id, new.loan_id, new.id)
    on conflict (document_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_document_analysis() from public, anon, authenticated;

select
  'MPS HQ readiness plans installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('readiness_plans', 'readiness_actions', 'readiness_milestones')) as tables,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel = 'readiness_roadmap') as roadmap_kind;
