// Lenders → Import lenders CSV (Connor, 2026-11-17). Reads Connor's lender
// spreadsheet (columns in LENDER_CSV_COLUMNS, any order) and works out what
// each row changes. Rules:
//  - rows are matched to lenders by name (ignoring case, spaces and
//    punctuation; the short name too); a row with no match can be added;
//  - a blank cell leaves what MPS HQ has; a filled cell replaces it;
//  - the CSV's notes are added under the lender's notes, never replace them;
//  - the second AE, scenario desk, closing and condition upload go in the
//    lender's contacts, matched by role and name so a re-import updates them;
//  - rows named "(Sample)" are skipped.
// Pure, so the screen and the tests share it.

import { parseCsv } from '@/lib/import/csv'
import { LENDER_STATUSES, type LenderStatus } from './taxonomy'

export const LENDER_CSV_COLUMNS = [
  'lender_name', 'status', 'lender_nmls', 'website', 'portal_url', 'broker_id', 'portal_username',
  'ae_name', 'ae_phone', 'ae_email', 'ae_covers', 'ae2_name', 'ae2_phone', 'ae2_email', 'ae2_covers',
  'scenario_desk_email', 'scenario_desk_phone', 'closing_email', 'condition_upload_email',
  'clause_name', 'clause_address_line1', 'clause_address_line2', 'clause_city', 'clause_state', 'clause_zip',
  'insurance_email', 'insurance_fax', 'clause_notes', 'notes',
] as const
type Column = (typeof LENDER_CSV_COLUMNS)[number]

/** The lender's own fields the CSV can fill (database column → value). */
export interface LenderCsvFields {
  status?: LenderStatus
  nmls?: string
  website?: string
  portal_url?: string
  broker_id?: string
  portal_username?: string
  ae_name?: string
  ae_phone?: string
  ae_email?: string
  ae_covers?: string
  clause_name?: string
  clause_address_line1?: string
  clause_address_line2?: string
  clause_city?: string
  clause_state?: string
  clause_zip?: string
  insurance_email?: string
  insurance_fax?: string
  clause_notes?: string
}

export interface LenderCsvContact {
  name: string
  role: string
  phone: string | null
  email: string | null
  notes: string | null
}

export interface LenderCsvRow {
  line: number
  name: string
  fields: LenderCsvFields
  contacts: LenderCsvContact[]
  notes: string | null
}

const FIELD_LABEL: Record<keyof LenderCsvFields, string> = {
  status: 'status',
  nmls: 'NMLS #',
  website: 'website',
  portal_url: 'portal',
  broker_id: 'broker ID',
  portal_username: 'portal username',
  ae_name: 'AE',
  ae_phone: 'AE phone',
  ae_email: 'AE email',
  ae_covers: 'AE covers',
  clause_name: 'clause',
  clause_address_line1: 'clause address',
  clause_address_line2: 'clause address',
  clause_city: 'clause city',
  clause_state: 'clause state',
  clause_zip: 'clause ZIP',
  insurance_email: 'insurance email',
  insurance_fax: 'insurance fax',
  clause_notes: 'clause notes',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const isSample = (name: string) => /\(\s*sample\s*\)/i.test(name)
const url = (v: string) => (/^https?:\/\//i.test(v) ? v : `https://${v}`)

/** "approved", "Approved" or "Application pending" → the status; anything else null. */
export function statusFrom(v: string): LenderStatus | null {
  const k = norm(v)
  for (const s of LENDER_STATUSES.values) if (norm(s) === k || norm(LENDER_STATUSES.label[s]) === k) return s
  return k === 'notsignedup' ? 'not_signed_up' : null
}

/** Reads the file. Rows named "(Sample)" are left out and listed in problems. */
export function parseLenderCsv(text: string): { rows: LenderCsvRow[]; problems: string[] } {
  const grid = parseCsv(text)
  if (grid.length === 0) return { rows: [], problems: ['The file is empty.'] }
  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  if (!header.includes('lender_name')) return { rows: [], problems: ['The first row needs a lender_name column.'] }
  const problems: string[] = []
  const rows: LenderCsvRow[] = []
  const seen = new Map<string, number>()
  grid.slice(1).forEach((r, i) => {
    const line = i + 2
    const get = (c: Column) => {
      const at = header.indexOf(c)
      return (at >= 0 ? (r[at] ?? '') : '').trim() || null
    }
    const name = get('lender_name')
    if (!name) return problems.push(`Row ${line}: no lender name, skipped.`)
    if (isSample(name)) return problems.push(`Row ${line}: ${name} is a sample, skipped.`)
    const earlier = seen.get(norm(name))
    if (earlier) return problems.push(`Row ${line}: ${name} is already on row ${earlier}, skipped.`)
    seen.set(norm(name), line)

    const fields: LenderCsvFields = {}
    const put = <K extends keyof LenderCsvFields>(k: K, v: LenderCsvFields[K] | null | undefined) => {
      if (v) fields[k] = v
    }
    const status = get('status')
    if (status) {
      const s = statusFrom(status)
      if (s) fields.status = s
      else problems.push(`Row ${line}: status "${status}" isn't Approved, Application pending, Not signed up or Inactive; left as is.`)
    }
    put('nmls', get('lender_nmls')?.replace(/\D/g, '') || null)
    put('website', get('website') && url(get('website')!))
    put('portal_url', get('portal_url') && url(get('portal_url')!))
    put('broker_id', get('broker_id'))
    put('portal_username', get('portal_username'))
    put('ae_name', get('ae_name'))
    put('ae_phone', get('ae_phone'))
    put('ae_email', get('ae_email')?.toLowerCase())
    put('ae_covers', get('ae_covers'))
    put('clause_name', get('clause_name'))
    put('clause_address_line1', get('clause_address_line1'))
    put('clause_address_line2', get('clause_address_line2'))
    put('clause_city', get('clause_city'))
    const st = get('clause_state')?.toUpperCase()
    if (st && !/^[A-Z]{2}$/.test(st)) problems.push(`Row ${line}: clause state "${st}" isn't two letters; left as is.`)
    else put('clause_state', st)
    put('clause_zip', get('clause_zip'))
    put('insurance_email', get('insurance_email')?.toLowerCase())
    put('insurance_fax', get('insurance_fax'))
    put('clause_notes', get('clause_notes'))

    const contacts: LenderCsvContact[] = []
    const ae2 = { name: get('ae2_name'), phone: get('ae2_phone'), email: get('ae2_email')?.toLowerCase() ?? null, covers: get('ae2_covers') }
    if (ae2.name || ae2.phone || ae2.email) contacts.push({ name: ae2.name ?? 'Second AE', role: 'Account executive', phone: ae2.phone, email: ae2.email, notes: ae2.covers ? `Covers: ${ae2.covers}` : null })
    const desk = { email: get('scenario_desk_email')?.toLowerCase() ?? null, phone: get('scenario_desk_phone') }
    if (desk.email || desk.phone) contacts.push({ name: 'Scenario desk', role: 'Scenario desk', phone: desk.phone, email: desk.email, notes: null })
    const closing = get('closing_email')?.toLowerCase()
    if (closing) contacts.push({ name: 'Closing', role: 'Closing', phone: null, email: closing, notes: null })
    const upload = get('condition_upload_email')?.toLowerCase()
    if (upload) contacts.push({ name: 'Condition upload', role: 'Condition upload', phone: null, email: upload, notes: null })

    rows.push({ line, name, fields, contacts, notes: get('notes') })
  })
  return { rows, problems }
}

/** What MPS HQ has for a lender, for the comparison. */
export interface ExistingLender {
  id: string
  name: string
  shortName?: string | null
  notes: string | null
  /** Database column → value, for the columns in LenderCsvFields. */
  values: Partial<Record<keyof LenderCsvFields, string | null>>
  contacts: { id: string; name: string; role: string; phone: string | null; email: string | null; notes: string | null }[]
}

export interface LenderUpdate {
  lenderId: string
  lenderName: string
  row: LenderCsvRow
  /** Only the fields whose value changes. */
  changes: LenderCsvFields
  /** The new notes, when the CSV adds to them. */
  notes: string | null
  /** Contacts to add (no id) or update (id), only where something changes. */
  contacts: (LenderCsvContact & { id: string | null })[]
  /** Plain words for the preview: "NMLS #, website, 2 contacts". */
  summary: string[]
}

/** The lender's notes with the CSV's added below, unless they're already there. */
export function mergedNotes(existing: string | null, incoming: string | null): string | null {
  if (!incoming) return null
  const have = (existing ?? '').trim()
  if (have.includes(incoming.trim())) return null
  return have ? `${have}\n\n${incoming.trim()}` : incoming.trim()
}

function contactChanges(existing: ExistingLender['contacts'], incoming: LenderCsvContact[]) {
  const out: (LenderCsvContact & { id: string | null })[] = []
  for (const c of incoming) {
    const same = existing.find((e) => norm(e.role) === norm(c.role) && norm(e.name) === norm(c.name)) ?? (c.role !== 'Account executive' ? existing.find((e) => norm(e.role) === norm(c.role)) : undefined)
    if (!same) {
      out.push({ ...c, id: null })
      continue
    }
    const merged = { name: c.name, role: same.role, phone: c.phone ?? same.phone, email: c.email ?? same.email, notes: c.notes ?? same.notes }
    if (merged.name !== same.name || merged.phone !== same.phone || merged.email !== same.email || merged.notes !== same.notes) out.push({ ...merged, id: same.id })
  }
  return out
}

/** Matches each row to a lender and works out what it changes. Rows with no lender go in `adds`. */
export function planLenderImport(rows: LenderCsvRow[], lenders: readonly ExistingLender[]) {
  const updates: LenderUpdate[] = []
  const unchanged: { lenderName: string; row: LenderCsvRow }[] = []
  const adds: LenderCsvRow[] = []
  for (const row of rows) {
    const key = norm(row.name)
    const l = lenders.find((x) => norm(x.name) === key || (!!x.shortName && norm(x.shortName) === key))
    if (!l) {
      adds.push(row)
      continue
    }
    const changes: LenderCsvFields = {}
    for (const [k, v] of Object.entries(row.fields) as [keyof LenderCsvFields, string][]) {
      if ((l.values[k] ?? null) !== v) (changes as Record<string, string>)[k] = v
    }
    const notes = mergedNotes(l.notes, row.notes)
    const contacts = contactChanges(l.contacts, row.contacts)
    const summary = [...new Set((Object.keys(changes) as (keyof LenderCsvFields)[]).map((k) => FIELD_LABEL[k]))]
    if (notes) summary.push('notes')
    if (contacts.length) summary.push(contacts.length === 1 ? '1 contact' : `${contacts.length} contacts`)
    if (summary.length === 0) unchanged.push({ lenderName: l.name, row })
    else updates.push({ lenderId: l.id, lenderName: l.name, row, changes, notes, contacts, summary })
  }
  return { updates, unchanged, adds }
}
