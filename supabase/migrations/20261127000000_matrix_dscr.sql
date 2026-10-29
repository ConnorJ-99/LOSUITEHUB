-- LOSuite: DSCR levels in a matrix.
--
-- DSCR matrices often print one grid per DSCR level (e.g. DSCR 1.00+ and
-- 0.75-0.99) with different limits. Each matrix cell already has a minimum
-- DSCR (dscr_min, which Product Search checks); approving a matrix now saves
-- it, so a search with the borrower's DSCR uses the right grid.
-- Apply to the DEV Supabase project only, after the matrix limits script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite matrix DSCR installed").

-- ---------------------------------------------------------------------------
-- Approve: same as before, and each cell keeps its minimum DSCR.
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

    insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, dscr_min, offered, max_ltv, max_cltv, notes, source_document_id, source_page, extracted_by, approved_by, approved_at)
    select imp.organization_id, v_version, c.occupancy, c.property_types, c.purposes, c.doc_type, c.units_min, c.units_max, c.fico_min, c.fico_max, c.loan_amount_min, c.loan_amount_max, c.dscr_min, c.offered, c.max_ltv, c.max_cltv, c.notes, imp.document_id, c.source_page, imp.source, auth.uid(), now()
    from jsonb_to_recordset(prog->'cells') as c(
      occupancy public.occupancy, property_types public.matrix_property_type[], purposes public.matrix_purpose[], doc_type public.product_doc_type,
      units_min smallint, units_max smallint, fico_min smallint, fico_max smallint, loan_amount_min numeric, loan_amount_max numeric, dscr_min numeric,
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
  'LOSuite matrix DSCR installed' as result,
  (select count(*) from pg_proc where proname = 'approve_matrix_import' and prosrc like '%dscr_min%') as approve_function;
