-- LOSuite: Product Search v2, step 6 (matrix import and review).
--
-- matrix_imports: what the assistant read from a lender's matrix PDF, kept
-- for review. Nothing in a reading is searchable until it's approved.
-- approve_matrix_import(): Connor's reviewed (and edited) programs go live in
-- one step: each program is created or updated, its earlier approved matrix
-- becomes "superseded", and a new approved version with every cell and rule
-- (each with its page) takes its place. Only owners and admins can approve.
-- "Verified" is today's date in Texas (Central time), not UTC.
-- Apply to the DEV Supabase project only, after the guideline files script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("LOSuite matrix import installed").

do $$ begin create type public.matrix_import_status as enum ('pending_review', 'approved', 'discarded'); exception when duplicate_object then null; end $$;

create table if not exists public.matrix_imports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lender_id        uuid not null,
  document_id      uuid,
  ai_run_id        uuid,
  status           public.matrix_import_status not null default 'pending_review',
  -- The checked reading (programs, grids, rules) as the assistant returned it.
  reading          jsonb not null,
  approved_program_ids uuid[],
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  decided_by       uuid,
  decided_at       timestamptz,
  constraint matrix_imports_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete cascade,
  constraint matrix_imports_document_id_fkey
    foreign key (document_id, organization_id) references public.guideline_documents (id, organization_id) on delete set null (document_id),
  constraint matrix_imports_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint matrix_imports_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint matrix_imports_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null
);

create index if not exists matrix_imports_lender_idx on public.matrix_imports (lender_id, created_at desc);

alter table public.matrix_imports enable row level security;
drop policy if exists "members see matrix imports" on public.matrix_imports;
create policy "members see matrix imports" on public.matrix_imports
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add matrix imports" on public.matrix_imports;
create policy "managers add matrix imports" on public.matrix_imports
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit matrix imports" on public.matrix_imports;
create policy "managers edit matrix imports" on public.matrix_imports
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
-- No delete policy: imports are kept (approved or discarded) as the record of what was read.

-- ---------------------------------------------------------------------------
-- Approve: the reviewed programs go live together, or nothing changes.
-- p_programs: [{ program_id (existing, or null for new), name, family, lien,
--   doc_types, features, purposes, terms_months, loan_amount_basis,
--   description, cells: [...], rules: [...] }]
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
      insert into public.programs (organization_id, lender_id, name, product_family, lien, doc_types, features, purposes, terms_months, loan_amount_basis, description, last_verified_on)
      values (
        imp.organization_id, imp.lender_id, prog->>'name',
        (prog->>'family')::public.product_family, (prog->>'lien')::public.product_lien,
        array(select jsonb_array_elements_text(prog->'doc_types'))::public.product_doc_type[],
        array(select jsonb_array_elements_text(prog->'features'))::public.product_feature[],
        array(select jsonb_array_elements_text(prog->'purposes'))::public.matrix_purpose[],
        array(select jsonb_array_elements_text(prog->'terms_months'))::smallint[],
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
    values (imp.organization_id, v_program, v_next, 'approved', p_effective_date, imp.document_id, 'ai', imp.ai_run_id, auth.uid(), now())
    returning id into v_version;

    insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, offered, max_ltv, max_cltv, notes, source_document_id, source_page, extracted_by, approved_by, approved_at)
    select imp.organization_id, v_version, c.occupancy, c.property_types, c.purposes, c.doc_type, c.units_min, c.units_max, c.fico_min, c.fico_max, c.loan_amount_min, c.loan_amount_max, c.offered, c.max_ltv, c.max_cltv, c.notes, imp.document_id, c.source_page, 'ai', auth.uid(), now()
    from jsonb_to_recordset(prog->'cells') as c(
      occupancy public.occupancy, property_types public.matrix_property_type[], purposes public.matrix_purpose[], doc_type public.product_doc_type,
      units_min smallint, units_max smallint, fico_min smallint, fico_max smallint, loan_amount_min numeric, loan_amount_max numeric,
      offered boolean, max_ltv numeric, max_cltv numeric, notes text, source_page integer);
    get diagnostics n = row_count;
    v_cells := v_cells + n;

    insert into public.program_rules (organization_id, program_id, matrix_version_id, field, op, value, applies_when, severity, message, source_document_id, source_page, source_quote, extracted_by, approved_by, approved_at)
    select imp.organization_id, v_program, v_version, r.field, r.op, r.value, r.applies_when, r.severity, r.message, imp.document_id, r.source_page, nullif(r.source_quote, ''), 'ai', auth.uid(), now()
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
  'LOSuite matrix import installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'matrix_imports') as imports_table,
  (select count(*) from pg_proc where proname = 'approve_matrix_import') as approve_function;
