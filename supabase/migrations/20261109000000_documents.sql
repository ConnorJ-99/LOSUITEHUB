-- LOSuite: documents, part 7a (the Documents tab).
--
-- Adds the kinds of documents a file collects (pay stubs, W-2s, returns,
-- statements, ID...) to document_kind, and lets each document say whose it
-- is (a borrower on the loan). Files stay in the private "loan-files"
-- bucket, readable only by people who can see the loan.
-- Apply to the DEV Supabase project only. Safe to run more than once. A full
-- run ends with a confirmation row ("LOSuite documents installed").

alter type public.document_kind add value if not exists 'paystub';
alter type public.document_kind add value if not exists 'w2';
alter type public.document_kind add value if not exists 'form_1099';
alter type public.document_kind add value if not exists 'tax_return';
alter type public.document_kind add value if not exists 'business_return';
alter type public.document_kind add value if not exists 'profit_loss';
alter type public.document_kind add value if not exists 'bank_statement';
alter type public.document_kind add value if not exists 'investment_statement';
alter type public.document_kind add value if not exists 'photo_id';
alter type public.document_kind add value if not exists 'award_letter';
alter type public.document_kind add value if not exists 'gift_letter';
alter type public.document_kind add value if not exists 'divorce_decree';
alter type public.document_kind add value if not exists 'bankruptcy_papers';
alter type public.document_kind add value if not exists 'explanation_letter';
alter type public.document_kind add value if not exists 'mortgage_statement';
alter type public.document_kind add value if not exists 'insurance_declarations';
alter type public.document_kind add value if not exists 'lease';
alter type public.document_kind add value if not exists 'appraisal';
alter type public.document_kind add value if not exists 'title_commitment';

-- Whose document it is. Deleting the person keeps the document on the loan.
alter table public.loan_documents add column if not exists contact_id uuid;

do $$ begin
  alter table public.loan_documents
    add constraint loan_documents_contact_id_fkey
    foreign key (contact_id, organization_id) references public.contacts (id, organization_id) on delete set null (contact_id);
exception when duplicate_object then null;
end $$;

create index if not exists loan_documents_contact_id_idx on public.loan_documents (contact_id);

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite documents installed' as result,
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'document_kind') as document_kinds,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'loan_documents' and column_name = 'contact_id') as whose_column;
