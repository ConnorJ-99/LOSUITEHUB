-- LOSuite: the Team section in Settings (Connor, 2026-10-29).
--
-- 1. add_member_by_email(): an owner or admin adds an existing login (made in
--    Supabase under Authentication → Users) to the company by email. A login
--    isn't visible to the app until it shares a company, so this looks it up
--    as the database owner after checking the caller is an owner or admin.
-- 2. A guard on team changes made from the app (any route, not only the
--    Settings screen):
--    - the company always keeps at least one owner (the last owner can't be
--      removed or given another role);
--    - only an owner can make someone an owner, or change or remove an owner.
--      Admins manage everyone else.
--    The SQL Editor and Supabase itself (no signed-in app user) are not
--    limited, so a mistake can always be fixed by hand.
--
-- Apply to the DEV Supabase project only, after the closed clients script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite team settings installed").

-- ---------------------------------------------------------------------------
-- 1. Add a member by email
-- ---------------------------------------------------------------------------

create or replace function public.add_member_by_email(p_organization_id uuid, p_email text, p_role public.org_role)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
begin
  if not public.has_org_role(p_organization_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'Only owners and admins can add people to the team.';
  end if;
  if v_email = '' then
    raise exception 'Type the person''s email.';
  end if;

  select p.id into v_user from public.profiles p where lower(p.email) = v_email limit 1;
  if v_user is null then
    -- A login whose profile was never made: make it now.
    insert into public.profiles (id, email, full_name)
    select u.id, u.email, u.raw_user_meta_data ->> 'full_name'
    from auth.users u
    where lower(u.email) = v_email
    limit 1
    returning id into v_user;
  end if;
  if v_user is null then
    raise exception 'No LOSuite login uses %. Create it in Supabase first (Authentication → Users → Add user), then add it here.', v_email;
  end if;

  if exists (select 1 from public.organization_members m where m.organization_id = p_organization_id and m.user_id = v_user) then
    raise exception '% is already on the team.', v_email;
  end if;
  if exists (select 1 from public.organization_members m where m.user_id = v_user) then
    raise exception '% belongs to another company.', v_email;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (p_organization_id, v_user, p_role);
  return v_user;
end;
$$;

revoke all on function public.add_member_by_email(uuid, text, public.org_role) from public;
grant execute on function public.add_member_by_email(uuid, text, public.org_role) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guard: at least one owner, and only owners manage owners
-- ---------------------------------------------------------------------------

create or replace function public.guard_team_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_org uuid;
begin
  -- The SQL Editor and Supabase itself have no signed-in user: not limited.
  if v_me is not null then
    v_org := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;

    if ((tg_op <> 'INSERT' and old.role = 'owner') or (tg_op <> 'DELETE' and new.role = 'owner'))
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id = v_org and m.user_id = v_me and m.role = 'owner'
      ) then
      raise exception 'Only an owner can make someone an owner, or change or remove an owner.';
    end if;

    if tg_op <> 'INSERT' and old.role = 'owner'
      and (tg_op = 'DELETE' or new.role <> 'owner' or new.organization_id <> old.organization_id)
      and not exists (
        select 1 from public.organization_members m
        where m.organization_id = old.organization_id and m.role = 'owner' and m.user_id <> old.user_id
      ) then
      raise exception 'The company needs at least one owner. Make someone else an owner first.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_team_change() from public;

drop trigger if exists guard_team_change on public.organization_members;
create trigger guard_team_change
  before insert or update or delete on public.organization_members
  for each row execute function public.guard_team_change();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite team settings installed' as result,
  (select count(*) from pg_proc where proname in ('add_member_by_email', 'guard_team_change') and pronamespace = 'public'::regnamespace) as functions,
  (select count(*) from pg_trigger where tgname = 'guard_team_change' and tgrelid = 'public.organization_members'::regclass) as guards,
  (select string_agg(p.email || ' (' || m.role || ')', ', ' order by p.email) from public.organization_members m
     join public.profiles p on p.id = m.user_id) as team;
