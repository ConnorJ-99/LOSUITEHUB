-- MPS HQ: "Open in Arive" (build plan Phase 2).
--
-- organizations.arive_loan_url: the company's Arive loan link, an address
-- copied from the browser with the loan number swapped for {number}. Blank
-- means no link (the number is shown with a copy button). Owners and admins
-- edit it in Settings → Company, like the other company details.
-- Apply after the closing and funding dates script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ Arive link installed").

alter table public.organizations add column if not exists arive_loan_url text;

alter table public.organizations drop constraint if exists organizations_arive_loan_url_check;
alter table public.organizations add constraint organizations_arive_loan_url_check
  check (arive_loan_url is null or (arive_loan_url ~* '^https://' and position('{number}' in arive_loan_url) > 0 and length(arive_loan_url) <= 500));

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'MPS HQ Arive link installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'organizations' and column_name = 'arive_loan_url') as arive_column,
  (select count(*) from pg_constraint where conname = 'organizations_arive_loan_url_check') as arive_check;
