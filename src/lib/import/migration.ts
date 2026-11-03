// The one-time move of the old app's clients into LOSuite (the Launch step).
// Builds a SQL script for Connor to paste into the Supabase SQL Editor: every
// client row goes through the same checks as Contacts → Import CSV and the
// same import_clients() (matched by old site ID, email, phone, then name +
// address for closed loans; adds or fills blanks only), and partners go
// through find_or_create_partner() (matched by email or phone, never by name).
// Running the script twice changes nothing the second time.
//
// The script holds real client data: it's written to supabase/.paste/
// (git-ignored) and is never committed. Pure, so it's tested like the import.

import { normalizeEmail, normalizePhone } from '../../../supabase/functions/lead-intake/normalize'
import { checkClientFile, type CheckedRow, type ImportRow } from './clients'
import { parseCsv } from './csv'

export interface MigrationFile {
  /** Shown in the report, e.g. "arive-closed.csv". */
  name: string
  text: string
}

export type PartnerKind = 'realtor' | 'title' | 'builder' | 'referral' | 'other'

export interface MigrationPartner {
  row: number
  kind: PartnerKind
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
}

export interface MigrationPlan {
  /** Rows that pass the checks, renumbered so each file keeps its own row numbers (file 2, row 5 = 200005). */
  rows: ImportRow[]
  /** Rows the checks stopped, by file; they are left out until fixed. */
  problems: { file: string; row: number; name: string; errors: string[] }[]
  /** Headers no column matched, by file; their values are not moved. */
  ignoredColumns: { file: string; columns: string[] }[]
  /** Social Security / tax ID headers found and never read. */
  sensitiveColumns: { file: string; columns: string[] }[]
  partners: MigrationPartner[]
  partnerProblems: { row: number; reason: string }[]
}

/** File n's row r is sent as n × 100000 + r, so the report can point back to it. */
export const ROW_BASE = 100_000
export const rowLabel = (files: string[], row: number) => `${files[Math.floor(row / ROW_BASE) - 1] ?? 'file'} row ${row % ROW_BASE}`

const PARTNER_HEADERS: Record<string, keyof Omit<MigrationPartner, 'row'>> = {
  name: 'name', 'full name': 'name', 'partner name': 'name', 'agent name': 'name', contact: 'name',
  company: 'company', brokerage: 'company', 'company name': 'company', office: 'company',
  email: 'email', 'email address': 'email',
  phone: 'phone', 'phone number': 'phone', cell: 'phone', mobile: 'phone',
  kind: 'kind', type: 'kind', 'partner type': 'kind', role: 'kind', category: 'kind',
}

/** "Realtor", "Title company", "Builder"... to the partner kinds. Blank = realtor (most partners are agents). */
export function partnerKind(value: string): PartnerKind {
  const t = value.toLowerCase()
  if (/builder/.test(t)) return 'builder'
  if (/title|escrow/.test(t)) return 'title'
  if (/referr|past client|friend|cpa|attorney|planner/.test(t)) return 'referral'
  if (!t.trim() || /realt|agent|broker/.test(t)) return 'realtor'
  return 'other'
}

/** Reads the partner list: name, company, email, phone, type. Someone with no email or phone can't be matched, so is left out. */
export function readPartners(text: string): { partners: MigrationPartner[]; problems: { row: number; reason: string }[] } {
  const [header = [], ...body] = parseCsv(text)
  const keys = header.map((h) => PARTNER_HEADERS[h.trim().toLowerCase().replace(/[_\s]+/g, ' ')])
  const partners: MigrationPartner[] = []
  const problems: { row: number; reason: string }[] = []
  body.forEach((cells, i) => {
    if (cells.every((c) => !c.trim())) return
    const raw: Record<string, string> = {}
    keys.forEach((k, j) => { if (k && !raw[k]) raw[k] = (cells[j] ?? '').trim() })
    const p: MigrationPartner = {
      row: i + 2,
      kind: partnerKind(raw.kind ?? ''),
      name: raw.name || null,
      company: raw.company || null,
      email: normalizeEmail(raw.email),
      phone: normalizePhone(raw.phone),
    }
    if (!p.email && !p.phone) problems.push({ row: p.row, reason: `${p.name ?? p.company ?? 'This partner'} has no usable email or phone, so they can't be matched. Add them by hand on Partners.` })
    else partners.push(p)
  })
  return { partners, problems }
}

/** Checks every file. Nothing here talks to the database. */
export function planMigration(files: MigrationFile[], partnersCsv: string | null, today = new Date()): MigrationPlan {
  const plan: MigrationPlan = { rows: [], problems: [], ignoredColumns: [], sensitiveColumns: [], partners: [], partnerProblems: [] }
  files.forEach((f, i) => {
    const checked = checkClientFile(f.text, today)
    if (checked.missingRequired.length) throw new Error(`${f.name} is missing required columns: ${checked.missingRequired.join(', ')}.`)
    if (checked.ignoredColumns.length) plan.ignoredColumns.push({ file: f.name, columns: checked.ignoredColumns })
    if (checked.sensitiveColumns.length) plan.sensitiveColumns.push({ file: f.name, columns: checked.sensitiveColumns })
    checked.rows.forEach((r: CheckedRow) => {
      if (r.data) plan.rows.push({ ...r.data, row: (i + 1) * ROW_BASE + r.row })
      else plan.problems.push({ file: f.name, row: r.row, name: r.name, errors: r.errors })
    })
  })
  if (partnersCsv) {
    const { partners, problems } = readPartners(partnersCsv)
    plan.partners = partners
    plan.partnerProblems = problems
  }
  return plan
}

const TAG = '$losuite_migration$'
const literal = (value: unknown) => {
  const json = JSON.stringify(value)
  if (json.includes(TAG)) throw new Error('The data contains the script\'s quote marker; rename that value and try again.')
  return `${TAG}${json}${TAG}::jsonb`
}

/**
 * The script to paste. It runs as the owner login (runAsEmail), whose company
 * receives the rows; import_clients() needs a signed-in owner, admin or loan
 * officer, so the script sets that login for its own transaction only. With
 * save = false it is a preview: import_clients() undoes its work and partners
 * are only counted.
 */
export function migrationSql(plan: MigrationPlan, opts: { runAsEmail: string; save: boolean; files: string[]; builtAt: string }): string {
  const mode = opts.save ? 'SAVE' : 'PREVIEW (saves nothing)'
  return `-- LOSuite: move the old app's clients and partners (${mode}).
-- Built ${opts.builtAt} from: ${opts.files.join(', ') || 'no client files'}${plan.partners.length ? ', partners' : ''}.
-- ${plan.rows.length} client rows, ${plan.partners.length} partners. Runs as ${opts.runAsEmail}.
-- CONTAINS CLIENT DATA: paste it into the DEV project's SQL Editor (the one
-- LOSuite uses), run the whole thing (nothing highlighted), then delete the
-- file. Never commit or share it. Safe to run again: matched people and
-- loans only get blanks filled, so a second run reports everything as
-- unchanged. The last row says how it went.

drop table if exists pg_temp.losuite_migration_results;
create temp table losuite_migration_results (kind text, row int, status text, message text);

do $migration$
declare
  v_me    uuid;
  v_org   uuid;
  v_rows  jsonb := ${literal(plan.rows)};
  v_parts jsonb := ${literal(plan.partners)};
  v_save  boolean := ${opts.save ? 'true' : 'false'};
  v_res   jsonb;
  v_p     jsonb;
  v_id    uuid;
  v_had   boolean;
  i       int := 0;
begin
  select p.id, m.organization_id into v_me, v_org
  from public.profiles p
  join public.organization_members m on m.user_id = p.id
  where lower(p.email) = lower('${opts.runAsEmail.replace(/'/g, "''")}') and m.role in ('owner', 'admin')
  order by m.created_at
  limit 1;
  if v_me is null then
    raise exception '${opts.runAsEmail.replace(/'/g, "''")} is not an owner or admin in LOSuite. Nothing was moved.';
  end if;
  -- import_clients() checks who is signed in; for this transaction only, that's the owner.
  perform set_config('request.jwt.claim.sub', v_me::text, true);

  -- Partners first, so agents on the moved files link to them (matched by
  -- email or phone; a new one is added, a match only gets blanks filled).
  for v_p in select value from jsonb_array_elements(v_parts) loop
    select exists (
      select 1 from public.partners p
      where p.organization_id = v_org
        and ((v_p->>'email' is not null and p.email_key = v_p->>'email')
          or (v_p->>'phone' is not null and p.phone_digits = v_p->>'phone' and (v_p->>'email' is null or p.email_key is null)))
    ) into v_had;
    if not v_save then
      insert into losuite_migration_results values ('partner', (v_p->>'row')::int, case when v_had then 'matched' else 'added' end, null);
      continue;
    end if;
    v_id := public.find_or_create_partner(v_org, (v_p->>'kind')::public.partner_kind, v_p->>'name', v_p->>'company', v_p->>'email', v_p->>'phone', 'manual');
    if v_id is null then
      insert into losuite_migration_results values ('partner', (v_p->>'row')::int, 'skipped', 'That phone is shared by several partners with no email, so it links no one. Add this partner by hand.');
    else
      perform public.fill_partner_blanks(v_id, v_p->>'company', v_p->>'email', v_p->>'phone');
      insert into losuite_migration_results values ('partner', (v_p->>'row')::int, case when v_had then 'matched' else 'added' end, null);
    end if;
  end loop;

  -- Clients, 150 at a time like the import screen.
  while i < jsonb_array_length(v_rows) loop
    v_res := public.import_clients(v_org, (select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality as t(e, n) where n > i and n <= i + 150), v_save);
    insert into losuite_migration_results (kind, row, status, message)
    select 'client', (x->>'row')::int, x->>'status', x->>'message' from jsonb_array_elements(v_res) x;
    i := i + 150;
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
end;
$migration$;

-- How it went (the last row is the one the SQL Editor shows).
select
  'LOSuite old app migration ${opts.save ? 'finished' : 'preview finished (nothing saved)'}' as result,
  count(*) filter (where kind = 'client' and status = 'added') as clients_added,
  count(*) filter (where kind = 'client' and status = 'updated') as clients_filled_in,
  count(*) filter (where kind = 'client' and status = 'unchanged') as clients_unchanged,
  count(*) filter (where kind = 'client' and status in ('skipped', 'error')) as clients_not_moved,
  count(*) filter (where kind = 'partner' and status = 'added') as partners_added,
  count(*) filter (where kind = 'partner' and status = 'matched') as partners_matched,
  count(*) filter (where kind = 'partner' and status = 'skipped') as partners_not_moved,
  coalesce(jsonb_agg(jsonb_build_object(
    'where', case when kind = 'client' then format('%s row %s', (${literal(opts.files)}) ->> (row / ${ROW_BASE} - 1), row % ${ROW_BASE}) else format('partners row %s', row) end,
    'status', status, 'message', message)) filter (where status in ('skipped', 'error')), '[]'::jsonb) as problems
from losuite_migration_results;
`
}
