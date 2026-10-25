-- LOSuite: how each savings account is used in qualifying.
--
-- down_payment: available for the down payment and closing costs (the default).
-- depletion:    counted as asset-depletion income (retirement at 70%, others
--               at 100%, divided by 360 months), not used for closing.
-- reserves:     kept in the bank; counts toward reserves only.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite asset use installed").

do $$ begin
  create type public.asset_use as enum ('down_payment', 'depletion', 'reserves');
exception when duplicate_object then null;
end $$;

alter table public.assets
  add column if not exists use_as public.asset_use not null default 'down_payment';

select
  'LOSuite asset use installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'assets' and column_name = 'use_as') as new_columns;
