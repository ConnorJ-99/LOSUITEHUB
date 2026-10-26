-- LOSuite: contract intake, part 3b (the assistant reads the contract).
--
-- contract_extractions holds one reading of a file's contract documents:
-- every term the assistant found, with the quote and page it came from and
-- how sure it is, plus the people named in the contract. Connor reviews it
-- field by field; nothing reaches the loan until he applies it. Readings are
-- kept (no delete) so there's a record of what was read and what was used.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite contract reading installed").

do $$ begin
  create type public.extraction_status as enum ('pending_review', 'applied', 'discarded');
exception when duplicate_object then null;
end $$;

create table if not exists public.contract_extractions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  -- The loan_documents that were read (the contract and its addenda).
  document_ids     uuid[] not null default '{}',
  ai_run_id        uuid,
  status           public.extraction_status not null default 'pending_review',
  -- [{"key": "sales_price", "value": 307000, "text": "$307,000", "quote": "...", "page": 1,
  --   "confidence": "high", "decision": "accepted" | "edited" | "skipped" | null, "final": ...}]
  fields           jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  -- [{"role": "listing_agent", "name": "...", "company": "...", "email": "...", "phone": "...", "quote": "...", "page": 9}]
  contacts         jsonb not null default '[]'::jsonb check (jsonb_typeof(contacts) = 'array'),
  -- Anything unusual the assistant noticed (e.g. handwritten changes).
  notes            text,
  created_by       uuid default auth.uid(),
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Deleting a loan deletes its readings.
  constraint contract_extractions_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint contract_extractions_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint contract_extractions_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint contract_extractions_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null,
  -- A reviewed reading records when it was decided.
  constraint contract_extractions_decision_recorded
    check (status = 'pending_review' or decided_at is not null)
);

create index if not exists contract_extractions_loan_id_idx on public.contract_extractions (loan_id, created_at desc);

create or replace trigger contract_extractions_set_updated_at
  before update on public.contract_extractions
  for each row execute function public.set_updated_at();

alter table public.contract_extractions enable row level security;

drop policy if exists "members see readings on permitted loans" on public.contract_extractions;
create policy "members see readings on permitted loans" on public.contract_extractions
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add readings on permitted loans" on public.contract_extractions;
create policy "members add readings on permitted loans" on public.contract_extractions
  for insert to authenticated with check (public.can_see_loan(loan_id) and public.is_org_member(organization_id));
drop policy if exists "members review readings on permitted loans" on public.contract_extractions;
create policy "members review readings on permitted loans" on public.contract_extractions
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
-- No delete policy: readings are kept.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite contract reading installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'contract_extractions') as policies;
