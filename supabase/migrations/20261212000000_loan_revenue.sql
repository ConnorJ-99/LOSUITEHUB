-- LOSuite: revenue on each loan.
--
-- Connor's compensation on a file, typed either as a percent of the loan
-- amount or as a dollar amount. Only what he typed is saved (revenue_type
-- says which); the other figure is calculated from the loan amount, so the
-- two can never disagree.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite loan revenue installed").

do $$ begin create type public.revenue_type as enum ('percent', 'amount'); exception when duplicate_object then null; end $$;

alter table public.loans
  add column if not exists revenue_type   public.revenue_type,
  add column if not exists revenue_value  numeric(12, 3) check (revenue_value >= 0);

-- A percent is at most 100; a value always says what it is.
do $$ begin
  alter table public.loans add constraint loans_revenue_shape check (
    (revenue_type is null and revenue_value is null)
    or (revenue_type is not null and revenue_value is not null and (revenue_type <> 'percent' or revenue_value <= 100))
  );
exception when duplicate_object then null; end $$;

select
  'LOSuite loan revenue installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loans' and column_name in ('revenue_type', 'revenue_value')) as revenue_columns;
