-- MPS HQ: the Loan Officer Assessment on the Borrower Profile (plan
-- docs/plans/borrower-profile.md, Stage 2; Connor 2026-11-24, "next").
--
-- loan_assessments: one per file, the eight assessment fields: borrower
-- overview, financial strengths, qualification concerns, recommended financing
-- strategy, internal underwriting considerations (never on a borrower-facing
-- document), borrower-facing recommendations, outstanding documentation, next
-- steps. An AI draft (assistant task borrower_assessment) fills only empty
-- fields and lists them in ai_fields; the fields stay "AI draft, not reviewed"
-- until the file's loan officer or an admin marks the assessment reviewed.
-- Changing any field after a review takes the review away (it must be
-- reviewed again). Who can see the file reads and edits it (processors and
-- LO Assistants included); only the file's LO or an admin (file_role lo /
-- admin) can mark it reviewed, and the database records who and when.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ loan assessments installed").

create table if not exists public.loan_assessments (
  loan_id                  uuid primary key,
  organization_id          uuid not null,
  overview                 text check (overview is null or length(overview) <= 4000),
  strengths                text check (strengths is null or length(strengths) <= 4000),
  concerns                 text check (concerns is null or length(concerns) <= 4000),
  strategy                 text check (strategy is null or length(strategy) <= 4000),
  underwriting             text check (underwriting is null or length(underwriting) <= 4000),
  borrower_recommendations text check (borrower_recommendations is null or length(borrower_recommendations) <= 4000),
  outstanding_docs         text check (outstanding_docs is null or length(outstanding_docs) <= 4000),
  next_steps               text check (next_steps is null or length(next_steps) <= 4000),
  -- The fields the AI filled that nobody has reviewed yet.
  ai_fields                text[] not null default '{}',
  ai_run_id                uuid references public.ai_runs (id) on delete set null,
  ai_drafted_at            timestamptz,
  reviewed_by              uuid references public.profiles (id) on delete set null,
  reviewed_at              timestamptz,
  updated_by               uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint loan_assessments_loan_id_fkey foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_assessments_ai_fields check (ai_fields <@ array['overview', 'strengths', 'concerns', 'strategy', 'underwriting', 'borrower_recommendations', 'outstanding_docs', 'next_steps']::text[])
);

/**
 * Reviews: setting reviewed_at needs the file's LO or an admin, and records who
 * and when (whatever was sent); a review clears the AI marks. Any field change
 * without a review takes an earlier review away.
 */
create or replace function public.loan_assessments_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed boolean;
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  v_changed := tg_op = 'INSERT' or row(new.overview, new.strengths, new.concerns, new.strategy, new.underwriting, new.borrower_recommendations, new.outstanding_docs, new.next_steps)
    is distinct from row(old.overview, old.strengths, old.concerns, old.strategy, old.underwriting, old.borrower_recommendations, old.outstanding_docs, old.next_steps);
  if new.reviewed_at is not null and (tg_op = 'INSERT' or old.reviewed_at is null or new.reviewed_at is distinct from old.reviewed_at) then
    -- Marking it reviewed now.
    if auth.uid() is not null and coalesce(public.file_role(new.loan_id), '') not in ('lo', 'admin') then
      raise exception 'Only the file''s loan officer or an admin can mark the assessment reviewed.';
    end if;
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
    new.ai_fields := '{}';
  elsif v_changed and tg_op = 'UPDATE' then
    new.reviewed_at := null;
    new.reviewed_by := null;
  elsif tg_op = 'UPDATE' then
    new.reviewed_by := old.reviewed_by;
  end if;
  return new;
end;
$$;

revoke all on function public.loan_assessments_review() from public, anon, authenticated;
drop trigger if exists loan_assessments_review on public.loan_assessments;
create trigger loan_assessments_review before insert or update on public.loan_assessments
  for each row execute function public.loan_assessments_review();

alter table public.loan_assessments enable row level security;
drop policy if exists "file members see the assessment" on public.loan_assessments;
create policy "file members see the assessment" on public.loan_assessments for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "file members add the assessment" on public.loan_assessments;
create policy "file members add the assessment" on public.loan_assessments for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "file members change the assessment" on public.loan_assessments;
create policy "file members change the assessment" on public.loan_assessments for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
revoke delete on public.loan_assessments from anon, authenticated;

select
  'MPS HQ loan assessments installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'loan_assessments') as tables,
  (select count(*) from pg_trigger where tgname = 'loan_assessments_review') as triggers;
