-- MPS HQ: the income, expenses & savings planner, nurture goals Phase 3 (plan
-- docs/plans/nurture-goals.md; Connor's spec 2026-11-24, decision 4: the LO
-- sees the whole budget).
--
-- Optional for the borrower, on the PERSON (like My assets), kept in MyHome:
-- 1. budget_settings: their starting cash and its date, and how much they want
--    to save a month (one row per person).
-- 2. budget_items: each income or expense: a name, amount, how often (every
--    week, every two weeks, twice a month, every month, once a year, every N
--    days, just once, or "it varies"), the next date, a category, a note,
--    paused. Removing one archives it.
-- 3. budget_entries: what really came in or went out. An entry for a
--    scheduled date (item + planned_on, once per date) replaces that date's
--    projection, so nothing counts twice; an entry with no item is something
--    unplanned. Removing one (a mistake) keeps it, hidden.
-- People who can see the person read all of it in MPS-HQ (decision 4); only
-- MyHome (the myhome Edge Function, service role) writes it. The forecast
-- math is in src/lib/calc/budget.ts; projected money never counts as saved.
-- No account numbers (5+ digits in a row are refused in names and notes).
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ budget planner installed").

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

create table if not exists public.budget_settings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null unique,
  starting_cash    numeric(14, 2) check (starting_cash is null or abs(starting_cash) < 1000000000),
  starting_on      date,
  monthly_savings  numeric(12, 2) check (monthly_savings is null or monthly_savings >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint budget_settings_contact_fkey foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint budget_settings_cash_dated check ((starting_cash is null) = (starting_on is null))
);

drop trigger if exists budget_settings_set_updated_at on public.budget_settings;
create trigger budget_settings_set_updated_at before update on public.budget_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Income and expenses
-- ---------------------------------------------------------------------------

create table if not exists public.budget_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  kind             text not null check (kind in ('income', 'expense')),
  name             text not null check (length(trim(name)) between 1 and 80 and name !~ '[0-9]{5,}'),
  amount           numeric(12, 2) not null check (amount > 0 and amount < 10000000),
  schedule         text not null check (schedule in ('weekly', 'biweekly', 'semimonthly', 'monthly', 'annual', 'every_n_days', 'one_time', 'irregular')),
  every_days       smallint check (every_days is null or every_days between 1 and 366),
  next_on          date,
  category         text check (category is null or length(category) <= 40),
  notes            text check (notes is null or (length(notes) <= 500 and notes !~ '[0-9]{5,}')),
  paused           boolean not null default false,
  sort_order       smallint not null default 0,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint budget_items_contact_fkey foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint budget_items_every_days check ((schedule = 'every_n_days') = (every_days is not null)),
  constraint budget_items_dated check (schedule = 'irregular' or next_on is not null)
);

create index if not exists budget_items_contact_idx on public.budget_items (contact_id, kind, sort_order);

drop trigger if exists budget_items_set_updated_at on public.budget_items;
create trigger budget_items_set_updated_at before update on public.budget_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. What really happened
-- ---------------------------------------------------------------------------

create table if not exists public.budget_entries (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  contact_id       uuid not null,
  item_id          uuid references public.budget_items (id) on delete set null,
  kind             text not null check (kind in ('income', 'expense')),
  name             text not null check (length(trim(name)) between 1 and 80 and name !~ '[0-9]{5,}'),
  -- 0 = a scheduled one that didn't happen this time.
  amount           numeric(12, 2) not null check (amount >= 0 and amount < 10000000),
  happened_on      date not null,
  planned_on       date,
  account_id       uuid references public.borrower_accounts (id) on delete set null,
  removed_at       timestamptz,
  created_at       timestamptz not null default now(),
  constraint budget_entries_contact_fkey foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete cascade,
  constraint budget_entries_planned check (planned_on is null or item_id is not null)
);

create index if not exists budget_entries_contact_idx on public.budget_entries (contact_id, happened_on desc);
-- One confirmation per scheduled date.
create unique index if not exists budget_entries_one_per_date on public.budget_entries (item_id, planned_on) where removed_at is null and planned_on is not null;

-- ---------------------------------------------------------------------------
-- Who sees it: people who can see the person (decision 4); only MyHome writes.
-- ---------------------------------------------------------------------------

alter table public.budget_settings enable row level security;
alter table public.budget_items enable row level security;
alter table public.budget_entries enable row level security;
drop policy if exists "people who see the person see their budget" on public.budget_settings;
create policy "people who see the person see their budget" on public.budget_settings for select to authenticated using (public.can_see_contact(contact_id));
drop policy if exists "people who see the person see their budget items" on public.budget_items;
create policy "people who see the person see their budget items" on public.budget_items for select to authenticated using (public.can_see_contact(contact_id));
drop policy if exists "people who see the person see their budget entries" on public.budget_entries;
create policy "people who see the person see their budget entries" on public.budget_entries for select to authenticated using (public.can_see_contact(contact_id));
revoke insert, update, delete on public.budget_settings, public.budget_items, public.budget_entries from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. MyHome saves (the myhome Edge Function, service role)
-- ---------------------------------------------------------------------------

/** The account, if it's on. */
create or replace function public.myhome_budget_account(p_account uuid)
returns public.borrower_accounts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts;
begin
  select * into a from public.borrower_accounts where id = p_account;
  if a.id is null or a.status = 'off' then raise exception 'This MyHome account is not on.'; end if;
  return a;
end;
$$;

create or replace function public.myhome_budget_settings_save(p_account uuid, p_starting_cash numeric, p_starting_on date, p_monthly_savings numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts := public.myhome_budget_account(p_account);
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_on date := case when p_starting_cash is null then null else coalesce(p_starting_on, v_today) end;
begin
  if v_on > v_today then raise exception 'Use today or an earlier date.'; end if;
  if p_monthly_savings is not null and p_monthly_savings < 0 then raise exception 'Enter how much you want to save a month.'; end if;
  insert into public.budget_settings (organization_id, contact_id, starting_cash, starting_on, monthly_savings)
  values (a.organization_id, a.contact_id, round(p_starting_cash, 2), v_on, round(p_monthly_savings, 2))
  on conflict (contact_id) do update set starting_cash = excluded.starting_cash, starting_on = excluded.starting_on, monthly_savings = excluded.monthly_savings;
end;
$$;

create or replace function public.myhome_budget_item_save(p_account uuid, p_item uuid, p_kind text, p_name text, p_amount numeric, p_schedule text, p_every_days smallint, p_next_on date, p_category text, p_notes text, p_paused boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts := public.myhome_budget_account(p_account);
  x public.budget_items;
  v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Give it a name, like "Paycheck" or "Rent".'; end if;
  if p_name ~ '[0-9]{5,}' or coalesce(p_notes, '') ~ '[0-9]{5,}' then raise exception 'Please don''t enter account numbers.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter the amount.'; end if;
  if p_schedule = 'every_n_days' and (p_every_days is null or p_every_days < 1 or p_every_days > 366) then raise exception 'Enter how many days apart (1 to 366).'; end if;
  if p_schedule <> 'irregular' and p_next_on is null then raise exception 'Enter the next date it comes.'; end if;

  if p_item is null then
    if (select count(*) from public.budget_items where contact_id = a.contact_id and archived_at is null) >= 60 then
      raise exception 'That''s a lot of items. Remove one you don''t use first.';
    end if;
    insert into public.budget_items (organization_id, contact_id, kind, name, amount, schedule, every_days, next_on, category, notes, paused, sort_order)
    values (a.organization_id, a.contact_id, p_kind, trim(p_name), round(p_amount, 2), p_schedule, case when p_schedule = 'every_n_days' then p_every_days end,
      case when p_schedule = 'irregular' then null else p_next_on end, nullif(trim(coalesce(p_category, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), coalesce(p_paused, false),
      (select coalesce(max(sort_order), 0) + 1 from public.budget_items where contact_id = a.contact_id))
    returning id into v_id;
    return v_id;
  end if;

  select * into x from public.budget_items where id = p_item;
  if x.id is null or x.contact_id <> a.contact_id or x.archived_at is not null then raise exception 'That isn''t in your budget.'; end if;
  update public.budget_items
  set kind = p_kind, name = trim(p_name), amount = round(p_amount, 2), schedule = p_schedule,
      every_days = case when p_schedule = 'every_n_days' then p_every_days end,
      next_on = case when p_schedule = 'irregular' then null else p_next_on end,
      category = nullif(trim(coalesce(p_category, '')), ''), notes = nullif(trim(coalesce(p_notes, '')), ''), paused = coalesce(p_paused, false)
  where id = x.id;
  return x.id;
end;
$$;

create or replace function public.myhome_budget_item_remove(p_account uuid, p_item uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts := public.myhome_budget_account(p_account);
begin
  update public.budget_items set archived_at = now() where id = p_item and contact_id = a.contact_id and archived_at is null;
  if not found then raise exception 'That isn''t in your budget.'; end if;
end;
$$;

/** What really happened: for a scheduled date (p_item + p_planned_on; saving it again changes it) or something unplanned. */
create or replace function public.myhome_budget_entry_save(p_account uuid, p_item uuid, p_planned_on date, p_kind text, p_name text, p_amount numeric, p_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts := public.myhome_budget_account(p_account);
  x public.budget_items;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_on date := coalesce(p_on, p_planned_on, v_today);
  v_id uuid;
begin
  if p_amount is null or p_amount < 0 then raise exception 'Enter the amount.'; end if;
  if v_on > v_today then raise exception 'Use today or an earlier date.'; end if;
  if p_item is not null then
    select * into x from public.budget_items where id = p_item;
    if x.id is null or x.contact_id <> a.contact_id then raise exception 'That isn''t in your budget.'; end if;
    if p_planned_on is not null then
      update public.budget_entries set amount = round(p_amount, 2), happened_on = v_on
      where item_id = x.id and planned_on = p_planned_on and removed_at is null
      returning id into v_id;
      if v_id is not null then return v_id; end if;
    end if;
    insert into public.budget_entries (organization_id, contact_id, item_id, kind, name, amount, happened_on, planned_on, account_id)
    values (a.organization_id, a.contact_id, x.id, x.kind, x.name, round(p_amount, 2), v_on, p_planned_on, a.id)
    returning id into v_id;
    return v_id;
  end if;
  if p_planned_on is not null then raise exception 'Pick the item it was for.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Say what it was.'; end if;
  if p_name ~ '[0-9]{5,}' then raise exception 'Please don''t enter account numbers.'; end if;
  if p_amount = 0 then raise exception 'Enter the amount.'; end if;
  insert into public.budget_entries (organization_id, contact_id, kind, name, amount, happened_on, account_id)
  values (a.organization_id, a.contact_id, p_kind, trim(p_name), round(p_amount, 2), v_on, a.id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.myhome_budget_entry_remove(p_account uuid, p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.borrower_accounts := public.myhome_budget_account(p_account);
begin
  update public.budget_entries set removed_at = now() where id = p_entry and contact_id = a.contact_id and removed_at is null;
  if not found then raise exception 'That isn''t in your budget.'; end if;
end;
$$;

revoke all on function public.myhome_budget_account(uuid) from public, anon, authenticated;
grant execute on function public.myhome_budget_account(uuid) to service_role;
revoke all on function public.myhome_budget_settings_save(uuid, numeric, date, numeric) from public, anon, authenticated;
grant execute on function public.myhome_budget_settings_save(uuid, numeric, date, numeric) to service_role;
revoke all on function public.myhome_budget_item_save(uuid, uuid, text, text, numeric, text, smallint, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.myhome_budget_item_save(uuid, uuid, text, text, numeric, text, smallint, date, text, text, boolean) to service_role;
revoke all on function public.myhome_budget_item_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function public.myhome_budget_item_remove(uuid, uuid) to service_role;
revoke all on function public.myhome_budget_entry_save(uuid, uuid, date, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.myhome_budget_entry_save(uuid, uuid, date, text, text, numeric, date) to service_role;
revoke all on function public.myhome_budget_entry_remove(uuid, uuid) from public, anon, authenticated;
grant execute on function public.myhome_budget_entry_remove(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ budget planner installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('budget_settings', 'budget_items', 'budget_entries')) as tables,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('myhome_budget_account', 'myhome_budget_settings_save', 'myhome_budget_item_save', 'myhome_budget_item_remove', 'myhome_budget_entry_save', 'myhome_budget_entry_remove')) as functions;
