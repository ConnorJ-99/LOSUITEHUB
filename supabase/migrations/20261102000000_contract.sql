-- LOSuite: contract intake, part 3a (contract terms and uploaded documents).
--
-- Adds the purchase contract's terms to loans (each value in one place: the
-- sales price is still purchase_price, seller concessions are still
-- seller_credits, earnest money is still the 1003's earnest money asset, and
-- the effective, option and closing dates were already here), a loan_documents table for files uploaded to a borrower file, and a
-- private storage bucket ("loan-files") that only people who can see the
-- loan can read.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite contract intake installed").

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.contract_party as enum ('seller', 'buyer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.possession_terms as enum ('closing_and_funding', 'temporary_lease');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.document_kind as enum ('purchase_contract', 'contract_addendum', 'other');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Contract terms on loans
-- ---------------------------------------------------------------------------

alter table public.loans
  add column if not exists option_fee                numeric(12, 2) check (option_fee >= 0),
  -- The financing amount written in the contract's Third Party Financing addendum.
  add column if not exists contract_financing_amount numeric(14, 2) check (contract_financing_amount >= 0),
  -- Buyer approval deadline in the Third Party Financing addendum.
  add column if not exists financing_deadline        date,
  add column if not exists survey_deadline           date,
  add column if not exists title_policy_paid_by      public.contract_party,
  add column if not exists possession                public.possession_terms,
  -- Null = not known yet.
  add column if not exists has_hoa_addendum          boolean;

-- ---------------------------------------------------------------------------
-- loan_documents: files uploaded to a borrower file
-- ---------------------------------------------------------------------------

create table if not exists public.loan_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  loan_id          uuid not null,
  kind             public.document_kind not null default 'other',
  file_name        text not null check (length(trim(file_name)) > 0),
  -- Where the file lives in the "loan-files" bucket: <organization>/<loan>/<file>.
  storage_path     text not null unique,
  content_type     text,
  size_bytes       bigint check (size_bytes >= 0),
  uploaded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  -- Deleting a loan deletes its document rows.
  constraint loan_documents_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint loan_documents_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles (id) on delete set null,
  constraint loan_documents_path_matches_loan
    check (storage_path like organization_id::text || '/' || loan_id::text || '/%')
);

create index if not exists loan_documents_loan_id_idx on public.loan_documents (loan_id, created_at desc);

alter table public.loan_documents enable row level security;

drop policy if exists "members see documents on permitted loans" on public.loan_documents;
create policy "members see documents on permitted loans" on public.loan_documents
  for select to authenticated using (public.can_see_loan(loan_id));
drop policy if exists "members add documents on permitted loans" on public.loan_documents;
create policy "members add documents on permitted loans" on public.loan_documents
  for insert to authenticated with check (public.can_see_loan(loan_id));
drop policy if exists "members edit documents on permitted loans" on public.loan_documents;
create policy "members edit documents on permitted loans" on public.loan_documents
  for update to authenticated using (public.can_see_loan(loan_id)) with check (public.can_see_loan(loan_id));
drop policy if exists "members delete documents on permitted loans" on public.loan_documents;
create policy "members delete documents on permitted loans" on public.loan_documents
  for delete to authenticated using (public.can_see_loan(loan_id));

-- ---------------------------------------------------------------------------
-- Private storage bucket for the files themselves
-- ---------------------------------------------------------------------------

-- True when a file path is <organization>/<loan>/<name> for a loan the user can see.
create or replace function public.can_use_loan_file(path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$' then false
    else exists (
      select 1 from public.loans l
      where l.id::text = split_part(path, '/', 2)
        and l.organization_id::text = split_part(path, '/', 1)
        and public.can_see_loan(l.id)
    )
  end
$$;

-- 25 MB per file; PDFs and photos only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loan-files', 'loan-files', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "losuite members read loan files" on storage.objects;
create policy "losuite members read loan files" on storage.objects
  for select to authenticated using (bucket_id = 'loan-files' and public.can_use_loan_file(name));
drop policy if exists "losuite members upload loan files" on storage.objects;
create policy "losuite members upload loan files" on storage.objects
  for insert to authenticated with check (bucket_id = 'loan-files' and public.can_use_loan_file(name));
drop policy if exists "losuite members delete loan files" on storage.objects;
create policy "losuite members delete loan files" on storage.objects
  for delete to authenticated using (bucket_id = 'loan-files' and public.can_use_loan_file(name));
-- No update policy: files are never overwritten; a new upload is a new file.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite contract intake installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public') as tables,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'loans'
       and column_name in ('option_fee', 'contract_financing_amount', 'financing_deadline',
                           'survey_deadline', 'title_policy_paid_by', 'possession', 'has_hoa_addendum')) as contract_columns,
  (select count(*) from storage.buckets where id = 'loan-files' and not public) as private_bucket;
