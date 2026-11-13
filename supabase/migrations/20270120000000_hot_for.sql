-- MPS HQ: Hot programs per qualifying type (Connor, 2026-11-13).
--
-- Replaces the one on/off "Hot" flag (20270117) with programs.hot_for: the
-- qualifying types Connor uses this lender's program for, set on the Lenders
-- page. A type is the program's family for agency loans ('conventional',
-- 'fha', 'va', 'usda', 'jumbo') or, for Non-QM, the income documentation
-- ('bank_statement' covers 12 and 24 months, 'dscr', 'full_doc', …). Match
-- lenders shows the programs Hot for the scenario's type. A program that was
-- starred is carried over as Hot for all of its types; then the old flag is
-- removed (one place for the value).
-- Apply after the income drafts script. Safe to run more than once, and on a
-- database where the hot programs script never ran. A full run ends with a
-- confirmation row ("MPS HQ hot for installed").

alter table public.programs add column if not exists hot_for text[] not null default '{}';

alter table public.programs drop constraint if exists programs_hot_for_check;
alter table public.programs add constraint programs_hot_for_check
  check (hot_for <@ array['conventional', 'fha', 'va', 'usda', 'jumbo', 'full_doc', 'bank_statement', 'form_1099', 'pnl_only', 'asset_depletion', 'dscr', 'wvoe', 'no_ratio', 'retirement_distribution']::text[]);

-- Carry over the old star, then drop it.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'is_hot') then
    update public.programs p
    set hot_for = case
      when p.product_family::text = 'non_qm' then (
        select coalesce(array_agg(distinct case when d::text in ('bank_statement_12', 'bank_statement_24') then 'bank_statement' else d::text end), '{}')
        from unnest(p.doc_types) d
      )
      else array[p.product_family::text]
    end
    where p.is_hot and p.hot_for = '{}';
  end if;
end $$;

drop index if exists public.programs_hot_idx;
alter table public.programs drop column if exists is_hot;

create index if not exists programs_hot_for_idx on public.programs (organization_id) where hot_for <> '{}';

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ hot for installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'hot_for') as hot_for_column,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'is_hot') as old_flag_left,
  (select count(*) from pg_constraint where conname = 'programs_hot_for_check') as hot_for_check;
