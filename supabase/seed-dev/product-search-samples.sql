-- LOSuite: SAMPLE lenders for Product Search (DEV project only).
--
-- Three fictional lenders, every name marked "(Sample)", with programs,
-- approved matrices, rules and a little guideline text, shaped like the
-- Product Search mockups so the screens can be tried before real lenders are
-- imported. Not a migration: never run this on production.
-- Run after the product search script. Safe to run more than once (it adds the
-- samples only if they aren't there). Ends with a confirmation row
-- ("LOSuite sample lenders installed").
-- To remove them later: delete from public.lenders where name like '% (Sample)';

do $$
declare
  org uuid;
  l_north uuid; l_blue uuid; l_lake uuid;
  d uuid; p uuid; v uuid;
begin
  -- The company the owner signs in to (their first membership, as the app does).
  select organization_id into org from public.organization_members where role = 'owner' order by created_at limit 1;
  if org is null then raise exception 'No company found. Run supabase/seed.sql first.'; end if;
  if exists (select 1 from public.lenders where organization_id = org and name like '% (Sample)') then
    raise notice 'Sample lenders are already installed.';
    return;
  end if;

  insert into public.lenders (organization_id, name, short_name, status, channel, ae_name, ae_phone, ae_email, portal_url, states)
  values (org, 'Northstar Wholesale (Sample)', 'NW', 'approved', 'wholesale', 'Sample AE', '(214) 555-0142', 'ae@example.com', 'https://example.com', '{TX}')
  returning id into l_north;
  insert into public.lenders (organization_id, name, short_name, status, channel, ae_name, ae_phone, portal_url, states)
  values (org, 'Bluebonnet Lending (Sample)', 'BL', 'approved', 'wholesale', 'Sample AE', '(214) 555-0143', 'https://example.com', '{TX}')
  returning id into l_blue;
  insert into public.lenders (organization_id, name, short_name, status, channel, portal_url, states)
  values (org, 'Lakeshore Capital (Sample)', 'LC', 'not_signed_up', 'wholesale', 'https://example.com', '{TX}')
  returning id into l_lake;

  -- -------------------------------------------------------------------------
  -- Northstar: conventional, HomeReady, FHA and FHA with DPA
  -- -------------------------------------------------------------------------
  insert into public.guideline_documents (organization_id, lender_id, doc_type, title, version_label, effective_date, page_count, sha256)
  values (org, l_north, 'guidelines', 'Northstar Conventional Guide (Sample)', 'rev. 09/2026', '2026-09-01', 40, repeat('1', 64)) returning id into d;
  insert into public.guideline_passages (organization_id, document_id, position, page, section_number, heading, body) values
    (org, d, 0, 3, '1.1', 'Program overview', 'Fixed-rate conventional loans eligible for delivery to Fannie Mae or Freddie Mac. Underwriting is through DU or LPA, and the findings set reserve and DTI requirements within the limits of this guide. (Sample text.)'),
    (org, d, 1, 11, '3.6', 'High-LTV purchases', 'For purchase transactions above 95% LTV, at least one borrower must be a first-time homebuyer unless the loan is underwritten as HomeReady or Home Possible. (Sample text.)');

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, purposes, terms_months, last_verified_on)
  values (org, l_north, 'Conventional', 'conventional', 'first', '{full_doc}', '{purchase,rate_term,cash_out}', '{360}', '2026-10-01') returning id into p;
  insert into public.guideline_document_programs values (d, p, org);
  insert into public.matrix_versions (organization_id, program_id, version, status, effective_date, approved_at) values (org, p, 1, 'approved', '2026-10-01', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_max, offered, max_ltv, source_page, notes)
  select org, v, c.occ::public.occupancy, c.pt::public.matrix_property_type[], c.pu::public.matrix_purpose[], 'full_doc', c.u1, c.u2, c.f1, c.f2, 806500, c.ltv is not null, c.ltv, 1, c.note
  from (values
    ('primary', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 780, 850, 97, '97% needs a first-time buyer or HomeReady/Home Possible (note 2)'),
    ('primary', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 740, 779, 97, '97% needs a first-time buyer or HomeReady/Home Possible (note 2)'),
    ('primary', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 720, 739, 97, '97% needs a first-time buyer or HomeReady/Home Possible (note 2)'),
    ('primary', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 680, 719, 97, '97% needs a first-time buyer or HomeReady/Home Possible (note 2)'),
    ('primary', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 660, 679, 95, null),
    ('primary', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 620, 659, 95, null),
    ('primary', '{sfr_pud,two_to_four}', '{purchase,rate_term}', 2, 2, 620, 850, 85, null),
    ('primary', '{sfr_pud,two_to_four}', '{purchase,rate_term}', 3, 4, 620, 850, 75, null),
    ('second_home', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 680, 850, 90, null),
    ('second_home', '{sfr_pud,condo}', '{purchase,rate_term}', 1, 1, 620, 679, 85, null),
    ('investment', '{sfr_pud,condo}', '{purchase}', 1, 1, 720, 850, 85, null),
    ('investment', '{sfr_pud,condo}', '{purchase}', 1, 1, 680, 719, 80, null),
    ('investment', '{sfr_pud,condo}', '{purchase}', 1, 1, 660, 679, 75, null),
    ('investment', '{sfr_pud,condo}', '{purchase}', 1, 1, 620, 659, null, 'Not offered'),
    ('primary', '{sfr_pud,condo}', '{cash_out}', 1, 1, 620, 850, 80, null)
  ) as c(occ, pt, pu, u1, u2, f1, f2, ltv, note);
  insert into public.program_rules (organization_id, program_id, matrix_version_id, field, op, value, applies_when, severity, message, source_document_id, source_page, source_quote) values
    (org, p, v, 'dti', '<=', '50', null, 'hard', 'Max DTI 50% (DU Approve/Eligible)', d, 3, 'the findings set reserve and DTI requirements within the limits of this guide'),
    (org, p, v, 'first_time_buyer', 'required', null, '{"ltv_above": 95, "purposes": ["purchase"]}', 'hard', 'Above 95% LTV, at least one borrower must be a first-time buyer', d, 11, 'at least one borrower must be a first-time homebuyer'),
    (org, p, v, 'reserves_months', '>=', '0', null, 'verify', 'Reserves per DU findings', d, 3, null);

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, features, purposes, terms_months, last_verified_on)
  values (org, l_north, 'Conventional HomeReady', 'conventional', 'first', '{full_doc}', '{homeready_possible}', '{purchase,rate_term}', '{360}', '2026-10-01') returning id into p;
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, loan_amount_max, max_ltv, source_page)
  values (org, v, 'primary', '{sfr_pud,condo}', '{purchase,rate_term}', 'full_doc', 1, 1, 620, 806500, 97, 2);
  insert into public.program_rules (organization_id, program_id, matrix_version_id, field, op, value, message, source_page) values
    (org, p, v, 'income_vs_ami', '<=', '80', 'Income limit 80% of area median income', 2);

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, purposes, terms_months, last_verified_on)
  values (org, l_north, 'FHA', 'fha', 'first', '{full_doc}', '{purchase,rate_term,cash_out}', '{360}', '2026-10-01') returning id into p;
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, loan_amount_max, max_ltv, source_page) values
    (org, v, 'primary', '{sfr_pud,condo,two_to_four}', '{purchase,rate_term}', 'full_doc', 1, 4, 580, 524225, 96.5, 1),
    (org, v, 'primary', '{sfr_pud,condo,two_to_four}', '{cash_out}', 'full_doc', 1, 4, 580, 524225, 80, 1);

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, features, purposes, terms_months, last_verified_on)
  values (org, l_north, 'FHA with Down Payment Assistance', 'fha', 'first', '{full_doc}', '{dpa}', '{purchase}', '{360}', '2026-10-01') returning id into p;
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, loan_amount_max, max_ltv, source_page)
  values (org, v, 'primary', '{sfr_pud,condo}', '{purchase}', 'full_doc', 1, 1, 600, 524225, 96.5, 1);

  -- -------------------------------------------------------------------------
  -- Bluebonnet: DSCR 1st, DSCR closed-end second, bank statement 1st
  -- -------------------------------------------------------------------------
  insert into public.guideline_documents (organization_id, lender_id, doc_type, title, version_label, effective_date, page_count, sha256)
  values (org, l_blue, 'guidelines', 'Bluebonnet DSCR Guidelines (Sample)', 'rev. 10/2026', '2026-10-01', 32, repeat('2', 64)) returning id into d;
  insert into public.guideline_passages (organization_id, document_id, position, page, section_number, heading, body) values
    (org, d, 0, 14, '5.2', 'Vesting', 'Title may be vested in a limited liability company provided all members holding a 25% or greater interest execute a personal guaranty. (Sample text.)'),
    (org, d, 1, 19, '7.1', 'Prepayment penalty', 'Prepayment penalty terms of 1, 2, 3 or 5 years are available, or none with a pricing adjustment, where permitted by state law. (Sample text.)'),
    (org, d, 2, 8, '3.4', 'DSCR calculation', 'DSCR is gross monthly rent divided by the full PITIA of all liens on the subject property. (Sample text.)');

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, features, purposes, terms_months, prepay_options, last_verified_on)
  values (org, l_blue, 'DSCR', 'non_qm', 'first', '{dscr}', '{llc_vesting,interest_only}', '{purchase,rate_term,cash_out}', '{360}', '{0,1,2,3,5}', '2026-10-03') returning id into p;
  insert into public.guideline_document_programs values (d, p, org);
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, dscr_min, max_ltv, source_page)
  select org, v, 'investment', '{sfr_pud,condo,two_to_four}', c.pu::public.matrix_purpose[], 'dscr', 1, 4, c.f1, c.f2, 100000, 1500000, 1.00, c.ltv, 2
  from (values
    ('{purchase,rate_term}', 720, 850, 80), ('{purchase,rate_term}', 700, 719, 80), ('{purchase,rate_term}', 680, 699, 75), ('{purchase,rate_term}', 660, 679, 70),
    ('{cash_out}', 720, 850, 75), ('{cash_out}', 700, 719, 75), ('{cash_out}', 680, 699, 70), ('{cash_out}', 660, 679, 65)
  ) as c(pu, f1, f2, ltv);

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, features, purposes, terms_months, prepay_options, loan_amount_basis, last_verified_on)
  values (org, l_blue, 'DSCR Closed-End Second', 'non_qm', 'ces', '{dscr}', '{llc_vesting}', '{cash_out}', '{360}', '{0,1,2,3,5}', 'this_lien', '2026-10-14') returning id into p;
  insert into public.guideline_document_programs values (d, p, org);
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, dscr_min, offered, max_cltv, source_page)
  select org, v, 'investment', c.pt::public.matrix_property_type[], '{cash_out}', 'dscr', c.u1, c.u2, c.f1, c.f2, 50000, 500000, 1.00, c.cltv is not null, c.cltv, 3
  from (values
    ('{sfr_pud,condo}', 1, 1, 720, 850, 75), ('{sfr_pud,condo}', 1, 1, 700, 719, 70), ('{sfr_pud,condo}', 1, 1, 680, 699, 65), ('{sfr_pud,condo}', 1, 1, 660, 679, null),
    ('{two_to_four}', 2, 4, 720, 850, 70), ('{two_to_four}', 2, 4, 680, 719, null)
  ) as c(pt, u1, u2, f1, f2, cltv);
  insert into public.program_rules (organization_id, program_id, matrix_version_id, field, op, value, message, source_document_id, source_page) values
    (org, p, v, 'dscr', '>=', '1.0', 'Minimum DSCR 1.00', d, 8),
    (org, p, v, 'reserves_months', '>=', '6', 'Six months of reserves', d, 8);

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, purposes, terms_months, last_verified_on)
  values (org, l_blue, 'Bank Statement', 'non_qm', 'first', '{bank_statement_12}', '{purchase,rate_term,cash_out}', '{360}', '2026-10-03') returning id into p;
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, offered, max_ltv, source_page)
  select org, v, 'primary', '{sfr_pud,condo}', c.pu::public.matrix_purpose[], 'bank_statement_12', 1, 1, c.f1, c.f2, 100000, 2000000, c.ltv is not null, c.ltv, 4
  from (values
    ('{purchase,rate_term}', 740, 850, 90), ('{purchase,rate_term}', 700, 739, 85), ('{purchase,rate_term}', 660, 699, 80), ('{purchase,rate_term}', 620, 659, 75),
    ('{cash_out}', 740, 850, 80), ('{cash_out}', 700, 739, 75), ('{cash_out}', 660, 699, 70), ('{cash_out}', 620, 659, null)
  ) as c(pu, f1, f2, ltv);
  insert into public.program_rules (organization_id, program_id, matrix_version_id, field, op, value, message, source_page) values
    (org, p, v, 'self_employed_years', '>=', '2', 'Two years self-employed', 4),
    (org, p, v, 'dti', '<=', '50', 'Max DTI 50%', 4);

  -- -------------------------------------------------------------------------
  -- Lakeshore (not signed up): conventional and a DSCR second
  -- -------------------------------------------------------------------------
  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, purposes, terms_months, last_verified_on)
  values (org, l_lake, 'Conventional', 'conventional', 'first', '{full_doc}', '{purchase,rate_term}', '{360}', '2026-09-22') returning id into p;
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, loan_amount_max, max_ltv, source_page)
  values (org, v, 'primary', '{sfr_pud,condo}', '{purchase,rate_term}', 'full_doc', 1, 1, 620, 806500, 97, 1);

  insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, purposes, terms_months, last_verified_on)
  values (org, l_lake, 'Investor Equity 2nd (DSCR)', 'non_qm', 'ces', '{dscr}', '{cash_out}', '{360}', '2026-08-30') returning id into p;
  insert into public.matrix_versions (organization_id, program_id, version, status, approved_at) values (org, p, 1, 'approved', now()) returning id into v;
  insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, max_cltv, source_page)
  select org, v, 'investment', '{sfr_pud,condo,two_to_four}', '{cash_out}', 'dscr', 1, 4, c.f1, c.f2, 50000, 400000, c.cltv, 2
  from (values (720, 850, 70), (700, 719, 65), (660, 699, 60)) as c(f1, f2, cltv);
end $$;

select
  'LOSuite sample lenders installed' as result,
  (select count(*) from public.lenders where name like '% (Sample)') as lenders,
  (select count(*) from public.programs p join public.lenders l on l.id = p.lender_id where l.name like '% (Sample)') as programs,
  (select count(*) from public.program_matrix_cells c join public.matrix_versions v on v.id = c.matrix_version_id join public.programs p on p.id = v.program_id join public.lenders l on l.id = p.lender_id where l.name like '% (Sample)') as matrix_cells;
