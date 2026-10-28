-- LOSuite: company logo and loan officer signatures (Settings).
--
-- A private storage bucket for brand images used on PDFs:
--   <organization>/logo/<file>                    the company logo (owners and admins)
--   <organization>/signatures/<user>/<file>       each user's own signature image
-- Everyone in the company can read them (a letter shows the loan's LO
-- signature whoever makes it). PNG or JPEG only (what the PDF maker draws),
-- 2 MB at most. organizations.logo_path and profiles.signature_path point at
-- the file in use.
-- Apply to the DEV Supabase project only, after the pipeline v2 script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite brand files installed").

alter table public.organizations add column if not exists logo_path text;
alter table public.profiles add column if not exists signature_path text;

do $$ begin
  alter table public.organizations
    add constraint organizations_logo_in_own_folder check (logo_path is null or logo_path like id::text || '/logo/%');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint profiles_signature_in_own_folder check (signature_path is null or signature_path ~ ('^[0-9a-f-]{36}/signatures/' || id::text || '/[^/]+$'));
exception when duplicate_object then null; end $$;

-- The company a brand file belongs to, or null when the path isn't one of the two shapes.
create or replace function public.brand_file_org(path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when path ~ '^[0-9a-f-]{36}/logo/[^/]+$' or path ~ '^[0-9a-f-]{36}/signatures/[0-9a-f-]{36}/[^/]+$' then split_part(path, '/', 1)::uuid
    else null
  end
$$;

-- Who may add or remove a brand file: managers for the logo, each user for their own signature.
create or replace function public.can_manage_brand_file(path text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when path ~ '^[0-9a-f-]{36}/logo/[^/]+$' then public.is_org_manager(public.brand_file_org(path))
    when path ~ '^[0-9a-f-]{36}/signatures/[0-9a-f-]{36}/[^/]+$' then public.is_org_member(public.brand_file_org(path)) and split_part(path, '/', 3) = auth.uid()::text
    else false
  end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-files', 'brand-files', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "losuite members read brand files" on storage.objects;
create policy "losuite members read brand files" on storage.objects
  for select to authenticated using (bucket_id = 'brand-files' and public.is_org_member(public.brand_file_org(name)));
drop policy if exists "losuite owners add brand files" on storage.objects;
create policy "losuite owners add brand files" on storage.objects
  for insert to authenticated with check (bucket_id = 'brand-files' and public.can_manage_brand_file(name));
drop policy if exists "losuite owners remove brand files" on storage.objects;
create policy "losuite owners remove brand files" on storage.objects
  for delete to authenticated using (bucket_id = 'brand-files' and public.can_manage_brand_file(name));
-- No update policy: a new image is a new file; the old one is removed.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite brand files installed' as result,
  (select count(*) from storage.buckets where id = 'brand-files' and not public) as private_bucket,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like '%brand files') as file_policies,
  (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'organizations' and column_name = 'logo_path') or (table_name = 'profiles' and column_name = 'signature_path'))) as new_columns;
