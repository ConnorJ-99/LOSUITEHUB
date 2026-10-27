-- LOSuite: Product Search v2, step 5 (lender documents).
--
-- A private storage bucket for lenders' matrix and guideline PDFs, at
-- <organization>/<lender>/<file>. Everyone in the company can read them;
-- owners and admins upload and delete (the same people who edit the catalog).
-- Apply to the DEV Supabase project only, after the product search script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite guideline files installed").

-- True when a path is <organization>/<lender>/<name> for a lender in that organization.
create or replace function public.guideline_file_org(path text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$' then null
    else (
      select l.organization_id from public.lenders l
      where l.id::text = split_part(path, '/', 2)
        and l.organization_id::text = split_part(path, '/', 1)
    )
  end
$$;

-- 50 MB per file (full guidelines can be long); PDFs only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guideline-files', 'guideline-files', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "losuite members read guideline files" on storage.objects;
create policy "losuite members read guideline files" on storage.objects
  for select to authenticated using (bucket_id = 'guideline-files' and public.is_org_member(public.guideline_file_org(name)));
drop policy if exists "losuite managers upload guideline files" on storage.objects;
create policy "losuite managers upload guideline files" on storage.objects
  for insert to authenticated with check (bucket_id = 'guideline-files' and public.is_org_manager(public.guideline_file_org(name)));
drop policy if exists "losuite managers delete guideline files" on storage.objects;
create policy "losuite managers delete guideline files" on storage.objects
  for delete to authenticated using (bucket_id = 'guideline-files' and public.is_org_manager(public.guideline_file_org(name)));
-- No update policy: files are never overwritten; a newer version is a new file.

-- A stored file must sit in its own company's and lender's folder.
do $$ begin
  alter table public.guideline_documents
    add constraint guideline_documents_path_matches_lender
      check (storage_path is null or storage_path like organization_id::text || '/' || lender_id::text || '/%');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite guideline files installed' as result,
  (select count(*) from storage.buckets where id = 'guideline-files' and not public) as private_bucket,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like '%guideline files') as file_policies;
