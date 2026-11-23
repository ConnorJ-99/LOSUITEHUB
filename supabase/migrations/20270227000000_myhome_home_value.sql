-- MPS HQ: MyHome, closed view Step B (the automatic home value estimate;
-- plan docs/plans/myhome.md section 5, approved 2026-11-20).
--
-- 1. home_price_index: the FHFA House Price Index (all-transactions,
--    quarterly, not seasonally adjusted, 1995 Q1 = 100) for the two DFW
--    areas: Dallas-Plano-Irving (19124) and Fort Worth-Arlington-Grapevine
--    (23104). Public data shared by the whole app: any login can read it, only
--    the hpi-refresh Edge Function (service role) writes it.
-- 2. home_price_index_runs: each refresh (when, where from, how many quarters,
--    or what went wrong), for Settings → Home value index.
-- 3. loans.appraised_value: the appraised value at closing, the starting value
--    for a refinance's estimate (a purchase starts from its price). Typed on a
--    closed file's Overview. Ends with grant_loan_columns().
-- 4. A weekly timer (Mondays) asks hpi-refresh to load the latest quarters;
--    FHFA publishes once a quarter, so most runs find nothing new. Uses the
--    same Vault entries as the other timers.
--
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ MyHome home value installed").

-- ---------------------------------------------------------------------------
-- 1. The index
-- ---------------------------------------------------------------------------

create table if not exists public.home_price_index (
  series     text not null check (series in ('19124', '23104')),
  year       smallint not null check (year between 1975 and 2100),
  quarter    smallint not null check (quarter between 1 and 4),
  index      numeric(10, 2) not null check (index > 0),
  source     text not null check (source in ('fhfa', 'fred')),
  loaded_at  timestamptz not null default now(),
  primary key (series, year, quarter)
);

alter table public.home_price_index enable row level security;
drop policy if exists "anyone signed in reads the home price index" on public.home_price_index;
create policy "anyone signed in reads the home price index" on public.home_price_index
  for select to authenticated using (true);
revoke insert, update, delete on public.home_price_index from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Refresh log
-- ---------------------------------------------------------------------------

create table if not exists public.home_price_index_runs (
  id        uuid primary key default gen_random_uuid(),
  ran_at    timestamptz not null default now(),
  source    text check (source in ('fhfa', 'fred')),
  quarters  integer not null default 0,
  latest    text,
  problem   text
);

alter table public.home_price_index_runs enable row level security;
drop policy if exists "anyone signed in reads index refreshes" on public.home_price_index_runs;
create policy "anyone signed in reads index refreshes" on public.home_price_index_runs
  for select to authenticated using (true);
revoke insert, update, delete on public.home_price_index_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Appraised value at closing
-- ---------------------------------------------------------------------------

alter table public.loans add column if not exists appraised_value numeric(14, 2);
do $$ begin
  alter table public.loans add constraint loans_appraised_value_check check (appraised_value is null or (appraised_value > 0 and appraised_value < 100000000));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 4. The weekly refresh
-- ---------------------------------------------------------------------------

create or replace function public.scheduled_hpi_refresh()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_anon text;
  v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'losuite_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'ghl_webhook_secret' limit 1;
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'losuite_anon_key' limit 1;
  if coalesce(trim(v_url), '') = '' or coalesce(trim(v_key), '') = '' or coalesce(trim(v_anon), '') = '' then
    return 'Skipped: add losuite_project_url, ghl_webhook_secret and losuite_anon_key in Supabase Vault first.';
  end if;
  select net.http_post(
    url := rtrim(trim(v_url), '/') || '/functions/v1/hpi-refresh?key=' || trim(v_key),
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || trim(v_anon)),
    timeout_milliseconds := 120000
  ) into v_request;
  return 'Asked hpi-refresh for the latest index (request ' || v_request || ').';
end;
$$;

revoke all on function public.scheduled_hpi_refresh() from public, anon, authenticated;

select cron.schedule('mpshq-hpi-refresh', '41 14 * * 1', 'select public.scheduled_hpi_refresh()');

select public.grant_loan_columns();

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ MyHome home value installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('home_price_index', 'home_price_index_runs')) as tables,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name = 'appraised_value') as columns,
  (select count(*) from cron.job where jobname = 'mpshq-hpi-refresh') as timers;
