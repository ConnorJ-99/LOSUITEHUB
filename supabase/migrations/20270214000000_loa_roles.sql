-- MPS HQ: Loan Officer Assistant, step 1 (Connor, 2026-11-17).
--
-- A person keeps their primary company role (organization_members.role) and
-- can also have SECONDARY roles:
--   'loa'        Loan Officer Assistant: adds leads for the loan officers they
--                assist, runs intake interviews, texts borrowers for them.
--   'processor'  can be put in a file's Processor slot (still per file).
-- loa_assignments says which loan officers each assistant helps. Only owners
-- and admins change secondary roles and assignments (the existing "owners and
-- admins can change roles" rule on organization_members, plus the functions
-- below). Everyone in the company can read them.
--
-- Each person's link profile (profiles): display_name, title, bio_url and
-- application_url join the existing nmls and booking_url. A person edits their
-- own (Settings → My profile); owners and admins edit anyone's in Settings →
-- Team through save_member_links(). A blank application_url means the
-- application link built from the NMLS # (applicationLink in the app).
--
-- Anyone who is a processor today (primary role Processor, or in a file's
-- Processor slot) gets the Processor secondary role, so nobody drops out of
-- the Processor slot's list.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ LO assistant roles installed").

-- ---------------------------------------------------------------------------
-- 1. Secondary roles on the membership
-- ---------------------------------------------------------------------------

alter table public.organization_members add column if not exists secondary_roles text[] not null default '{}';

alter table public.organization_members drop constraint if exists organization_members_secondary_roles_check;
alter table public.organization_members add constraint organization_members_secondary_roles_check
  check (secondary_roles <@ array['loa', 'processor']::text[]);

-- Today's processors keep their place in the Processor slot's list.
update public.organization_members m
set secondary_roles = array(select distinct unnest(m.secondary_roles || array['processor']::text[]) order by 1)
where not ('processor' = any (m.secondary_roles))
  and (m.role = 'processor'
    or exists (
      select 1 from public.loan_team_members t
      join public.loans l on l.id = t.loan_id
      where t.role = 'processor' and t.profile_id = m.user_id and l.organization_id = m.organization_id
    ));

-- ---------------------------------------------------------------------------
-- 2. loa_assignments: which loan officers an assistant helps
-- ---------------------------------------------------------------------------

create table if not exists public.loa_assignments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  loa_user_id      uuid not null references public.profiles (id) on delete cascade,
  lo_user_id       uuid not null references public.profiles (id) on delete cascade,
  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint loa_assignments_one_pair unique (organization_id, loa_user_id, lo_user_id),
  constraint loa_assignments_not_self check (loa_user_id <> lo_user_id)
);

create index if not exists loa_assignments_lo_idx on public.loa_assignments (organization_id, lo_user_id);

alter table public.loa_assignments enable row level security;

drop policy if exists "members see LO assistant assignments" on public.loa_assignments;
create policy "members see LO assistant assignments" on public.loa_assignments
  for select to authenticated using (public.is_org_member(organization_id));

drop policy if exists "owners and admins add LO assistant assignments" on public.loa_assignments;
create policy "owners and admins add LO assistant assignments" on public.loa_assignments
  for insert to authenticated with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

drop policy if exists "owners and admins remove LO assistant assignments" on public.loa_assignments;
create policy "owners and admins remove LO assistant assignments" on public.loa_assignments
  for delete to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

grant select, insert, delete on public.loa_assignments to authenticated;

-- Both people must be in the company, and the assistant must have the LO Assistant role.
create or replace function public.check_loa_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organization_members where organization_id = new.organization_id and user_id = new.loa_user_id and 'loa' = any (secondary_roles)) then
    raise exception 'Give this person the Loan Officer Assistant role first.';
  end if;
  if not exists (select 1 from public.organization_members where organization_id = new.organization_id and user_id = new.lo_user_id) then
    raise exception 'That loan officer isn''t in this company.';
  end if;
  return new;
end;
$$;

revoke all on function public.check_loa_assignment() from public, anon, authenticated;
drop trigger if exists loa_assignments_check on public.loa_assignments;
create trigger loa_assignments_check before insert on public.loa_assignments
  for each row execute function public.check_loa_assignment();

-- Taking away the LO Assistant role (or removing the person) ends their assignments.
create or replace function public.clear_loa_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.loa_assignments where organization_id = old.organization_id and (loa_user_id = old.user_id or lo_user_id = old.user_id);
    return old;
  end if;
  if 'loa' = any (old.secondary_roles) and not ('loa' = any (new.secondary_roles)) then
    delete from public.loa_assignments where organization_id = new.organization_id and loa_user_id = new.user_id;
  end if;
  return new;
end;
$$;

revoke all on function public.clear_loa_assignments() from public, anon, authenticated;
drop trigger if exists organization_members_clear_loa on public.organization_members;
create trigger organization_members_clear_loa after update of secondary_roles or delete on public.organization_members
  for each row execute function public.clear_loa_assignments();

-- ---------------------------------------------------------------------------
-- 3. Link profile fields
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists bio_url text;
alter table public.profiles add column if not exists application_url text;

alter table public.profiles drop constraint if exists profiles_bio_url_https;
alter table public.profiles add constraint profiles_bio_url_https check (bio_url is null or bio_url ~* '^https://[^\s]+$');
alter table public.profiles drop constraint if exists profiles_application_url_https;
alter table public.profiles add constraint profiles_application_url_https check (application_url is null or application_url ~* '^https://[^\s]+$');

-- ---------------------------------------------------------------------------
-- 4. Owners and admins: a member's secondary roles and assignments in one step
-- ---------------------------------------------------------------------------

create or replace function public.set_member_access(p_user uuid, p_secondary text[], p_assists uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_roles text[] := array(select distinct r from unnest(coalesce(p_secondary, '{}')) r order by 1);
begin
  select m.organization_id into v_org
  from public.organization_members m
  where m.user_id = p_user
    and public.has_org_role(m.organization_id, array['owner', 'admin']::public.org_role[])
  limit 1;
  if v_org is null then
    raise exception 'Only owners and admins can change secondary roles.';
  end if;
  if not (v_roles <@ array['loa', 'processor']::text[]) then
    raise exception 'Unknown secondary role.';
  end if;
  update public.organization_members set secondary_roles = v_roles where organization_id = v_org and user_id = p_user;
  -- Assignments: exactly the loan officers picked (none without the LO Assistant role).
  delete from public.loa_assignments
  where organization_id = v_org and loa_user_id = p_user
    and (not ('loa' = any (v_roles)) or not (lo_user_id = any (coalesce(p_assists, '{}'))));
  if 'loa' = any (v_roles) then
    insert into public.loa_assignments (organization_id, loa_user_id, lo_user_id)
    select v_org, p_user, lo from unnest(coalesce(p_assists, '{}')) lo
    where lo <> p_user
    on conflict (organization_id, loa_user_id, lo_user_id) do nothing;
  end if;
end;
$$;

revoke all on function public.set_member_access(uuid, text[], uuid[]) from public, anon;
grant execute on function public.set_member_access(uuid, text[], uuid[]) to authenticated;

-- Owners and admins edit a teammate's link profile (a person can't edit anyone
-- else's profile directly). Blank = cleared.
create or replace function public.save_member_links(p_user uuid, p_links jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from public.organization_members m
    where m.user_id = p_user
      and public.has_org_role(m.organization_id, array['owner', 'admin']::public.org_role[])
  ) into v_ok;
  if not v_ok and p_user is distinct from auth.uid() then
    raise exception 'Only owners and admins can edit someone else''s profile.';
  end if;
  update public.profiles set
    display_name    = nullif(trim(coalesce(p_links ->> 'display_name', '')), ''),
    title           = nullif(trim(coalesce(p_links ->> 'title', '')), ''),
    nmls            = nullif(trim(coalesce(p_links ->> 'nmls', '')), ''),
    application_url = nullif(trim(coalesce(p_links ->> 'application_url', '')), ''),
    booking_url     = nullif(trim(coalesce(p_links ->> 'booking_url', '')), ''),
    bio_url         = nullif(trim(coalesce(p_links ->> 'bio_url', '')), '')
  where id = p_user;
end;
$$;

revoke all on function public.save_member_links(uuid, jsonb) from public, anon;
grant execute on function public.save_member_links(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ LO assistant roles installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'organization_members' and column_name = 'secondary_roles') or (table_name = 'profiles' and column_name in ('display_name', 'title', 'bio_url', 'application_url')))) as new_columns,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'loa_assignments') as assignment_policies,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('set_member_access', 'save_member_links')) as functions,
  (select count(*) from public.organization_members where 'processor' = any (secondary_roles)) as processors;
