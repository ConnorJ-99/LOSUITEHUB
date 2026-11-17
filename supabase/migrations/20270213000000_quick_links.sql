-- MPS HQ: Quick Links (Connor, 2026-11-17).
--
-- One page of the links everyone opens all day: Arive, lender portals and the
-- county appraisal district (CAD) and tax office sites.
--
--   * lenders.show_in_quick_links (on by default). A lender's portal link is
--     the existing lenders.portal_url and its logo the existing (unused until
--     now) lenders.logo_path: a file in the new `logos` bucket
--     ("<organization>/<file>") or a pasted https:// address.
--   * quick_links: Arive-style system links, county tax and appraisal sites
--     and any other link. Seeded with 13 DFW-area counties.
--   * user_pinned_links: each person's own pins (a star on a tile). A pin
--     points at a lender or a quick link with a real foreign key, so deleting
--     the lender or link removes its pins.
--   * organizations.arive_login_url: the company's Arive login page
--     (https://<company>.myarive.com), for the Arive tile.
--   * The `logos` storage bucket (private; everyone in the company reads,
--     owners and admins upload and remove).
--
-- Permissions: everyone in the company reads every link and lender; only
-- owners and admins (has_org_role(org, owner/admin), the check the company
-- settings already use) add, change or delete them. This script also takes
-- lender editing away from processors: until now the lender catalog (lenders,
-- lender contacts, programs, guidelines, rate sheets, overlays, imports, comp
-- plans, product updates and guideline files) allowed owners, admins AND
-- processors to write (is_org_manager). Pinning is the only change anyone
-- else can make here.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ quick links installed").

-- ---------------------------------------------------------------------------
-- Lenders: show or hide on Quick Links.
-- ---------------------------------------------------------------------------

alter table public.lenders add column if not exists show_in_quick_links boolean not null default true;

-- ---------------------------------------------------------------------------
-- Arive login address (Settings → Company).
-- ---------------------------------------------------------------------------

alter table public.organizations add column if not exists arive_login_url text;

alter table public.organizations drop constraint if exists organizations_arive_login_url_check;
alter table public.organizations add constraint organizations_arive_login_url_check
  check (arive_login_url is null or (arive_login_url ~* '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.myarive\.com(/[^[:space:]]*)?$' and length(arive_login_url) <= 300));

-- ---------------------------------------------------------------------------
-- quick_links
-- ---------------------------------------------------------------------------

create table if not exists public.quick_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  -- system = tools like Arive; county_tax = CAD (url) and tax office (secondary_url); other = anything else.
  category         text not null check (category in ('system', 'county_tax', 'other')),
  name             text not null check (length(trim(name)) > 0 and length(name) <= 120),
  url              text not null check (url ~* '^https?://[^[:space:]]+$' and length(url) <= 500),
  secondary_url    text check (secondary_url is null or (secondary_url ~* '^https?://[^[:space:]]+$' and length(secondary_url) <= 500)),
  subtitle         text check (subtitle is null or length(subtitle) <= 200),
  -- A file in the logos bucket ("<organization>/<file>") or a pasted https:// address.
  logo_path        text check (logo_path is null or length(logo_path) <= 500),
  sort_order       integer not null default 100,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint quick_links_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint quick_links_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null,
  constraint quick_links_name_unique unique (organization_id, category, name),
  constraint quick_links_id_organization_id_key unique (id, organization_id)
);

create or replace function public.quick_links_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists quick_links_stamp on public.quick_links;
create trigger quick_links_stamp before insert or update on public.quick_links
  for each row execute function public.quick_links_stamp();

alter table public.quick_links enable row level security;
drop policy if exists "members see quick links" on public.quick_links;
create policy "members see quick links" on public.quick_links
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "admins add quick links" on public.quick_links;
create policy "admins add quick links" on public.quick_links
  for insert to authenticated with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
drop policy if exists "admins edit quick links" on public.quick_links;
create policy "admins edit quick links" on public.quick_links
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
drop policy if exists "admins remove quick links" on public.quick_links;
create policy "admins remove quick links" on public.quick_links
  for delete to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- County appraisal districts (url) and tax offices (secondary_url), for every
-- company. Only adds counties a company doesn't have; never changes edits.
insert into public.quick_links (organization_id, category, name, url, secondary_url, sort_order)
select o.id, 'county_tax', c.name, c.url, c.tax, c.pos
from public.organizations o
cross join (values
  ('Dallas',   'https://www.dallascad.org',        'https://www.dallasact.com',                      10),
  ('Tarrant',  'https://www.tad.org',              'https://www.tarrantcountytx.gov/en/tax.html',    20),
  ('Collin',   'https://www.collincad.org',        'https://www.collincountytx.gov/Tax-Assessor',    30),
  ('Denton',   'https://www.dentoncad.com',        'https://www.dentoncounty.gov/tax',               40),
  ('Rockwall', 'https://www.rockwallcad.com',      null,                                             50),
  ('Kaufman',  'https://www.kaufman-cad.org',      null,                                             60),
  ('Ellis',    'https://www.elliscad.org',         null,                                             70),
  ('Johnson',  'https://johnsoncad.com',           null,                                             80),
  ('Parker',   'https://www.parkercad.org',        null,                                             90),
  ('Wise',     'https://www.wisecad.org',          null,                                             100),
  ('Hood',     'https://www.hoodcad.net',          null,                                             110),
  ('Hunt',     'https://hunt-cad.org',             null,                                             120),
  ('Grayson',  'https://www.graysonappraisal.org', 'https://tax.co.grayson.tx.us',                   130)
) as c (name, url, tax, pos)
on conflict (organization_id, category, name) do nothing;

-- ---------------------------------------------------------------------------
-- user_pinned_links: each person's pins.
-- ---------------------------------------------------------------------------

create table if not exists public.user_pinned_links (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  user_id          uuid not null default auth.uid(),
  link_type        text not null check (link_type in ('lender', 'quick_link')),
  lender_id        uuid,
  quick_link_id    uuid,
  link_id          uuid generated always as (coalesce(lender_id, quick_link_id)) stored,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  constraint user_pinned_links_points_at_one check (
    (link_type = 'lender' and lender_id is not null and quick_link_id is null)
    or (link_type = 'quick_link' and quick_link_id is not null and lender_id is null)
  ),
  constraint user_pinned_links_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint user_pinned_links_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint user_pinned_links_lender_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade,
  constraint user_pinned_links_quick_link_fkey
    foreign key (quick_link_id, organization_id) references public.quick_links (id, organization_id) on delete cascade,
  constraint user_pinned_links_unique unique (user_id, link_type, link_id)
);

create index if not exists user_pinned_links_lender_idx on public.user_pinned_links (lender_id) where lender_id is not null;
create index if not exists user_pinned_links_quick_link_idx on public.user_pinned_links (quick_link_id) where quick_link_id is not null;

-- A new pin goes to the end of that person's Pinned row.
create or replace function public.user_pinned_links_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sort_order = 0 then
    new.sort_order := coalesce((select max(p.sort_order) from public.user_pinned_links p where p.user_id = new.user_id), 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists user_pinned_links_order on public.user_pinned_links;
create trigger user_pinned_links_order before insert on public.user_pinned_links
  for each row execute function public.user_pinned_links_order();

alter table public.user_pinned_links enable row level security;
drop policy if exists "users see their own pins" on public.user_pinned_links;
create policy "users see their own pins" on public.user_pinned_links
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users add their own pins" on public.user_pinned_links;
create policy "users add their own pins" on public.user_pinned_links
  for insert to authenticated with check (user_id = auth.uid() and public.is_org_member(organization_id));
drop policy if exists "users remove their own pins" on public.user_pinned_links;
create policy "users remove their own pins" on public.user_pinned_links
  for delete to authenticated using (user_id = auth.uid());
-- No update policy: unpin and pin again.

-- ---------------------------------------------------------------------------
-- The lender catalog: owners and admins only (processors lose write access).
-- Reading is unchanged (everyone in the company).
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  p record;
  label text;
begin
  foreach t in array array['lenders', 'lender_contacts', 'programs', 'guideline_documents', 'guideline_document_programs', 'guideline_passages', 'matrix_versions', 'program_matrix_cells', 'program_rules', 'overlays', 'matrix_imports', 'product_updates', 'lender_comp_plans'] loop
    continue when to_regclass('public.' || t) is null;
    label := replace(t, '_', ' ');
    -- Remove every write rule on the table (the old "managers …" ones and ours from an earlier run).
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_org_role(organization_id, array[''owner'', ''admin'']::public.org_role[]))', 'admins add ' || label, t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_org_role(organization_id, array[''owner'', ''admin'']::public.org_role[])) with check (public.has_org_role(organization_id, array[''owner'', ''admin'']::public.org_role[]))', 'admins edit ' || label, t);
    -- Imports and product updates are kept as the record: still no delete.
    if t not in ('matrix_imports', 'product_updates') then
      execute format('create policy %I on public.%I for delete to authenticated using (public.has_org_role(organization_id, array[''owner'', ''admin'']::public.org_role[]))', 'admins remove ' || label, t);
    end if;
  end loop;
end $$;

-- Guideline files (storage): same rule.
do $$ begin
  if to_regprocedure('public.guideline_file_org(text)') is not null then
    drop policy if exists "losuite managers upload guideline files" on storage.objects;
    drop policy if exists "losuite managers delete guideline files" on storage.objects;
    drop policy if exists "losuite admins upload guideline files" on storage.objects;
    create policy "losuite admins upload guideline files" on storage.objects
      for insert to authenticated with check (bucket_id = 'guideline-files' and public.has_org_role(public.guideline_file_org(name), array['owner', 'admin']::public.org_role[]));
    drop policy if exists "losuite admins delete guideline files" on storage.objects;
    create policy "losuite admins delete guideline files" on storage.objects
      for delete to authenticated using (bucket_id = 'guideline-files' and public.has_org_role(public.guideline_file_org(name), array['owner', 'admin']::public.org_role[]));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Logos bucket: <organization>/<file>. Private; images only, 1 MB at most.
-- ---------------------------------------------------------------------------

-- The company a logo belongs to, or null when the path isn't that shape.
create or replace function public.logo_file_org(path text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when path ~ '^[0-9a-f-]{36}/[^/]+$' then split_part(path, '/', 1)::uuid else null end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "losuite members read logos" on storage.objects;
create policy "losuite members read logos" on storage.objects
  for select to authenticated using (bucket_id = 'logos' and public.is_org_member(public.logo_file_org(name)));
drop policy if exists "losuite admins add logos" on storage.objects;
create policy "losuite admins add logos" on storage.objects
  for insert to authenticated with check (bucket_id = 'logos' and public.has_org_role(public.logo_file_org(name), array['owner', 'admin']::public.org_role[]));
drop policy if exists "losuite admins remove logos" on storage.objects;
create policy "losuite admins remove logos" on storage.objects
  for delete to authenticated using (bucket_id = 'logos' and public.has_org_role(public.logo_file_org(name), array['owner', 'admin']::public.org_role[]));
-- No update policy: a new logo is a new file.

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ quick links installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public'
     and ((table_name = 'lenders' and column_name = 'show_in_quick_links') or (table_name = 'organizations' and column_name = 'arive_login_url'))) as new_columns,
  (select count(*) from public.quick_links where category = 'county_tax') as county_links,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('quick_links', 'user_pinned_links')) as link_policies,
  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'managers %'
     and tablename in ('lenders', 'lender_contacts', 'programs', 'guideline_documents', 'guideline_document_programs', 'guideline_passages', 'matrix_versions', 'program_matrix_cells', 'program_rules', 'overlays', 'matrix_imports', 'product_updates', 'lender_comp_plans')) as processor_write_rules_left,
  (select count(*) from storage.buckets where id = 'logos' and not public) as private_logo_bucket;
