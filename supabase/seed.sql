-- Run once on the DEV project, AFTER creating your login under
-- Authentication → Users in the Supabase dashboard.
-- Creates MPS Mortgage LLC and makes that user its owner.

with org as (
  insert into public.organizations (name, nmls)
  values ('MPS Mortgage LLC', '2501110')
  returning id
)
insert into public.organization_members (organization_id, user_id, role)
select org.id, p.id, 'owner'
from org
join public.profiles p on p.email = 'connor@mps.mortgage';

update public.profiles set full_name = 'Connor' where email = 'connor@mps.mortgage' and full_name is null;
