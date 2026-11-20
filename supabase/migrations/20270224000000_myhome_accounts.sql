-- MPS HQ: MyHome, Stage 1 (accounts and sign-in; plan docs/plans/myhome.md,
-- approved by Connor 2026-11-19).
--
-- MyHome is the borrower's lifelong account at /myhome: one login per person
-- (contact), showing every file they're a borrower on. Each account has a
-- permanent 6-digit MyHome code and a personal link that never expires
-- (Connor, 2026-11-20). "Send MyHome code to GHL" (the ghl function) writes
-- them to the person's GHL contact (home_management_code /
-- home_management_link) and adds the tag "home management code", which starts
-- Connor's GHL email workflow; nothing else sends them. Borrowers sign in with
-- their email + code, or the link + their email; they never get a password, a
-- staff profile or an organization_members row, so every existing RLS rule
-- keeps them out of MPS-HQ's tables. All their reads and writes go through the
-- `myhome` Edge Function (service role), which checks the account itself.
--
-- 1. borrower_accounts   one row per person Connor invites: the code and link
--                        token (readable only by the service role), the login
--                        it's tied to once they sign in, status (invited /
--                        active / off), who invited them, when the code last
--                        went to GHL, last sign-in. Staff who can see the
--                        person read the rest; only invite_to_myhome(),
--                        turn_off_myhome() and the Edge Functions change it.
-- 2. myhome_events       every MyHome invite, code, sign-in and (later
--                        stages) request, with the person and file. Staff
--                        who can see the person (and file) read it; only the
--                        functions here and the Edge Function add rows.
-- 3. Logins stay apart:  handle_new_user() makes no staff profile for a
--                        MyHome login, and a MyHome login can't join the team
--                        (trigger on organization_members, so every path is
--                        covered, Settings → Team included).
-- 4. myhome_auth_user(), myhome_accounts_for_email()  the Edge Function's
--                        lookups by email (service role only).
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome accounts installed").

-- ---------------------------------------------------------------------------
-- 0. One-time upgrade from the first Stage 1 draft (run on dev 2026-11-19):
--    its borrower_accounts had no code, link or code_sent_at columns. Both
--    tables were still empty, so an empty first-draft pair is removed and
--    rebuilt below. A table with rows is never touched.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.borrower_accounts') is not null
     and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'borrower_accounts' and column_name = 'invite_token') then
    if exists (select 1 from public.borrower_accounts)
       or (to_regclass('public.myhome_events') is not null and exists (select 1 from public.myhome_events)) then
      raise exception 'MyHome first-draft tables have rows; stopping so nothing is lost';
    end if;
    drop table if exists public.myhome_events;
    drop table public.borrower_accounts;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Accounts
-- ---------------------------------------------------------------------------

create table if not exists public.borrower_accounts (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  contact_id          uuid not null,
  -- The Supabase login, set by the Edge Function the first time they ask for a code.
  user_id             uuid,
  status              text not null default 'invited' check (status in ('invited', 'active', 'off')),
  -- The permanent MyHome code and the token in the personal link (/myhome?invite=…), made by
  -- invite_to_myhome(), changed only by its "new code". The service role alone reads them.
  invite_code         text not null check (invite_code ~ '^[0-9]{6}$'),
  invite_token        text not null check (invite_token ~ '^[0-9a-f]{64}$'),
  -- When "Send MyHome code to GHL" last wrote them to the person's GHL contact.
  code_sent_at        timestamptz,
  invited_by          uuid,
  invited_at          timestamptz not null default now(),
  activated_at        timestamptz,
  last_signed_in_at   timestamptz,
  turned_off_at       timestamptz,
  turned_off_by       uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint borrower_accounts_contact_key unique (contact_id),
  constraint borrower_accounts_user_key unique (user_id),
  constraint borrower_accounts_token_key unique (invite_token),
  constraint borrower_accounts_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint borrower_accounts_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  -- Deleting the login in Supabase leaves the account; the next code makes a new login.
  constraint borrower_accounts_user_id_fkey
    foreign key (user_id) references auth.users (id) on delete set null,
  constraint borrower_accounts_invited_by_fkey
    foreign key (invited_by) references public.profiles (id) on delete set null,
  constraint borrower_accounts_turned_off_by_fkey
    foreign key (turned_off_by) references public.profiles (id) on delete set null
);

create index if not exists borrower_accounts_org_idx on public.borrower_accounts (organization_id);

create or replace trigger borrower_accounts_set_updated_at
  before update on public.borrower_accounts
  for each row execute function public.set_updated_at();

alter table public.borrower_accounts enable row level security;
drop policy if exists "people who see the person see their MyHome account" on public.borrower_accounts;
create policy "people who see the person see their MyHome account" on public.borrower_accounts
  for select to authenticated using (public.can_see_contact(contact_id));
-- No insert, update or delete policy: invite_to_myhome(), turn_off_myhome() and the Edge Functions only.
revoke insert, update, delete on public.borrower_accounts from anon, authenticated;
-- The code and link token are sign-in secrets: logins read every column but those two.
revoke select on public.borrower_accounts from anon, authenticated;
grant select (id, organization_id, contact_id, user_id, status, code_sent_at, invited_by, invited_at, activated_at, last_signed_in_at, turned_off_at, turned_off_by, created_at, updated_at)
  on public.borrower_accounts to authenticated;

-- A random 6-digit code and 64-character link token (gen_random_uuid is cryptographically random).
create or replace function public.myhome_new_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select lpad(((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
$$;

create or replace function public.myhome_new_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

revoke all on function public.myhome_new_code() from public, anon, authenticated;
revoke all on function public.myhome_new_token() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Events
-- ---------------------------------------------------------------------------

create table if not exists public.myhome_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  account_id       uuid not null,
  contact_id       uuid not null,
  -- The file it's about; null for account-wide events (invite, code, sign-in).
  loan_id          uuid,
  kind             text not null check (kind in (
                     'invited', 'new_code', 'turned_off', 'code_sent', 'code_wrong', 'code_refused', 'signed_in', 'opened',
                     'upload', 'pdf', 'home_request', 'numbers_updated',
                     'recheck_requested', 'value_check_requested', 'refi_check_requested', 'equity_check_requested', 'start_new')),
  -- Small facts about the event (never an SSN or a full account number).
  detail           jsonb not null default '{}'::jsonb,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  -- For requests (later stages): when someone on the team handled it.
  handled_at       timestamptz,
  handled_by       uuid,
  constraint myhome_events_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint myhome_events_account_id_fkey
    foreign key (account_id) references public.borrower_accounts (id) on delete cascade,
  constraint myhome_events_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint myhome_events_loan_id_fkey
    foreign key (loan_id, organization_id) references public.loans (id, organization_id) on delete cascade,
  constraint myhome_events_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint myhome_events_handled_by_fkey
    foreign key (handled_by) references public.profiles (id) on delete set null
);

create index if not exists myhome_events_account_idx on public.myhome_events (account_id, created_at desc);
create index if not exists myhome_events_loan_idx on public.myhome_events (loan_id, created_at desc) where loan_id is not null;

alter table public.myhome_events enable row level security;
drop policy if exists "people who see the person see MyHome events" on public.myhome_events;
create policy "people who see the person see MyHome events" on public.myhome_events
  for select to authenticated using (public.can_see_contact(contact_id) and (loan_id is null or public.can_see_loan(loan_id)));
revoke insert, update, delete on public.myhome_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invite and turn off (people on the team who can see the person)
-- ---------------------------------------------------------------------------

-- Invites a person to MyHome (making their code and link), or again after their account was turned off.
-- p_new_code makes a new code and link; the old ones stop working.
-- Their email on the contact is how they sign in; a staff login's email is refused.
drop function if exists public.invite_to_myhome(uuid);
create or replace function public.invite_to_myhome(p_contact_id uuid, p_new_code boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact record;
  v_account public.borrower_accounts;
  v_email text;
begin
  select c.id, c.organization_id, c.email into v_contact from public.contacts c where c.id = p_contact_id;
  if v_contact.id is null or not public.can_see_contact(p_contact_id) or not public.is_org_member(v_contact.organization_id) then
    raise exception 'That person isn''t on a file you can see.';
  end if;
  v_email := lower(trim(coalesce(v_contact.email, '')));
  if v_email = '' then
    raise exception 'Add their email first: it''s how they sign in to MyHome.';
  end if;
  if exists (
    select 1 from public.profiles p join public.organization_members m on m.user_id = p.id
    where lower(trim(p.email)) = v_email
  ) then
    raise exception 'That email is an MPS-HQ team login. Use the borrower''s personal email for MyHome.';
  end if;
  if exists (
    select 1 from public.contacts c
    where c.organization_id = v_contact.organization_id and c.id <> p_contact_id and lower(trim(c.email)) = v_email
      and exists (select 1 from public.borrower_accounts a where a.contact_id = c.id and a.status <> 'off')
  ) then
    raise exception 'Someone else with that email already has MyHome. Each person needs their own email.';
  end if;

  select * into v_account from public.borrower_accounts where contact_id = p_contact_id;
  if v_account.id is null then
    insert into public.borrower_accounts (organization_id, contact_id, invited_by, invite_code, invite_token)
    values (v_contact.organization_id, p_contact_id, auth.uid(), public.myhome_new_code(), public.myhome_new_token())
    returning * into v_account;
    insert into public.myhome_events (organization_id, account_id, contact_id, kind, created_by)
    values (v_account.organization_id, v_account.id, p_contact_id, 'invited', auth.uid());
  elsif v_account.status = 'off' then
    update public.borrower_accounts
    set status = case when user_id is null then 'invited' else 'active' end,
        invited_by = auth.uid(), invited_at = now(), turned_off_at = null, turned_off_by = null
    where id = v_account.id
    returning * into v_account;
    insert into public.myhome_events (organization_id, account_id, contact_id, kind, created_by)
    values (v_account.organization_id, v_account.id, p_contact_id, 'invited', auth.uid());
  end if;

  if p_new_code then
    update public.borrower_accounts set invite_code = public.myhome_new_code(), invite_token = public.myhome_new_token(), code_sent_at = null
    where id = v_account.id;
    insert into public.myhome_events (organization_id, account_id, contact_id, kind, created_by)
    values (v_account.organization_id, v_account.id, p_contact_id, 'new_code', auth.uid());
  end if;
  return v_account.id;
end;
$$;

revoke all on function public.invite_to_myhome(uuid, boolean) from public, anon;
grant execute on function public.invite_to_myhome(uuid, boolean) to authenticated;

-- Turns a person's MyHome off: the Edge Function refuses every call from their login until they're invited again.
create or replace function public.turn_off_myhome(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.borrower_accounts;
begin
  select * into v_account from public.borrower_accounts where id = p_account_id;
  if v_account.id is null or not public.can_see_contact(v_account.contact_id) or not public.is_org_member(v_account.organization_id) then
    raise exception 'That MyHome account isn''t one you can see.';
  end if;
  if v_account.status = 'off' then
    return;
  end if;
  update public.borrower_accounts set status = 'off', turned_off_at = now(), turned_off_by = auth.uid() where id = p_account_id;
  insert into public.myhome_events (organization_id, account_id, contact_id, kind, created_by)
  values (v_account.organization_id, v_account.id, v_account.contact_id, 'turned_off', auth.uid());
end;
$$;

revoke all on function public.turn_off_myhome(uuid) from public, anon;
grant execute on function public.turn_off_myhome(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. MyHome logins stay out of the staff side
-- ---------------------------------------------------------------------------

-- A MyHome login (marked by the Edge Function in the login's app metadata, which only the server can set) gets no staff profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'myhome', '') = 'true' then
    return new;
  end if;
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

-- No path (Settings → Team, the SQL Editor, anything later) puts a MyHome login on the team.
create or replace function public.guard_myhome_login_not_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.borrower_accounts a where a.user_id = new.user_id)
     or exists (select 1 from auth.users u where u.id = new.user_id and coalesce(u.raw_app_meta_data ->> 'myhome', '') = 'true') then
    raise exception 'That login is a borrower''s MyHome account, not a team login. Make a separate login for the team member.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_myhome_login_not_staff() from public, anon, authenticated;
drop trigger if exists organization_members_not_myhome on public.organization_members;
create trigger organization_members_not_myhome before insert or update of user_id on public.organization_members
  for each row execute function public.guard_myhome_login_not_staff();

-- ---------------------------------------------------------------------------
-- 4. The Edge Function's lookup of a login by email (service role only)
-- ---------------------------------------------------------------------------

drop function if exists public.myhome_auth_user(text);
create or replace function public.myhome_auth_user(p_email text)
returns table (user_id uuid, is_myhome boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, coalesce(u.raw_app_meta_data ->> 'myhome', '') = 'true'
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

revoke all on function public.myhome_auth_user(text) from public, anon, authenticated;
grant execute on function public.myhome_auth_user(text) to service_role;

-- The accounts whose person has this email (case and spaces ignored), for signing in with email + code.
drop function if exists public.myhome_accounts_for_email(text);
create or replace function public.myhome_accounts_for_email(p_email text)
returns table (account_id uuid, status text, user_id uuid, organization_id uuid, contact_id uuid, contact_email text, invite_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.status, a.user_id, a.organization_id, a.contact_id, c.email, a.invite_code
  from public.borrower_accounts a
  join public.contacts c on c.id = a.contact_id
  where lower(trim(c.email)) = lower(trim(p_email));
$$;

revoke all on function public.myhome_accounts_for_email(text) from public, anon, authenticated;
grant execute on function public.myhome_accounts_for_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ MyHome accounts installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('borrower_accounts', 'myhome_events')) as tables,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in ('borrower_accounts', 'myhome_events')) as policies,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('invite_to_myhome', 'turn_off_myhome', 'guard_myhome_login_not_staff', 'myhome_auth_user', 'myhome_accounts_for_email', 'myhome_new_code', 'myhome_new_token')) as functions,
  (select count(*) from pg_trigger where tgname = 'organization_members_not_myhome') as staff_guard;
