-- LOSuite: PDFs made by LOSuite, Product Search v2 step 8b.
--
-- Adds the kinds of documents LOSuite generates itself (the Fee Worksheet,
-- the loan comparison for the borrower, and pre-approval letters) to
-- document_kind, and records which template version made each one, so a
-- saved PDF can always be traced to the wording it was printed with.
-- The property and scenario a document is for were added by the pricing
-- script (loan_documents.property_id and pricing_scenario_id).
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite generated documents installed").

alter type public.document_kind add value if not exists 'fee_worksheet';
alter type public.document_kind add value if not exists 'loan_comparison';
alter type public.document_kind add value if not exists 'preapproval_letter';

-- Which template made the PDF (e.g. "fee-worksheet v1"). Empty for uploads.
alter table public.loan_documents add column if not exists template_version text;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite generated documents installed' as result,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind' and e.enumlabel in ('fee_worksheet', 'loan_comparison', 'preapproval_letter')) as new_kinds,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loan_documents' and column_name = 'template_version') as template_column;
