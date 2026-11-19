-- AI Summary Fill runs (Connor, 2026-11-19): each time someone presses AI
-- Fill on a file's 1003, MPS HQ keeps what they typed, what the assistant
-- read, and every 1003 value it changed with the value before and after, so
-- "Undo AI fill" puts the run back exactly and the AI badges know which
-- fields are still unconfirmed. The 1003's own tables are unchanged.
--
-- Whoever can see the file can see its runs. A run is added by the person who
-- ran it; only they (or an owner/admin) can mark it undone or record what was
-- changed or confirmed afterwards. The notes they typed never change.
--
-- Safe to run more than once. A full run ends with a confirmation row.

create table if not exists public.ai_fill_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  run_by           uuid default auth.uid(),
  -- The assistant's logged run (ai_runs), when there was one.
  ai_run_id        uuid,
  notes            text not null check (length(trim(notes)) > 0),
  -- What the assistant read: facts, questions and unmapped items.
  reading          jsonb not null default '{}'::jsonb,
  -- Every 1003 change made: [{ key, kind, target | table+rowId, before, after, section, display }].
  applied          jsonb not null default '[]'::jsonb,
  -- Keys of AI-filled fields the loan officer confirmed (their AI badge goes away).
  confirmed        jsonb not null default '[]'::jsonb,
  fields_filled    integer not null default 0 check (fields_filled >= 0),
  undone_at        timestamptz,
  undone_by        uuid,
  created_at       timestamptz not null default now(),
  constraint ai_fill_runs_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint ai_fill_runs_loan_id_fkey
    foreign key (loan_id) references public.loans (id) on delete cascade,
  constraint ai_fill_runs_run_by_fkey
    foreign key (run_by) references public.profiles (id) on delete set null,
  constraint ai_fill_runs_undone_by_fkey
    foreign key (undone_by) references public.profiles (id) on delete set null,
  constraint ai_fill_runs_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null
);

create index if not exists ai_fill_runs_loan_idx on public.ai_fill_runs (loan_id, created_at desc);

alter table public.ai_fill_runs enable row level security;

drop policy if exists "people on the file see its AI fill runs" on public.ai_fill_runs;
create policy "people on the file see its AI fill runs" on public.ai_fill_runs
  for select to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "people on the file add their AI fill runs" on public.ai_fill_runs;
create policy "people on the file add their AI fill runs" on public.ai_fill_runs
  for insert to authenticated with check (public.can_see_loan(loan_id) and run_by = auth.uid() and undone_at is null);

drop policy if exists "the runner or an admin updates an AI fill run" on public.ai_fill_runs;
create policy "the runner or an admin updates an AI fill run" on public.ai_fill_runs
  for update to authenticated
  using (public.can_see_loan(loan_id) and (run_by = auth.uid() or public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])))
  with check (public.can_see_loan(loan_id));

-- The typed notes, the file, who ran it and when never change after the run is saved.
create or replace function public.ai_fill_runs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.notes is distinct from old.notes or new.loan_id is distinct from old.loan_id or new.organization_id is distinct from old.organization_id
     or new.run_by is distinct from old.run_by or new.created_at is distinct from old.created_at or new.reading is distinct from old.reading then
    raise exception 'An AI fill run''s notes and reading can''t be changed.';
  end if;
  if old.undone_at is not null and new.undone_at is null then
    raise exception 'An undone AI fill run stays undone.';
  end if;
  if new.undone_at is not null and old.undone_at is null then
    new.undone_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists ai_fill_runs_guard on public.ai_fill_runs;
create trigger ai_fill_runs_guard before update on public.ai_fill_runs
  for each row execute function public.ai_fill_runs_guard();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ AI fill runs installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'ai_fill_runs') as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ai_fill_runs') as policies,
  (select count(*) from pg_trigger where tgname = 'ai_fill_runs_guard') as triggers;
