-- LOSuite: GoHighLevel connection, Phase 1 (Connor, 2026-10-29; plan in
-- docs/plans/ghl-messaging.md). No messages yet: this only connects LOSuite
-- to the MPS Mortgage sub-account, links team members to their GHL users,
-- and holds the sending settings and a log of GHL calls.
--
-- 1. contacts.ghl_contact_id: the GHL contact a person is linked to (one per
--    company). Only LOSuite's matching sets it (later phases), never typed by
--    hand from the app.
-- 2. ghl_user_links: each team member's GHL user, number and email. Owners
--    and admins link people through the "ghl" Edge Function, which confirms
--    with GHL that the number is assigned to that user. Texts only ever go
--    from the assigned loan officer's own confirmed number.
-- 3. messaging_settings: one row per company. The hours messages may go out
--    (default Mon–Sat 9am–9pm, Sun noon–9pm, Central time; Connor is
--    confirming with compliance) and whether mps.mortgage is verified for
--    sending email in GHL (yes = LOs email from their own address, no =
--    info@mps.mortgage).
-- 4. ghl_calls: every call LOSuite makes to GHL (when, what, answer code,
--    GHL ids). Never the token or message text. Kept; no edits or deletes.
--
-- Apply to the DEV Supabase project only, after the team settings script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite GHL connection installed").

-- ---------------------------------------------------------------------------
-- 1. A person's GHL contact
-- ---------------------------------------------------------------------------

alter table public.contacts add column if not exists ghl_contact_id text;

create unique index if not exists contacts_ghl_contact_id_key
  on public.contacts (organization_id, ghl_contact_id) where ghl_contact_id is not null;

-- A wrong link would put one person's texts on another person's file, so the
-- app can't set it directly. LOSuite's own matching functions turn on
-- losuite.ghl_link for their transaction; Edge Functions using the service
-- role and the SQL Editor (no signed-in user) aren't limited.
create or replace function public.guard_ghl_contact_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
    and coalesce(current_setting('losuite.ghl_link', true), '') <> 'on'
    and new.ghl_contact_id is distinct from (case when tg_op = 'UPDATE' then old.ghl_contact_id end) then
    raise exception 'A person''s GHL link is set by LOSuite''s matching, not by hand.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_ghl_contact_id() from public;

drop trigger if exists guard_ghl_contact_id on public.contacts;
create trigger guard_ghl_contact_id
  before insert or update of ghl_contact_id on public.contacts
  for each row execute function public.guard_ghl_contact_id();

-- ---------------------------------------------------------------------------
-- 2. Team members' GHL users
-- ---------------------------------------------------------------------------

create table if not exists public.ghl_user_links (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  profile_id           uuid not null,
  ghl_user_id          text not null check (length(trim(ghl_user_id)) > 0),
  ghl_name             text,
  ghl_email            text,
  -- E.164, e.g. +12145550100: the number GHL shows assigned to this user.
  ghl_number           text,
  -- The last check that found ghl_number assigned to ghl_user_id in GHL.
  -- Empty = not confirmed, and nothing will text from it.
  number_confirmed_at  timestamptz,
  checked_at           timestamptz not null default now(),
  linked_by            uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ghl_user_links_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint ghl_user_links_profile_id_fkey
    foreign key (profile_id) references public.profiles (id) on delete cascade,
  constraint ghl_user_links_linked_by_fkey
    foreign key (linked_by) references public.profiles (id) on delete set null,
  constraint ghl_user_links_one_per_person unique (organization_id, profile_id),
  constraint ghl_user_links_one_per_ghl_user unique (organization_id, ghl_user_id),
  constraint ghl_user_links_confirmed_has_number check (number_confirmed_at is null or ghl_number is not null)
);

create or replace trigger ghl_user_links_set_updated_at
  before update on public.ghl_user_links
  for each row execute function public.set_updated_at();

alter table public.ghl_user_links enable row level security;
drop policy if exists "members see GHL links" on public.ghl_user_links;
create policy "members see GHL links" on public.ghl_user_links
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "owners and admins link GHL users" on public.ghl_user_links;
create policy "owners and admins link GHL users" on public.ghl_user_links
  for insert to authenticated with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and exists (select 1 from public.organization_members m where m.organization_id = ghl_user_links.organization_id and m.user_id = ghl_user_links.profile_id)
  );
drop policy if exists "owners and admins update GHL links" on public.ghl_user_links;
create policy "owners and admins update GHL links" on public.ghl_user_links
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and exists (select 1 from public.organization_members m where m.organization_id = ghl_user_links.organization_id and m.user_id = ghl_user_links.profile_id)
  );
drop policy if exists "owners and admins unlink GHL users" on public.ghl_user_links;
create policy "owners and admins unlink GHL users" on public.ghl_user_links
  for delete to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- ---------------------------------------------------------------------------
-- 3. Sending settings
-- ---------------------------------------------------------------------------

-- Hours look like {"mon": ["09:00", "21:00"], ..., "sun": ["12:00", "21:00"]}:
-- every day listed, each either null (nothing goes out that day) or a start
-- and end time with the start first.
create or replace function public.valid_send_hours(hours jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text;
  v jsonb;
begin
  if hours is null or jsonb_typeof(hours) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(hours)) <> 7 then
    return false;
  end if;
  foreach d in array array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] loop
    if not hours ? d then
      return false;
    end if;
    v := hours -> d;
    continue when jsonb_typeof(v) = 'null';
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2
      or coalesce(v ->> 0, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(v ->> 1, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or (v ->> 0) >= (v ->> 1) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create table if not exists public.messaging_settings (
  organization_id        uuid primary key,
  time_zone              text not null default 'America/Chicago',
  send_hours             jsonb not null default
    '{"mon": ["09:00", "21:00"], "tue": ["09:00", "21:00"], "wed": ["09:00", "21:00"], "thu": ["09:00", "21:00"], "fri": ["09:00", "21:00"], "sat": ["09:00", "21:00"], "sun": ["12:00", "21:00"]}'::jsonb,
  email_domain_verified  boolean not null default false,
  updated_by             uuid,
  updated_at             timestamptz not null default now(),
  constraint messaging_settings_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint messaging_settings_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null,
  constraint messaging_settings_send_hours_check check (public.valid_send_hours(send_hours))
);

create or replace trigger messaging_settings_set_updated_at
  before update on public.messaging_settings
  for each row execute function public.set_updated_at();

alter table public.messaging_settings enable row level security;
drop policy if exists "members see messaging settings" on public.messaging_settings;
create policy "members see messaging settings" on public.messaging_settings
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "owners and admins add messaging settings" on public.messaging_settings;
create policy "owners and admins add messaging settings" on public.messaging_settings
  for insert to authenticated with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
drop policy if exists "owners and admins change messaging settings" on public.messaging_settings;
create policy "owners and admins change messaging settings" on public.messaging_settings
  for update to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]))
  with check (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));

-- Every company starts with the defaults (a company added later gets them
-- from the app until someone saves).
insert into public.messaging_settings (organization_id)
select o.id from public.organizations o
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. GHL call log
-- ---------------------------------------------------------------------------

create table if not exists public.ghl_calls (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null,
  called_at        timestamptz not null default now(),
  called_by        uuid,
  -- The LOSuite task, e.g. token_check or link_user.
  task             text not null,
  method           text not null,
  -- The path only, e.g. /users/search: no query string, never the token.
  endpoint         text not null,
  http_status      integer,
  -- works, missing_scope, bad_token or failed.
  result           text not null,
  detail           text,
  ghl_ids          jsonb not null default '{}'::jsonb,
  constraint ghl_calls_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint ghl_calls_called_by_fkey
    foreign key (called_by) references public.profiles (id) on delete set null,
  constraint ghl_calls_endpoint_no_query check (position('?' in endpoint) = 0)
);

create index if not exists ghl_calls_organization_id_idx on public.ghl_calls (organization_id, called_at desc);

alter table public.ghl_calls enable row level security;
drop policy if exists "owners and admins see GHL calls" on public.ghl_calls;
create policy "owners and admins see GHL calls" on public.ghl_calls
  for select to authenticated using (public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[]));
drop policy if exists "owners and admins log GHL calls" on public.ghl_calls;
create policy "owners and admins log GHL calls" on public.ghl_calls
  for insert to authenticated with check (
    public.has_org_role(organization_id, array['owner', 'admin']::public.org_role[])
    and called_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite GHL connection installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('ghl_user_links', 'messaging_settings', 'ghl_calls')) as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'ghl_contact_id') as contact_column,
  (select count(*) from pg_trigger where tgname = 'guard_ghl_contact_id' and tgrelid = 'public.contacts'::regclass) as guards,
  (select count(*) from public.messaging_settings) as companies_with_settings;
