-- LOSuite: assistant core (Action Queue, AI run log, message templates).
--
-- The assistant never sends or saves anything on its own: everything it
-- prepares lands in action_items for Connor to approve, edit or dismiss.
-- Every assistant run is logged in ai_runs for auditing and improving prompts.
-- Message templates are Connor's saved texts and emails, which the assistant
-- personalizes.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite assistant core installed").

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.ai_run_status as enum ('running', 'succeeded', 'failed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.review_outcome as enum ('approved', 'edited', 'dismissed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.action_kind as enum ('draft_message', 'task_suggestion', 'field_update');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.action_status as enum ('pending', 'approved', 'edited', 'dismissed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.confidence_level as enum ('high', 'medium', 'low');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.message_channel as enum ('text', 'email');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- ai_runs: one row per assistant run
-- ---------------------------------------------------------------------------

create table if not exists public.ai_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  -- The borrower file it ran for, if any. Deleting the loan keeps the log row.
  loan_id          uuid,
  task_type        text not null check (length(trim(task_type)) > 0),
  -- What was sent: a reference to the input (e.g. which notes or document), not a copy of the file.
  input_ref        jsonb not null default '{}'::jsonb,
  output           jsonb,
  model            text,
  status           public.ai_run_status not null default 'running',
  error            text,
  -- What Connor did with the result.
  outcome          public.review_outcome,
  input_tokens     integer check (input_tokens >= 0),
  output_tokens    integer check (output_tokens >= 0),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  constraint ai_runs_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint ai_runs_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete set null (loan_id),
  constraint ai_runs_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index if not exists ai_runs_loan_id_idx on public.ai_runs (loan_id);

-- ---------------------------------------------------------------------------
-- action_items: the Action Queue on each borrower file
-- ---------------------------------------------------------------------------

create table if not exists public.action_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  kind             public.action_kind not null,
  title            text not null check (length(trim(title)) > 0),
  -- The prepared work, e.g. a draft: {"channel": "text", "to": "...", "subject": null, "body": "..."}.
  payload          jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- Where it came from: [{"label": "...", "quote": "...", "page": 2}].
  sources          jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  confidence       public.confidence_level,
  status           public.action_status not null default 'pending',
  due_on           date,
  ai_run_id        uuid,
  created_by       uuid default auth.uid(),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its queue.
  constraint action_items_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint action_items_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint action_items_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint action_items_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null,
  -- A decided item records who decided and when.
  constraint action_items_decision_recorded
    check (status = 'pending' or decided_at is not null)
);

create index if not exists action_items_loan_id_idx on public.action_items (loan_id);
create index if not exists action_items_pending_idx on public.action_items (organization_id, due_on) where status = 'pending';

create or replace trigger action_items_set_updated_at
  before update on public.action_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- message_templates: saved texts and emails (Settings)
-- ---------------------------------------------------------------------------

create table if not exists public.message_templates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  name             text not null check (length(trim(name)) > 0),
  channel          public.message_channel not null,
  -- Emails only.
  subject          text,
  -- Merge fields look like {{first_name}}.
  body             text not null check (length(trim(body)) > 0),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint message_templates_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint message_templates_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint message_templates_name_unique unique (organization_id, name)
);

create or replace trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.ai_runs enable row level security;
alter table public.action_items enable row level security;
alter table public.message_templates enable row level security;

-- ai_runs: tied to a loan → whoever can see the loan; not tied to one → the person who ran it, or an org manager.
drop policy if exists "members see runs they may see" on public.ai_runs;
create policy "members see runs they may see" on public.ai_runs
  for select to authenticated using (
    case when loan_id is not null then public.can_see_loan(loan_id)
    else created_by = auth.uid() or public.is_org_manager(organization_id) end
  );
drop policy if exists "members log their own runs" on public.ai_runs;
create policy "members log their own runs" on public.ai_runs
  for insert to authenticated with check (
    public.is_org_member(organization_id) and created_by = auth.uid()
    and (loan_id is null or public.can_see_loan(loan_id))
  );
drop policy if exists "members update runs they may see" on public.ai_runs;
create policy "members update runs they may see" on public.ai_runs
  for update to authenticated
  using (case when loan_id is not null then public.can_see_loan(loan_id) else created_by = auth.uid() end)
  with check (case when loan_id is not null then public.can_see_loan(loan_id) else created_by = auth.uid() end);
-- No delete policy: the log is kept.

drop policy if exists "members see queue on permitted loans" on public.action_items;
create policy "members see queue on permitted loans" on public.action_items
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add to queue on permitted loans" on public.action_items;
create policy "members add to queue on permitted loans" on public.action_items
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members decide queue on permitted loans" on public.action_items;
create policy "members decide queue on permitted loans" on public.action_items
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members delete queue on permitted loans" on public.action_items;
create policy "members delete queue on permitted loans" on public.action_items
  for delete to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "members see templates" on public.message_templates;
create policy "members see templates" on public.message_templates
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "members add templates" on public.message_templates;
create policy "members add templates" on public.message_templates
  for insert to authenticated with check (public.is_org_member(organization_id));
drop policy if exists "members edit templates" on public.message_templates;
create policy "members edit templates" on public.message_templates
  for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
drop policy if exists "members delete templates" on public.message_templates;
create policy "members delete templates" on public.message_templates
  for delete to authenticated using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite assistant core installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables;
