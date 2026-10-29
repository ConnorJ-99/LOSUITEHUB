-- LOSuite: 5+ unit buildings in matrices.
--
-- DSCR and investor matrices often have grids for 5-8 or 5-9 unit buildings
-- (small multifamily). They get their own property type, "5+ units", and a
-- matrix cell can now cover up to 20 units (it was 1-4).
-- Apply to the DEV Supabase project only, after the matrix DSCR script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite 5+ units installed").

alter type public.matrix_property_type add value if not exists 'five_plus';

alter table public.program_matrix_cells drop constraint if exists program_matrix_cells_units_min_check;
alter table public.program_matrix_cells add constraint program_matrix_cells_units_min_check check (units_min between 1 and 20);
alter table public.program_matrix_cells drop constraint if exists program_matrix_cells_units_max_check;
alter table public.program_matrix_cells add constraint program_matrix_cells_units_max_check check (units_max between 1 and 20);

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite 5+ units installed' as result,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'matrix_property_type' and e.enumlabel = 'five_plus') as five_plus_type,
  (select count(*) from pg_constraint where conname in ('program_matrix_cells_units_min_check', 'program_matrix_cells_units_max_check') and pg_get_constraintdef(oid) like '%20%') as unit_limits;
