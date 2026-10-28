-- LOSuite: IRA / retirement distribution as an income type.
--
-- Non-QM lenders often print one matrix grid for several income types (bank
-- statement, asset depletion, IRA distribution). The app now saves each box
-- once per income type the grid covers, so a search by income type finds it;
-- this adds the one income type the list didn't have.
-- Apply to the DEV Supabase project only, after the lender contacts script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite income types installed").

alter type public.product_doc_type add value if not exists 'retirement_distribution';

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite income types installed' as result,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'product_doc_type' and e.enumlabel = 'retirement_distribution') as new_income_type;
