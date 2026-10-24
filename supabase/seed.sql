-- Run on the DEV project after creating your login under
-- Authentication → Users in the Supabase dashboard.
-- Creates MPS Mortgage LLC and makes that user its owner.
-- Safe to run more than once: each step skips what already exists.

-- 1. Give every login a profile. Logins created before the foundation
--    migration ran never got one from the trigger.
insert into public.profiles (id, email, full_name)
select u.id, u.email, u.raw_user_meta_data ->> 'full_name'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set full_name = 'Connor'
where lower(email) = 'connor@mps.mortgage' and full_name is null;

-- 2. Create the organization if it doesn't exist yet.
insert into public.organizations (name, nmls)
select 'MPS Mortgage LLC', '2501110'
where not exists (select 1 from public.organizations where nmls = '2501110');

-- 3. Make Connor the owner of the original (oldest) MPS organization.
insert into public.organization_members (organization_id, user_id, role)
select (select id from public.organizations where nmls = '2501110' order by created_at limit 1), p.id, 'owner'
from public.profiles p
where lower(p.email) = 'connor@mps.mortgage'
on conflict (organization_id, user_id) do nothing;

-- 4. Remove duplicate MPS organizations left by earlier runs that have no members.
delete from public.organizations o
where o.nmls = '2501110'
  and not exists (select 1 from public.organization_members m where m.organization_id = o.id);

-- 5. Show every login with its organization and role, to confirm it worked.
select p.email, o.name as organization, m.role
from public.profiles p
left join public.organization_members m on m.user_id = p.id
left join public.organizations o on o.id = m.organization_id
order by p.email;
