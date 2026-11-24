-- MPS HQ: My assets, nurture goals Phase 2 (plan docs/plans/nurture-goals.md;
-- Connor's spec 2026-11-24).
--
-- 1. borrower_assets: the accounts a borrower keeps track of in MyHome, on the
--    PERSON (not a file), so they follow them from Nurture to Closed and to the
--    next loan: a nickname, the bank or company, a category (checking, savings,
--    cash, investment, retirement, other), the latest balance they reported and
--    its date, and notes. No account numbers (5 or more digits in a row are
--    refused) and no logins. Removing one hides it (archived_at); its history
--    stays. People who can see the person read them in MPS-HQ; only MyHome
--    (the myhome Edge Function, service role) adds or changes them: these are
--    the borrower's own numbers, never the verified 1003 assets.
-- 2. borrower_asset_balances: every balance reported, never edited or deleted.
-- 3. nurture_goals.follows_assets: a savings goal can follow the accounts the
--    borrower ticks; then the goal's reported balance is the total of those
--    accounts, updated whenever one of them changes (through
--    myhome_goal_update(), so the LO's Updates card, note and notice rules
--    are the same as a typed update).
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ borrower assets installed").

-- ---------------------------------------------------------------------------
-- 1. The accounts
-- ---------------------------------------------------------------------------

create table if not exists public.borrower_assets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  nickname         text not null check (length(trim(nickname)) between 1 and 80 and nickname !~ '[0-9]{5,}'),
  institution      text check (institution is null or (length(institution) <= 80 and institution !~ '[0-9]{5,}')),
  category         text not null check (category in ('checking', 'savings', 'cash', 'investment', 'retirement', 'other')),
  balance          numeric(14, 2) not null check (balance >= 0 and balance < 1000000000),
  balance_on       date not null,
  notes            text check (notes is null or (length(notes) <= 500 and notes !~ '[0-9]{5,}')),
  sort_order       smallint not null default 0,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint borrower_assets_contact_fkey foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade
);

create index if not exists borrower_assets_contact_idx on public.borrower_assets (contact_id, sort_order);

drop trigger if exists borrower_assets_set_updated_at on public.borrower_assets;
create trigger borrower_assets_set_updated_at before update on public.borrower_assets
  for each row execute function public.set_updated_at();

alter table public.borrower_assets enable row level security;
drop policy if exists "people who see the person see their reported assets" on public.borrower_assets;
create policy "people who see the person see their reported assets" on public.borrower_assets for select to authenticated using (public.can_see_contact(contact_id));
-- No insert, update or delete for logins: only MyHome writes the borrower's own numbers.
revoke insert, update, delete on public.borrower_assets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Their history
-- ---------------------------------------------------------------------------

create table if not exists public.borrower_asset_balances (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  asset_id         uuid not null references public.borrower_assets (id) on delete cascade,
  balance          numeric(14, 2) not null check (balance >= 0),
  balance_on       date not null,
  account_id       uuid references public.borrower_accounts (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists borrower_asset_balances_asset_idx on public.borrower_asset_balances (asset_id, balance_on desc, created_at desc);

alter table public.borrower_asset_balances enable row level security;
drop policy if exists "people who see the person see asset history" on public.borrower_asset_balances;
create policy "people who see the person see asset history" on public.borrower_asset_balances for select to authenticated using (public.can_see_contact(contact_id));
revoke insert, update, delete on public.borrower_asset_balances from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A savings goal can follow accounts
-- ---------------------------------------------------------------------------

alter table public.nurture_goals add column if not exists follows_assets uuid[] not null default '{}';

/** The goal's reported balance from the accounts it follows (skipped when nothing changed or the goal can't take updates). */
create or replace function public.nurture_goal_sync_assets(p_account uuid, p_goal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.nurture_goals;
  v_total numeric;
begin
  select * into g from public.nurture_goals where id = p_goal;
  if g.id is null or g.kind <> 'savings' or cardinality(g.follows_assets) = 0 or g.paused or g.status = 'verified_complete' then return; end if;
  if (select stage from public.loans where id = g.loan_id) <> 'nurture' then return; end if;
  select coalesce(sum(balance), 0) into v_total from public.borrower_assets
  where id = any (g.follows_assets) and contact_id = g.contact_id and archived_at is null;
  if v_total = coalesce(g.current_value, g.start_value) then return; end if;
  perform public.myhome_goal_update(p_account, p_goal, 'balance', v_total, null, 'From My assets');
end;
$$;

revoke all on function public.nurture_goal_sync_assets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nurture_goal_sync_assets(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. MyHome saves (the myhome Edge Function, service role)
-- ---------------------------------------------------------------------------

/** Adds an account (p_asset null) or changes one; a new balance or date goes in the history, and goals following it catch up. */
create or replace function public.myhome_asset_save(p_account uuid, p_asset uuid, p_nickname text, p_institution text, p_category text, p_balance numeric, p_on date, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  x public.borrower_assets;
  v_id uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_on date := coalesce(p_on, v_today);
  v_goal uuid;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  if coalesce(trim(p_nickname), '') = '' then raise exception 'Give the account a name, like "Chase savings".'; end if;
  if p_nickname ~ '[0-9]{5,}' or coalesce(p_institution, '') ~ '[0-9]{5,}' or coalesce(p_notes, '') ~ '[0-9]{5,}' then
    raise exception 'Please don''t enter account numbers. A name like "Chase savings" is enough.';
  end if;
  if p_balance is null or p_balance < 0 then raise exception 'Enter the balance.'; end if;
  if v_on > v_today then raise exception 'Use today or an earlier date.'; end if;

  if p_asset is null then
    if (select count(*) from public.borrower_assets where contact_id = a.contact_id and archived_at is null) >= 25 then
      raise exception 'That''s a lot of accounts. Remove one you don''t use first.';
    end if;
    insert into public.borrower_assets (organization_id, contact_id, nickname, institution, category, balance, balance_on, notes, sort_order)
    values (a.organization_id, a.contact_id, trim(p_nickname), nullif(trim(coalesce(p_institution, '')), ''), p_category, round(p_balance, 2), v_on,
      nullif(trim(coalesce(p_notes, '')), ''), (select coalesce(max(sort_order), 0) + 1 from public.borrower_assets where contact_id = a.contact_id))
    returning id into v_id;
    insert into public.borrower_asset_balances (organization_id, contact_id, asset_id, balance, balance_on, account_id)
    values (a.organization_id, a.contact_id, v_id, round(p_balance, 2), v_on, a.id);
    return v_id;
  end if;

  select * into x from public.borrower_assets where id = p_asset;
  if x.id is null or x.contact_id <> a.contact_id or x.archived_at is not null then raise exception 'That account isn''t in your MyHome.'; end if;
  update public.borrower_assets
  set nickname = trim(p_nickname), institution = nullif(trim(coalesce(p_institution, '')), ''), category = p_category,
      balance = round(p_balance, 2), balance_on = v_on, notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = x.id;
  if round(p_balance, 2) <> x.balance or v_on <> x.balance_on then
    insert into public.borrower_asset_balances (organization_id, contact_id, asset_id, balance, balance_on, account_id)
    values (a.organization_id, a.contact_id, x.id, round(p_balance, 2), v_on, a.id);
    for v_goal in select id from public.nurture_goals where contact_id = a.contact_id and x.id = any (follows_assets) loop
      perform public.nurture_goal_sync_assets(a.id, v_goal);
    end loop;
  end if;
  return x.id;
end;
$$;

/** Removes an account from MyHome (kept, hidden; its history stays). Goals stop following it. */
create or replace function public.myhome_asset_remove(p_account uuid, p_asset uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  x public.borrower_assets;
  v_goal uuid;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  select * into x from public.borrower_assets where id = p_asset;
  if x.id is null or x.contact_id <> a.contact_id or x.archived_at is not null then raise exception 'That account isn''t in your MyHome.'; end if;
  update public.borrower_assets set archived_at = now() where id = x.id;
  for v_goal in select id from public.nurture_goals where contact_id = a.contact_id and x.id = any (follows_assets) loop
    update public.nurture_goals set follows_assets = array_remove(follows_assets, x.id) where id = v_goal;
    perform public.nurture_goal_sync_assets(a.id, v_goal);
  end loop;
end;
$$;

/** The borrower ticks which accounts a savings goal counts (none = they type the balance themselves). */
create or replace function public.myhome_goal_follow(p_account uuid, p_goal uuid, p_assets uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
  g public.nurture_goals;
  v_assets uuid[] := coalesce(p_assets, '{}');
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  select * into g from public.nurture_goals where id = p_goal;
  if g.id is null or g.contact_id <> a.contact_id then raise exception 'That goal is not yours.'; end if;
  if g.kind <> 'savings' then raise exception 'Only a savings goal can follow your accounts.'; end if;
  if (select stage from public.loans where id = g.loan_id) <> 'nurture' then raise exception 'This plan isn''t active anymore.'; end if;
  if g.paused then raise exception 'Your loan officer paused this goal.'; end if;
  if g.status = 'verified_complete' then raise exception 'Your loan officer already marked this goal complete.'; end if;
  if exists (select 1 from unnest(v_assets) u(id) where not exists (
    select 1 from public.borrower_assets b where b.id = u.id and b.contact_id = a.contact_id and b.archived_at is null)) then
    raise exception 'Pick accounts from your MyHome.';
  end if;
  update public.nurture_goals set follows_assets = (select coalesce(array_agg(distinct x), '{}') from unnest(v_assets) x) where id = g.id;
  perform public.nurture_goal_sync_assets(a.id, g.id);
end;
$$;

revoke all on function public.myhome_asset_save(uuid, uuid, text, text, text, numeric, date, text) from public, anon, authenticated;
grant execute on function public.myhome_asset_save(uuid, uuid, text, text, text, numeric, date, text) to service_role;
revoke all on function public.myhome_asset_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function public.myhome_asset_remove(uuid, uuid) to service_role;
revoke all on function public.myhome_goal_follow(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.myhome_goal_follow(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ borrower assets installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('borrower_assets', 'borrower_asset_balances')) as tables,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('myhome_asset_save', 'myhome_asset_remove', 'myhome_goal_follow', 'nurture_goal_sync_assets')) as functions,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'nurture_goals' and column_name = 'follows_assets') as goal_link;
