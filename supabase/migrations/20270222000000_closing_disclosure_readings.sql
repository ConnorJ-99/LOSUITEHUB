-- Final Closing Disclosure reading (Connor, 2026-11-19), step 1 of 4.
--
-- When a file is at Approved / CTC (or already Closed), Connor uploads the
-- final Closing Disclosure. The assistant reads its figures, each with the
-- exact words and page it came from, and Connor reviews them: empty fields
-- fill, different values wait for Replace / Keep. Nothing on the file
-- changes until he clicks Apply.
--
-- closing_disclosure_readings keeps each reading: what was read (never
-- changed afterwards), and once applied, every value it changed with the
-- value before and after, so "Undo" puts the file back exactly. Readings are
-- kept (no delete). An undone reading stays undone.
--
-- The upload is its own document kind, `closing_disclosure`, and the general
-- upload reader skips it (it has this reader instead).
--
-- Safe to run more than once. A full run ends with a confirmation row.

alter type public.document_kind add value if not exists 'closing_disclosure';

create table if not exists public.closing_disclosure_readings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  -- The uploaded Closing Disclosure that was read.
  document_id      uuid,
  -- The assistant's logged run (ai_runs), when there was one.
  ai_run_id        uuid,
  status           public.extraction_status not null default 'pending_review',
  -- What the assistant read: { fields: [{ key, value, text, quote, page, confidence }], unreadable, notes }.
  reading          jsonb not null default '{}'::jsonb check (jsonb_typeof(reading) = 'object'),
  -- Every value Apply changed: [{ key, target, before, after, label }].
  applied          jsonb not null default '[]'::jsonb check (jsonb_typeof(applied) = 'array'),
  created_by       uuid default auth.uid(),
  decided_by       uuid,
  decided_at       timestamptz,
  undone_at        timestamptz,
  undone_by        uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its readings; deleting the PDF keeps the reading.
  constraint closing_disclosure_readings_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint closing_disclosure_readings_document_id_fkey
    foreign key (document_id) references public.loan_documents (id) on delete set null,
  constraint closing_disclosure_readings_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint closing_disclosure_readings_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint closing_disclosure_readings_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null,
  constraint closing_disclosure_readings_undone_by_fkey
    foreign key (undone_by) references public.profiles (id) on delete set null,
  -- A reviewed reading records when it was decided; only an applied one can be undone.
  constraint closing_disclosure_readings_decision_recorded
    check (status = 'pending_review' or decided_at is not null),
  constraint closing_disclosure_readings_undo_applied
    check (undone_at is null or status = 'applied')
);

create index if not exists closing_disclosure_readings_loan_idx on public.closing_disclosure_readings (loan_id, created_at desc);

create or replace trigger closing_disclosure_readings_set_updated_at
  before update on public.closing_disclosure_readings
  for each row execute function public.set_updated_at();

alter table public.closing_disclosure_readings enable row level security;

drop policy if exists "people on the file see its CD readings" on public.closing_disclosure_readings;
create policy "people on the file see its CD readings" on public.closing_disclosure_readings
  for select to authenticated using (public.can_see_loan(loan_id));

drop policy if exists "people on the file add CD readings" on public.closing_disclosure_readings;
create policy "people on the file add CD readings" on public.closing_disclosure_readings
  for insert to authenticated
  with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id) and created_by = auth.uid() and undone_at is null);

drop policy if exists "people on the file review CD readings" on public.closing_disclosure_readings;
create policy "people on the file review CD readings" on public.closing_disclosure_readings
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
-- No delete policy: readings are kept.

-- What was read, which file and PDF, and who read it never change. A decision
-- is made once (pending → applied or discarded); an undone reading stays undone.
create or replace function public.closing_disclosure_readings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reading is distinct from old.reading or new.loan_id is distinct from old.loan_id or new.organization_id is distinct from old.organization_id
     or new.document_id is distinct from old.document_id and new.document_id is not null
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'A Closing Disclosure reading can''t be changed after it''s read.';
  end if;
  if old.status <> 'pending_review' and new.status is distinct from old.status then
    raise exception 'This Closing Disclosure reading was already decided.';
  end if;
  if old.status = 'applied' and new.applied is distinct from old.applied then
    raise exception 'The changes an applied reading made can''t be edited.';
  end if;
  if old.undone_at is not null and new.undone_at is distinct from old.undone_at then
    raise exception 'An undone Closing Disclosure reading stays undone.';
  end if;
  if old.status = 'pending_review' and new.status <> 'pending_review' then
    new.decided_at := now();
    new.decided_by := auth.uid();
  end if;
  if old.undone_at is null and new.undone_at is not null then
    new.undone_at := now();
    new.undone_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists closing_disclosure_readings_guard on public.closing_disclosure_readings;
create trigger closing_disclosure_readings_guard before update on public.closing_disclosure_readings
  for each row execute function public.closing_disclosure_readings_guard();

-- The general upload reader skips the Closing Disclosure (same list as before, plus closing_disclosure).
create or replace function public.queue_document_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.content_type, '') in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')
     and new.kind::text not in ('preapproval_letter', 'fee_worksheet', 'loan_comparison', 'quick_quote', 'prequal_results', 'income_analysis', 'readiness_roadmap', 'purchase_contract', 'contract_addendum', 'appraisal', 'title_commitment', 'closing_disclosure') then
    insert into public.document_analyses (organization_id, loan_id, document_id)
    values (new.organization_id, new.loan_id, new.id)
    on conflict (document_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.queue_document_analysis() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ Closing Disclosure readings installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'closing_disclosure_readings') as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'closing_disclosure_readings') as policies,
  (select count(*) from pg_trigger where tgname in ('closing_disclosure_readings_guard', 'closing_disclosure_readings_set_updated_at')) as triggers,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel = 'closing_disclosure') as cd_kind;
