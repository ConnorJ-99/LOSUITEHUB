-- LOSuite: call notes to pre-qual, part 4b (the assistant reads call notes).
--
-- call_note_readings holds one reading of one call note: each fact the
-- assistant found (score, jobs, debts, savings, homes, credit history...)
-- with the words from the note it came from and how sure it is. Connor
-- reviews it item by item; applying fills the Prequal form, which he then
-- saves as usual. Readings are kept (no delete) as a record.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite call note reading installed").

create table if not exists public.call_note_readings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  -- The call note that was read. Deleting the note keeps the reading.
  note_id          uuid,
  ai_run_id        uuid,
  status           public.extraction_status not null default 'pending_review',
  -- [{"id": "i3", "kind": "debt", "borrower": "Marcus", "creditor": "Ford", "monthlyPayment": 612, ...,
  --   "quote": "...", "confidence": "high", "decision": "accepted" | "edited" | "skipped" | null}]
  items            jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  -- Anything the assistant wants Connor to know (e.g. a co-borrower who isn't on the file).
  notes            text,
  created_by       uuid default auth.uid(),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its readings.
  constraint call_note_readings_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint call_note_readings_note_id_fkey
    foreign key (note_id) references public.notes (id) on delete set null,
  constraint call_note_readings_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint call_note_readings_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint call_note_readings_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null,
  constraint call_note_readings_decision_recorded
    check (status = 'pending_review' or decided_at is not null)
);

create index if not exists call_note_readings_loan_id_idx on public.call_note_readings (loan_id, created_at desc);

create or replace trigger call_note_readings_set_updated_at
  before update on public.call_note_readings
  for each row execute function public.set_updated_at();

alter table public.call_note_readings enable row level security;

drop policy if exists "members see note readings on permitted loans" on public.call_note_readings;
create policy "members see note readings on permitted loans" on public.call_note_readings
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add note readings on permitted loans" on public.call_note_readings;
create policy "members add note readings on permitted loans" on public.call_note_readings
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members review note readings on permitted loans" on public.call_note_readings;
create policy "members review note readings on permitted loans" on public.call_note_readings
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
-- No delete policy: readings are kept.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite call note reading installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'call_note_readings') as policies;
