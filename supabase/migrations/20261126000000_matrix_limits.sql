-- LOSuite: what real lender matrices need.
--
-- Condotel and rural SFR grids are common in Non-QM matrices, so they become
-- property types. FHA streamline and VA IRRRL grids print limits above 100%
-- (e.g. 110%), so a matrix limit can go up to 150%.
-- Apply to the DEV Supabase project only, after the income types script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite matrix limits installed").

alter type public.matrix_property_type add value if not exists 'condotel';
alter type public.matrix_property_type add value if not exists 'rural';

alter table public.program_matrix_cells drop constraint if exists program_matrix_cells_max_ltv_check;
alter table public.program_matrix_cells add constraint program_matrix_cells_max_ltv_check check (max_ltv > 0 and max_ltv <= 150);
alter table public.program_matrix_cells drop constraint if exists program_matrix_cells_max_cltv_check;
alter table public.program_matrix_cells add constraint program_matrix_cells_max_cltv_check check (max_cltv > 0 and max_cltv <= 150);

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite matrix limits installed' as result,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'matrix_property_type' and e.enumlabel in ('condotel', 'rural')) as new_property_types,
  (select count(*) from pg_constraint where conname = 'program_matrix_cells_max_ltv_check' and pg_get_constraintdef(oid) like '%150%') as ltv_limit;
