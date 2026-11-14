// Mortgagee clauses (Connor, 2026-11-13). Each lender has a clause (name such
// as "UWM ISAOA/ATIMA", address, insurance email / fax, notes); a loan may
// override it. The clause used = the loan's override if set, else the
// lender's clause (else the lender's old one-line clause), plus
// "Loan # {lender loan number}". The CSV import matches rows to lenders by
// name and lists the rows it couldn't match. Pure.
import { parseCsv, toCsv } from '@/lib/import/csv'

export interface LenderClause {
  lenderId: string
  lenderName: string
  clauseName: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
  insuranceEmail: string | null
  insuranceFax: string | null
  notes: string | null
  /** The old one-line clause (before the structured fields). */
  legacy: string | null
}

export interface ClauseResult {
  text: string | null
  from: 'override' | 'lender' | 'legacy' | null
}

const loanLine = (n: string | null) => (n?.trim() ? `Loan # ${n.trim()}` : null)

/** The lender's clause as lines (no loan number); null when nothing is filled in. */
export function lenderClauseLines(c: LenderClause): string[] | null {
  const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter((x) => x && x.trim()).join(', ')
  const lines = [c.clauseName, c.addressLine1, c.addressLine2, cityLine].map((x) => x?.trim() ?? '').filter(Boolean)
  return c.addressLine1?.trim() || c.clauseName?.trim() ? lines : null
}

/** The clause for this loan: override, else the lender's, else its old text; plus the lender loan #. */
export function mortgageeClause(override: string | null, lender: LenderClause | null, lenderLoanNumber: string | null): ClauseResult {
  const withLoan = (body: string, from: ClauseResult['from']): ClauseResult => {
    const ln = loanLine(lenderLoanNumber)
    const has = !!lenderLoanNumber?.trim() && body.toLowerCase().includes(lenderLoanNumber.trim().toLowerCase())
    return { text: [body.trim(), has ? null : ln].filter(Boolean).join('\n'), from }
  }
  if (override?.trim()) return withLoan(override, 'override')
  const lines = lender ? lenderClauseLines(lender) : null
  if (lines) return withLoan(lines.join('\n'), 'lender')
  if (lender?.legacy?.trim()) return withLoan(lender.legacy, 'legacy')
  return { text: null, from: null }
}

// ---------------------------------------------------------------------------
// CSV import / export
// ---------------------------------------------------------------------------

export const CLAUSE_CSV_COLUMNS = ['lender_name', 'clause_name', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'email', 'notes'] as const

export interface ClauseRow {
  line: number
  lenderName: string
  clauseName: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zip: string | null
  email: string | null
  notes: string | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Reads the CSV (header row required; columns in any order). */
export function parseClauseCsv(text: string): { rows: ClauseRow[]; problems: string[] } {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim()))
  if (grid.length === 0) return { rows: [], problems: ['The file is empty.'] }
  const header = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const at = (name: (typeof CLAUSE_CSV_COLUMNS)[number]) => header.indexOf(name)
  if (at('lender_name') < 0) return { rows: [], problems: ['The first row needs a lender_name column.'] }
  const problems: string[] = []
  const rows: ClauseRow[] = []
  grid.slice(1).forEach((r, i) => {
    const get = (name: (typeof CLAUSE_CSV_COLUMNS)[number]) => {
      const v = at(name) >= 0 ? (r[at(name)] ?? '').trim() : ''
      return v || null
    }
    const lenderName = get('lender_name')
    if (!lenderName) return problems.push(`Row ${i + 2}: no lender name.`)
    const state = get('state')?.toUpperCase() ?? null
    if (state && !/^[A-Z]{2}$/.test(state)) problems.push(`Row ${i + 2}: state "${state}" isn't two letters; left blank.`)
    rows.push({
      line: i + 2,
      lenderName,
      clauseName: get('clause_name'),
      addressLine1: get('address_line1'),
      addressLine2: get('address_line2'),
      city: get('city'),
      state: state && /^[A-Z]{2}$/.test(state) ? state : null,
      zip: get('zip'),
      email: get('email')?.toLowerCase() ?? null,
      notes: get('notes'),
    })
  })
  return { rows, problems }
}

/** Matches rows to lenders by name (ignoring case, spaces and punctuation; short name too). */
export function matchClauseRows(rows: ClauseRow[], lenders: readonly { id: string; name: string; shortName?: string | null }[]) {
  const matched: { lenderId: string; lenderName: string; row: ClauseRow }[] = []
  const unmatched: ClauseRow[] = []
  for (const row of rows) {
    const key = norm(row.lenderName)
    const l = lenders.find((x) => norm(x.name) === key || (!!x.shortName && norm(x.shortName) === key))
    if (l) matched.push({ lenderId: l.id, lenderName: l.name, row })
    else unmatched.push(row)
  }
  return { matched, unmatched }
}

/** Every lender's clause as a CSV (the same columns the import reads). */
export function clauseCsv(clauses: readonly LenderClause[]): string {
  return toCsv([
    [...CLAUSE_CSV_COLUMNS],
    ...clauses.map((c) => [c.lenderName, c.clauseName, c.addressLine1, c.addressLine2, c.city, c.state, c.zip, c.insuranceEmail, c.notes]),
  ])
}
