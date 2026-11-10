-- MPS HQ: lender product updates pasted from email (Phase 0b, plan in
-- docs/plans/product-updates.md).
--
-- product_updates: one row per pasted email, saved the moment Connor presses
-- Read, so nothing is lost before he decides. Status: pending_review, then
-- confirmed or discarded. Nothing is deleted: it's the record of what the
-- lender sent and what was done with it. Everyone in the company sees them;
-- owners and admins add and decide them.
-- confirm_product_update(): saves the email as one of the lender's guideline
-- documents (type Bulletin, no PDF; its paragraphs become searchable
-- passages; the same email twice is the same document), links it to the
-- programs, and makes one matrix draft per program with limit or rule
-- changes. The drafts are approved on the usual review screen.
-- matrix_imports.product_update_id: the update a draft came from.
-- approve_matrix_import(): a cell or rule may name its own source document
-- (changed ones cite the email); without one it cites the import's document,
-- exactly as before.
-- Apply after the matrix tier settings script.
-- Safe to run more than once. A full run ends with a confirmation row
-- ("MPS HQ product updates installed").

do $$ begin create type public.product_update_status as enum ('pending_review', 'confirmed', 'discarded'); exception when duplicate_object then null; end $$;

create table if not exists public.product_updates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  -- Guessed from the email, or picked; required before confirming.
  lender_id        uuid,
  subject          text,
  pasted_text      text not null check (length(trim(pasted_text)) >= 20 and length(pasted_text) <= 100000),
  received_on      date not null default (now() at time zone 'America/Chicago')::date,
  status           public.product_update_status not null default 'pending_review',
  -- The programs it's about.
  program_ids      uuid[] not null default '{}',
  -- The assistant's proposed changes (every quote checked against pasted_text), or null when done by hand.
  proposal         jsonb,
  ai_run_id        uuid,
  -- The email as saved among the lender's guideline documents, once confirmed.
  document_id      uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  decided_by       uuid,
  decided_at       timestamptz,
  constraint product_updates_id_organization_id_key unique (id, organization_id),
  constraint product_updates_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint product_updates_lender_id_fkey
    foreign key (lender_id, organization_id) references public.lenders (id, organization_id) on delete set null (lender_id),
  constraint product_updates_document_id_fkey
    foreign key (document_id, organization_id) references public.guideline_documents (id, organization_id) on delete set null (document_id),
  constraint product_updates_ai_run_id_fkey
    foreign key (ai_run_id) references public.ai_runs (id) on delete set null,
  constraint product_updates_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint product_updates_decided_by_fkey
    foreign key (decided_by) references public.profiles (id) on delete set null
);

create index if not exists product_updates_lender_idx on public.product_updates (lender_id, created_at desc);
create index if not exists product_updates_org_idx on public.product_updates (organization_id, status, created_at desc);

alter table public.product_updates enable row level security;
drop policy if exists "members see product updates" on public.product_updates;
create policy "members see product updates" on public.product_updates
  for select to authenticated using (public.is_org_member(organization_id));
drop policy if exists "managers add product updates" on public.product_updates;
create policy "managers add product updates" on public.product_updates
  for insert to authenticated with check (public.is_org_manager(organization_id));
drop policy if exists "managers edit product updates" on public.product_updates;
create policy "managers edit product updates" on public.product_updates
  for update to authenticated using (public.is_org_manager(organization_id)) with check (public.is_org_manager(organization_id));
-- No delete policy: updates are kept as the record.

-- The pasted email never changes, and a decided update is final.
create or replace function public.product_updates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pasted_text is distinct from old.pasted_text or new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'The pasted email can''t be changed. Paste it again as a new update.';
  end if;
  if old.status <> 'pending_review' and (new.status, new.lender_id, new.program_ids, new.proposal, new.subject, new.received_on) is distinct from (old.status, old.lender_id, old.program_ids, old.proposal, old.subject, old.received_on) then
    raise exception 'This update was already %.', old.status::text;
  end if;
  return new;
end;
$$;

drop trigger if exists product_updates_guard on public.product_updates;
create trigger product_updates_guard before update on public.product_updates for each row execute function public.product_updates_guard();

alter table public.matrix_imports add column if not exists product_update_id uuid;
do $$ begin
  alter table public.matrix_imports add constraint matrix_imports_product_update_id_fkey
    foreign key (product_update_id, organization_id) references public.product_updates (id, organization_id) on delete set null (product_update_id);
exception when duplicate_object then null; end $$;
create index if not exists matrix_imports_product_update_idx on public.matrix_imports (product_update_id) where product_update_id is not null;

-- ---------------------------------------------------------------------------
-- Confirm: save the email as a Bulletin, link it, make the drafts.
-- p_drafts: [{ program_id, document_id (the PDF its matrix came from, or null), reading }]
-- ---------------------------------------------------------------------------

create or replace function public.confirm_product_update(p_update_id uuid, p_drafts jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  u public.product_updates%rowtype;
  v_hash text;
  v_doc uuid;
  d jsonb;
  v_import uuid;
  v_imports uuid[] := '{}';
  v_programs uuid[];
begin
  select * into u from public.product_updates where id = p_update_id for update;
  if not found then raise exception 'Update not found, or you don''t have access.'; end if;
  if not public.is_org_manager(u.organization_id) then raise exception 'Only owners and admins can confirm a product update.'; end if;
  if u.status <> 'pending_review' then raise exception 'This update was already %.', u.status::text; end if;
  if u.lender_id is null then raise exception 'Pick the lender first.'; end if;
  if jsonb_typeof(p_drafts) <> 'array' then raise exception 'Invalid drafts.'; end if;

  -- Only the lender's own programs.
  select coalesce(array_agg(p.id), '{}') into v_programs from public.programs p where p.id = any(u.program_ids) and p.lender_id = u.lender_id;
  if cardinality(v_programs) = 0 then raise exception 'Pick at least one of this lender''s programs.'; end if;

  -- The email as one of the lender's guideline documents. The same text pasted again is the same document.
  v_hash := encode(sha256(convert_to(regexp_replace(trim(u.pasted_text), '\s+', ' ', 'g'), 'UTF8')), 'hex');
  select id into v_doc from public.guideline_documents where lender_id = u.lender_id and sha256 = v_hash;
  if v_doc is null then
    insert into public.guideline_documents (organization_id, lender_id, doc_type, title, storage_path, version_label, page_count, sha256)
    values (u.organization_id, u.lender_id, 'overlay_bulletin',
      left(coalesce(nullif(trim(u.subject), ''), 'Product update email'), 180) || ' (email, ' || to_char(u.received_on, 'MM/DD/YYYY') || ')',
      null, 'Email ' || to_char(u.received_on, 'YYYY-MM-DD'), 1, v_hash)
    returning id into v_doc;
    -- One passage per paragraph, so guideline search can find and quote it.
    insert into public.guideline_passages (organization_id, document_id, position, page, heading, body)
    select u.organization_id, v_doc, (row_number() over (order by n)) - 1, 1, case when n = 1 then nullif(trim(u.subject), '') end, trim(para)
    from regexp_split_to_table(u.pasted_text, '\n\s*\n') with ordinality as t(para, n)
    where length(trim(para)) > 0;
  end if;
  insert into public.guideline_document_programs (document_id, program_id, organization_id)
  select v_doc, p, u.organization_id from unnest(v_programs) as p
  on conflict do nothing;

  -- One draft per program with limit or rule changes, approved on the usual review screen.
  for d in select * from jsonb_array_elements(p_drafts) loop
    if not ((d->>'program_id')::uuid = any(v_programs)) then raise exception 'A draft is for a program this update isn''t about.'; end if;
    if jsonb_typeof(d->'reading') <> 'object' then raise exception 'Invalid draft.'; end if;
    insert into public.matrix_imports (organization_id, lender_id, document_id, source, reading, product_update_id)
    values (u.organization_id, u.lender_id, nullif(d->>'document_id', '')::uuid, 'manual',
      (d->'reading') || jsonb_build_object('editOf', d->>'program_id'), u.id)
    returning id into v_import;
    v_imports := v_imports || v_import;
  end loop;

  update public.product_updates set status = 'confirmed', document_id = v_doc, program_ids = v_programs, decided_by = auth.uid(), decided_at = now() where id = u.id;
  return jsonb_build_object('document_id', v_doc, 'import_ids', to_jsonb(v_imports));
end;
$$;

revoke all on function public.confirm_product_update(uuid, jsonb) from public, anon;
grant execute on function public.confirm_product_update(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Approve: same as before, and a cell or rule may name its own source document.
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

    insert into public.program_matrix_cells (organization_id, matrix_version_id, occupancy, property_types, purposes, doc_type, units_min, units_max, fico_min, fico_max, loan_amount_min, loan_amount_max, dscr_min, offered, max_ltv, max_cltv, notes, source_document_id, source_page, extracted_by, approved_by, approved_at, loan_amount_mode, credit_mode, blank_mode)
    select imp.organization_id, v_version, c.occupancy, c.property_types, c.purposes, c.doc_type, c.units_min, c.units_max, c.fico_min, c.fico_max, c.loan_amount_min, c.loan_amount_max, c.dscr_min, c.offered, c.max_ltv, c.max_cltv, c.notes,
      -- A cell changed by a pasted email cites that email; the rest cite the import's document.
      coalesce(c.source_document_id, imp.document_id), c.source_page, imp.source, auth.uid(), now(),
      -- A grid saved without settings reads the way matrices always have: printed ranges, credit bands, blank = not offered.
      coalesce(c.loan_amount_mode, 'explicit_ranges'), coalesce(c.credit_mode, 'bands'), coalesce(c.blank_mode, 'not_offered')
    from jsonb_to_recordset(prog->'cells') as c(
      occupancy public.occupancy, property_types public.matrix_property_type[], purposes public.matrix_purpose[], doc_type public.product_doc_type,
      units_min smallint, units_max smallint, fico_min smallint, fico_max smallint, loan_amount_min numeric, loan_amount_max numeric, dscr_min numeric,
      offered boolean, max_ltv numeric, max_cltv numeric, notes text, source_page integer,
      loan_amount_mode text, credit_mode text, blank_mode text, source_document_id uuid);
    get diagnostics n = row_count;
    v_cells := v_cells + n;

    insert into public.program_rules (organization_id, program_id, matrix_version_id, field, op, value, applies_when, severity, message, source_document_id, source_page, source_quote, extracted_by, approved_by, approved_at)
    select imp.organization_id, v_program, v_version, r.field, r.op, r.value, r.applies_when, r.severity, r.message, coalesce(r.source_document_id, imp.document_id), r.source_page, nullif(r.source_quote, ''), imp.source, auth.uid(), now()
    from jsonb_to_recordset(coalesce(prog->'rules', '[]'::jsonb)) as r(
      field public.rule_field, op public.rule_op, value jsonb, applies_when jsonb, severity public.rule_severity, message text, source_page integer, source_quote text, source_document_id uuid);
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
  'MPS HQ product updates installed' as result,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'product_updates') as updates_table,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'product_updates') as update_policies,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'matrix_imports' and column_name = 'product_update_id') as import_link,
  (select count(*) from pg_proc where proname = 'confirm_product_update') as confirm_function,
  (select count(*) from pg_proc where proname = 'approve_matrix_import' and prosrc like '%c.source_document_id%') as approve_function;
