-- LOSuite Phase 0 foundation: organizations, user profiles and memberships.
-- Every table has Row Level Security, scoped by organization (CLAUDE.md rule 6).
-- Apply to the DEV Supabase project only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  nmls        text,
  created_at  timestamptz not null default now()
);

-- One profile per Supabase Auth user. Deleting the auth user removes the profile.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  nmls        text,
  created_at  timestamptz not null default now()
);

create type public.org_role as enum ('owner', 'admin', 'loan_officer', 'processor');

-- Which users belong to which organization, and with what role.
-- Deleting either the organization or the user removes the membership.
create table public.organization_members (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             public.org_role not null default 'loan_officer',
  created_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);

-- ---------------------------------------------------------------------------
-- Helper functions used by RLS policies. SECURITY DEFINER so policies on
-- organization_members can check membership without recursing into themselves.
-- ---------------------------------------------------------------------------

create function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

create function public.has_org_role(org uuid, roles public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

-- Users who share at least one organization with the current user.
create function public.shares_org_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and theirs.user_id = other_user
  );
$$;

-- ---------------------------------------------------------------------------
-- Create a profile automatically whenever a new auth user is created.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

-- organizations: members can see their org; owners/admins can edit it.
create policy "members can view their organization"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

create policy "owners and admins can update their organization"
  on public.organizations for update
  to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.org_role[]));

-- profiles: see yourself and teammates; edit only yourself.
create policy "users can view themselves and teammates"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.shares_org_with(id));

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- organization_members: members see the roster; owners/admins manage it.
create policy "members can view their organization roster"
  on public.organization_members for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "owners and admins can add members"
  on public.organization_members for insert
  to authenticated
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "owners and admins can change roles"
  on public.organization_members for update
  to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

create policy "owners and admins can remove members"
  on public.organization_members for delete
  to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
