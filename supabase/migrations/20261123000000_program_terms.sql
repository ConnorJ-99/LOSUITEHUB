-- LOSuite: a program is a loan product; its terms are options.
--
-- programs.term_options lists every term a program offers (30/25/20/15/10-yr
-- fixed, 5/6, 7/6 and 10/6 ARMs, HELOC draw/repay periods) instead of making
-- a separate program per term. Existing programs get their options from the
-- terms they already had. The fictional "(Sample)" lenders' programs lose the
-- term from their names ("Conventional 30-Year Fixed" becomes "Conventional")
-- and get realistic term options. Approving a matrix now saves term options.
-- Apply to the DEV Supabase project only, after the typed matrices script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite program terms installed").

do $$ begin create type public.program_term as enum ('fixed_40', 'fixed_30', 'fixed_25', 'fixed_20', 'fixed_15', 'fixed_10', 'arm_5_6', 'arm_7_6', 'arm_10_6', 'heloc_10_20', 'heloc_10_15', 'heloc_5_25', 'heloc_3_27'); exception when duplicate_object then null; end $$;

alter table public.programs add column if not exists term_options public.program_term[] not null default '{}';

-- Programs without options yet get them from their fixed terms in months.
update public.programs set term_options = array(
  select distinct t from unnest(terms_months) m
  cross join lateral (select case m when 480 then 'fixed_40' when 360 then 'fixed_30' when 300 then 'fixed_25' when 240 then 'fixed_20' when 180 then 'fixed_15' when 120 then 'fixed_10' end::public.program_term as t) x
  where t is not null order by t)
where cardinality(term_options) = 0 and terms_months is not null;

-- The fictional sample lenders: product names without the term, and their term options.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('Northstar Wholesale (Sample)', 'Conventional 30-Year Fixed', 'Conventional', '{fixed_30,fixed_25,fixed_20,fixed_15,fixed_10,arm_7_6}'),
      ('Northstar Wholesale (Sample)', 'Conventional HomeReady', 'Conventional HomeReady', '{fixed_30,fixed_20,fixed_15}'),
      ('Northstar Wholesale (Sample)', 'FHA 30-Year Fixed', 'FHA', '{fixed_30,fixed_15}'),
      ('Northstar Wholesale (Sample)', 'FHA with Down Payment Assistance', 'FHA with Down Payment Assistance', '{fixed_30}'),
      ('Bluebonnet Lending (Sample)', 'DSCR 30-Year Fixed', 'DSCR', '{fixed_40,fixed_30,arm_5_6,arm_7_6}'),
      ('Bluebonnet Lending (Sample)', 'DSCR Closed-End Second', 'DSCR Closed-End Second', '{fixed_30,fixed_20,fixed_15}'),
      ('Bluebonnet Lending (Sample)', 'Bank Statement 30-Year Fixed', 'Bank Statement', '{fixed_30,arm_7_6}'),
      ('Lakeshore Capital (Sample)', 'Conventional 30 Fixed', 'Conventional', '{fixed_30,fixed_15}'),
      ('Lakeshore Capital (Sample)', 'Investor Equity 2nd (DSCR)', 'Investor Equity 2nd (DSCR)', '{fixed_30,fixed_20}')
    ) as v(lender, old_name, new_name, terms)
  loop
    update public.programs p set
      name = r.new_name,
      term_options = r.terms::public.program_term[]
    from public.lenders l
    where l.id = p.lender_id and l.name = r.lender and p.name in (r.old_name, r.new_name)
      and not exists (select 1 from public.programs o where o.lender_id = p.lender_id and o.name = r.new_name and o.id <> p.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Approve: same as before, and it saves each program's term options.
-- ---------------------------------------------------------------------------

create or replace function public.approve_matrix_import(p_import_id uuid, p_programs jsonb, p_effective_date date default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  imp public.matrix_imports%rowtype;
  prog jsonb;
  v_program uuid;
  v_version uuid;
  v_next integer;
  v_ids uuid[] := '{}';
  v_cells integer := 0;
  v_rules integer := 0;
  n integer;
begin
  select * into imp from public.matrix_imports where id = p_import_id for update;
  if not found then raise exception 'Import not found, or only owners and admins can approve it.'; end if;
  if imp.status <> 'pending_review' then raise exception 'This import was already %.', replace(imp.status::text, '_', ' '); end if;
  if not public.is_org_manager(imp.organization_id) then raise exception 'Only owners and admins can approve a matrix.'; end if;
  if jsonb_typeof(p_programs) <> 'array' or jsonb_array_length(p_programs) = 0 then raise exception 'Pick at least one program to approve.'; end if;

  for prog in select * from jsonb_array_elements(p_programs) loop
    if nullif(prog->>'program_id', '') is null then
      insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, features, purposes, terms_months, term_options, loan_amount_basis, description, last_verified_on)
      values (
        imp.organization_id, imp.lender_id, prog->>'name',
        (prog->>'family')::public.product_family, (prog->>'lien')::public.product_lien,
        array(select jsonb_array_elements_text(prog->'doc_types'))::public.product_doc_type[],
        array(select jsonb_array_elements_text(prog->'features'))::public.product_feature[],
        array(select jsonb_array_elements_text(prog->'purposes'))::public.matrix_purpose[],
        array(select jsonb_array_elements_text(prog->'terms_months'))::smallint[],
        array(select jsonb_array_elements_text(coalesce(prog->'term_options', '[]'::jsonb)))::public.program_term[],
        coalesce(prog->>'loan_amount_basis', 'this_lien')::public.loan_amount_basis,
        nullif(prog->>'description', ''), (now() at time zone 'America/Chicago')::date)
      returning id into v_program;
    else
      update public.programs set
        name = prog->>'name',
        product_family = (prog->>'family')::public.product_family,
        lien = (prog->>'lien')::public.product_lien,
        doc_types = array(select jsonb_array_elements_text(prog->'doc_types'))::public.product_doc_type[],
        features = array(select jsonb_array_elements_text(prog->'features'))::public.product_feature[],
        purposes = array(select jsonb_array_elements_text(prog->'purposes'))::public.matrix_purpose[],
        terms_months = array(select jsonb_array_elements_text(prog->'terms_months'))::smallint[],
        term_options = case when prog ? 'term_options' then array(select jsonb_array_elements_text(prog->'term_options'))::public.program_term[] else term_options end,
        loan_amount_basis = coalesce(prog->>'loan_amount_basis', 'this_lien')::public.loan_amount_basis,
        description = coalesce(nullif(prog->>'description', ''), description),
        last_verified_on = (now() at time zone 'America/Chicago')::date
      where id = (prog->>'program_id')::uuid and lender_id = imp.lender_id
      returning id into v_program;
      if v_program is null then raise exception 'Program % is not one of this lender''s.', prog->>'name'; end if;
    end if;

    -- The new version replaces the one in use (kept as superseded for the record).
    select coalesce(max(version), 0) + 1 into v_next from public.matrix_versions where program_id = v_program;
    update public.matrix_versions set status = 'superseded' where program_id = v_program and status = 'approved';
    insert into public.matrix_versions (organization_id, program_id, version, status, effective_date, source_document_id, extracted_by, ai_run_id, approved_by, approved_at)
    values (imp.organization_id, v_program, v_next, 'approved', p_effective_date, imp.document_id, imp.source, imp.ai_run_id, auth.uid(), now())
    returning id into v_version;

    insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, offered, max_ltv, max_cltv, notes, source_document_id, source_page, extracted_by, approved_by, approved_at)
    select imp.organization_id, v_version, c.occupancy, c.property_types, c.purposes, c.doc_type, c.units_min, c.units_max, c.fico_min, c.fico_max, c.loan_amount_min, c.loan_amount_max, c.offered, c.max_ltv, c.max_cltv, c.notes, imp.document_id, c.source_page, imp.source, auth.uid(), now()
    from jsonb_to_recordset(prog->'cells') as c(
      occupancy public.occupancy, property_types public.matrix_property_type[], purposes public.matrix_purpose[], doc_type public.product_doc_type,
      units_min smallint, units_max smallint, fico_min smallint, fico_max smallint, loan_amount_min numeric, loan_amount_max numeric,
      offered boolean, max_ltv numeric, max_cltv numeric, notes text, source_page integer);
    get diagnostics n = row_count;
    v_cells := v_cells + n;

    insert into public.program_rules (organization_id, program_id, matrix_version_id, field, op, value, applies_when, severity, message, source_document_id, source_page, source_quote, extracted_by, approved_by, approved_at)
    select imp.organization_id, v_program, v_version, r.field, r.op, r.value, r.applies_when, r.severity, r.message, imp.document_id, r.source_page, nullif(r.source_quote, ''), imp.source, auth.uid(), now()
    from jsonb_to_recordset(coalesce(prog->'rules', '[]'::jsonb)) as r(
      field public.rule_field, op public.rule_op, value jsonb, applies_when jsonb, severity public.rule_severity, message text, source_page integer, source_quote text);
    get diagnostics n = row_count;
    v_rules := v_rules + n;

    if imp.document_id is not null then
      insert into public.guideline_document_programs (document_id, program_id, organization_id) values (imp.document_id, v_program, imp.organization_id) on conflict do nothing;
    end if;
    v_ids := v_ids || v_program;
  end loop;

  update public.matrix_imports set status = 'approved', approved_program_ids = v_ids, decided_by = auth.uid(), decided_at = now() where id = p_import_id;
  return jsonb_build_object('programs', cardinality(v_ids), 'cells', v_cells, 'rules', v_rules, 'program_ids', to_jsonb(v_ids));
end;
$$;

revoke all on function public.approve_matrix_import(uuid, jsonb, date) from public, anon;
grant execute on function public.approve_matrix_import(uuid, jsonb, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Confirmation: a full run ends by showing this row.
-- ---------------------------------------------------------------------------

select
  'LOSuite program terms installed' as result,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'term_options') as term_column,
  (select count(*) from pg_proc where proname = 'approve_matrix_import' and prosrc like '%term_options%') as approve_function,
  (select count(*) from public.programs where name like '%30-Year Fixed%' or name like '%30 Fixed%') as sample_names_left;
