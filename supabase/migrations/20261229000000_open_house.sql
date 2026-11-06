-- Pages, Phase 2a: open houses (Connor, 2026-11-06; docs/plans/pages.md).
-- No new tables. The home's facts and financing table live in pages.property.
--
-- 1. get_public_page() also returns the listing agent (name, brokerage, phone,
--    email) from Partners, so the public page shows the partner's current
--    details without anyone reading Partners directly.
-- 2. A visitor who signs in at an open house and becomes a NEW file gets the
--    page's listing agent on that file's team (listing_agent, linked to the
--    partner). An existing open file's team is never changed.
--
-- Safe to run more than once. A full run ends with one confirmation row.

create or replace function public.get_public_page(p_slug text, p_count_view boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.pages;
  v_owner jsonb;
  v_org jsonb;
  v_photo text;
  v_agent jsonb;
begin
  select * into v_page from public.pages where slug = lower(trim(p_slug)) and status = 'published';
  if not found then
    return null;
  end if;

  if p_count_view then
    update public.pages set view_count = view_count + 1 where id = v_page.id;
    insert into public.page_view_days (page_id, day, views)
    values (v_page.id, (now() at time zone 'America/Chicago')::date, 1)
    on conflict (page_id, day) do update set views = public.page_view_days.views + 1;
  end if;

  if v_page.owner_id is not null then
    select o.name into v_photo
    from storage.objects o
    where o.bucket_id = 'page-assets' and o.name like v_page.organization_id::text || '/headshots/' || v_page.owner_id::text || '.%'
    order by o.name
    limit 1;
    -- to_jsonb so a profile column that isn't there yet reads as null.
    select jsonb_build_object(
      'name', p.full_name,
      'nmls', p.nmls,
      'phone', coalesce(nullif(to_jsonb(p)->>'personal_cell', ''), p.phone),
      'email', p.email,
      'bookingUrl', to_jsonb(p)->>'booking_url',
      'photoPath', v_photo
    ) into v_owner
    from public.profiles p where p.id = v_page.owner_id;
  end if;

  -- Open houses: the listing agent from Partners (the partner record is the source).
  if v_page.type = 'open_house' and coalesce(v_page.property->>'agentPartnerId', '') ~ '^[0-9a-f-]{36}$' then
    select jsonb_build_object('name', pa.name, 'company', pa.company, 'phone', pa.phone, 'email', pa.email) into v_agent
    from public.partners pa
    where pa.id = (v_page.property->>'agentPartnerId')::uuid and pa.organization_id = v_page.organization_id;
  end if;

  select jsonb_build_object('name', o.name, 'nmls', coalesce(o.nmls, '2501110')) into v_org
  from public.organizations o where o.id = v_page.organization_id;

  return jsonb_build_object(
    'id', v_page.id,
    'type', v_page.type,
    'title', v_page.title,
    'slug', v_page.slug,
    'blocks', v_page.blocks,
    'settings', v_page.settings - 'tags' - 'notify' - 'leadKind',
    'property', v_page.property,
    'owner', v_owner,
    'agent', v_agent,
    'company', v_org
  );
end;
$$;

revoke all on function public.get_public_page(text, boolean) from public;
grant execute on function public.get_public_page(text, boolean) to anon, authenticated, service_role;

create or replace function public.page_submissions_link_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.pages;
  v_agent public.partners;
begin
  if new.loan_id is null or new.outcome not in ('new_lead', 'new_loan_existing_person') then
    return null;
  end if;
  select * into v_page from public.pages where id = new.page_id;
  if v_page.type <> 'open_house' or coalesce(v_page.property->>'agentPartnerId', '') !~ '^[0-9a-f-]{36}$' then
    return null;
  end if;
  select * into v_agent from public.partners where id = (v_page.property->>'agentPartnerId')::uuid and organization_id = new.organization_id;
  if not found then
    return null;
  end if;
  insert into public.loan_team_members (organization_id, loan_id, role, partner_id, name, company, email, phone)
  values (new.organization_id, new.loan_id, 'listing_agent', v_agent.id, v_agent.name, v_agent.company, v_agent.email, v_agent.phone)
  on conflict (loan_id, role) do nothing;
  return null;
exception when others then
  raise warning 'Listing agent not added for page submission %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.page_submissions_link_agent() from public, anon, authenticated;

drop trigger if exists page_submissions_link_agent on public.page_submissions;
create trigger page_submissions_link_agent
  after insert on public.page_submissions
  for each row execute function public.page_submissions_link_agent();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ open houses installed' as result,
  (select count(*) from pg_proc where proname = 'get_public_page' and pronamespace = 'public'::regnamespace and prosrc like '%agentPartnerId%') as public_page_agent,
  (select count(*) from pg_trigger where tgname = 'page_submissions_link_agent') as agent_trigger;
