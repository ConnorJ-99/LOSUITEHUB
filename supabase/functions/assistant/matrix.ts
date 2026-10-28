// The assistant's "read a lender matrix" task (Product Search v2 step 6): the
// JSON shape it must return, its instructions, and the checks on what comes
// back. Pure, with no imports, so the Edge Function (Deno) and the app
// (review screen and tests) share the same shape. The word lists match
// src/lib/products/taxonomy.ts (a test checks).
//
// Nothing read here is searchable until Connor approves it on the review
// screen. A blank cell ("—", "N/A", empty) is null, never 0.

export const FAMILIES = ['conventional', 'fha', 'va', 'usda', 'jumbo', 'non_qm'] as const
export const LIENS = ['first', 'ces', 'heloc'] as const
export const DOC_TYPES = ['full_doc', 'bank_statement_12', 'bank_statement_24', 'form_1099', 'pnl_only', 'asset_depletion', 'dscr', 'wvoe', 'no_ratio', 'retirement_distribution'] as const
export const FEATURES = ['dpa', 'itin', 'foreign_national', 'interest_only', 'non_warrantable_condo', 'manufactured', 'buydown', 'recent_credit_event', 'first_time_investor', 'str_income', 'homeready_possible', 'llc_vesting'] as const
export const PURPOSES = ['purchase', 'rate_term', 'cash_out'] as const
export const PROPERTY_TYPES = ['sfr_pud', 'condo', 'non_warrantable_condo', 'two_to_four', 'manufactured', 'mixed_use'] as const
export const OCCUPANCIES = ['primary', 'second_home', 'investment'] as const
/** Term options: fixed terms, ARMs, and HELOC draw/repay periods (years). */
export const TERMS = ['fixed_40', 'fixed_30', 'fixed_25', 'fixed_20', 'fixed_15', 'fixed_10', 'arm_5_6', 'arm_7_6', 'arm_10_6', 'heloc_10_20', 'heloc_10_15', 'heloc_5_25', 'heloc_3_27'] as const
export const RULE_FIELDS = ['dti', 'reserves_months', 'mortgage_lates_12', 'mortgage_lates_24', 'bk_seasoning_months', 'fc_seasoning_months', 'state', 'citizenship', 'self_employed_years', 'loan_amount', 'fico', 'ltv', 'cltv', 'dscr', 'units', 'first_time_buyer', 'income_vs_ami'] as const
export const RULE_OPS = ['<=', '>=', 'in', 'not_in', 'required', 'between'] as const

type Of<T extends readonly string[]> = T[number]

/** One column of a grid: what's different about it (a loan tier, an occupancy, units, purposes or property types). */
export interface GridColumn {
  label: string
  loanAmountMin: number
  /** Null = no upper limit. */
  loanAmountMax: number | null
  occupancy: Of<typeof OCCUPANCIES> | null
  unitsMin: number | null
  unitsMax: number | null
  purposes: Of<typeof PURPOSES>[] | null
  propertyTypes: Of<typeof PROPERTY_TYPES>[] | null
}

export interface GridRow {
  label: string
  ficoMin: number
  ficoMax: number
}

/** One grid as printed: defaults for every cell, then rows (credit bands) × columns. */
export interface ReadGrid {
  page: number
  title: string
  /** Whether the numbers are max LTV or max CLTV. */
  ratio: 'ltv' | 'cltv'
  occupancy: Of<typeof OCCUPANCIES>
  propertyTypes: Of<typeof PROPERTY_TYPES>[]
  purposes: Of<typeof PURPOSES>[]
  /** Every income type the grid applies to (one grid can cover bank statement, asset depletion and IRA distribution alike). */
  docTypes: Of<typeof DOC_TYPES>[]
  unitsMin: number
  unitsMax: number
  rows: GridRow[]
  columns: GridColumn[]
  /** values[row][column]: the limit as a percent, or null for a blank ("—", "N/A"). */
  values: (number | null)[][]
  /** The grid's size as counted on the page (checked against rows × columns). */
  printedRows: number
  printedColumns: number
  notes: string | null
}

export interface ReadRule {
  field: Of<typeof RULE_FIELDS>
  op: Of<typeof RULE_OPS>
  value: number | string[] | { min: number; max: number } | null
  appliesWhen: { purposes?: Of<typeof PURPOSES>[]; occupancies?: Of<typeof OCCUPANCIES>[]; ltv_above?: number } | null
  severity: 'hard' | 'verify'
  message: string
  page: number | null
  quote: string
}

export interface ReadProgram {
  name: string
  family: Of<typeof FAMILIES>
  lien: Of<typeof LIENS>
  docTypes: Of<typeof DOC_TYPES>[]
  features: Of<typeof FEATURES>[]
  purposes: Of<typeof PURPOSES>[]
  /** Every term the program offers; a program is a product, not one term. */
  termOptions: Of<typeof TERMS>[]
  /** 2nd liens: whether the loan-amount tier uses the 2nd alone or 1st + 2nd. */
  loanAmountBasis: 'this_lien' | 'combined'
  description: string | null
  grids: ReadGrid[]
  rules: ReadRule[]
}

export interface MatrixReading {
  programs: ReadProgram[]
  effectiveDate: string | null
  notes: string | null
  /** Things the assistant returned that didn't fit the lists; shown so nothing is silently lost. */
  dropped: string[]
}

const enumOf = (values: readonly string[], description?: string) => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) })
const arrayOf = (values: readonly string[], description: string) => ({ type: 'array', items: { type: 'string', enum: [...values] }, description })
/** A value or null (structured outputs take anyOf; a list of types isn't documented). */
const nullable = (schema: Record<string, unknown>, description?: string) => ({ anyOf: [schema, { type: 'null' }], ...(description ? { description } : {}) })

/** The JSON shape Claude must return (enforced by structured outputs, then checked again here). */
export const MATRIX_SCHEMA = {
  type: 'object',
  properties: {
    effective_date: { type: 'string', description: 'The matrix effective date as YYYY-MM-DD, or empty.' },
    programs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "The program's name as the lender prints it." },
          family: enumOf(FAMILIES),
          lien: enumOf(LIENS, 'first = 1st lien; ces = closed-end second; heloc = home equity line'),
          doc_types: arrayOf(DOC_TYPES, 'Income documentation the program allows.'),
          features: arrayOf(FEATURES, 'Only features the matrix states the program offers or requires.'),
          purposes: arrayOf(PURPOSES, 'Loan purposes offered.'),
          term_options: arrayOf(TERMS, 'Every term the program offers: fixed terms, ARMs, HELOC draw/repay periods. One program per product: list its terms here, never a separate program per term.'),
          loan_amount_basis: { type: 'string', enum: ['this_lien', 'combined'], description: 'For 2nd liens: whether loan-amount tiers use the 2nd lien alone (this_lien) or 1st + 2nd (combined). this_lien for 1st liens.' },
          description: { type: 'string', description: 'One or two sentences on who the program is for, from the document. Empty if none.' },
          grids: {
            type: 'array',
            description: 'Every max LTV / CLTV grid for this program, one entry per printed grid.',
            items: {
              type: 'object',
              properties: {
                page: { type: 'integer', description: 'Page the grid is on (1 = first page).' },
                title: { type: 'string', description: 'The grid heading as printed.' },
                ratio: { type: 'string', enum: ['ltv', 'cltv'] },
                occupancy: enumOf(OCCUPANCIES, 'Occupancy for the whole grid (columns can override).'),
                property_types: arrayOf(PROPERTY_TYPES, 'Property types the whole grid covers (columns can override).'),
                purposes: arrayOf(PURPOSES, 'Purposes the whole grid covers (columns can override).'),
                doc_types: arrayOf(DOC_TYPES, 'Every income type this grid applies to. When one grid covers several (bank statement, asset depletion, IRA distribution...), list them all; never pick one or split the grid.'),
                units_min: { type: 'integer' },
                units_max: { type: 'integer' },
                rows: {
                  type: 'array',
                  description: 'Credit score bands, top to bottom, as printed.',
                  items: { type: 'object', properties: { label: { type: 'string' }, fico_min: { type: 'integer' }, fico_max: { type: 'integer', description: '850 for an open band like "740+".' } }, required: ['label', 'fico_min', 'fico_max'], additionalProperties: false },
                },
                columns: {
                  type: 'array',
                  description: 'Columns, left to right. Fill in only what the column changes; leave the rest empty or null.',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      loan_amount_min: { type: 'number', description: '0 if the column has no loan-amount limit.' },
                      loan_amount_max: nullable({ type: 'number' }, 'Null if no upper limit.'),
                      occupancy: nullable({ type: 'string', enum: [...OCCUPANCIES] }),
                      units_min: nullable({ type: 'integer' }),
                      units_max: nullable({ type: 'integer' }),
                      purposes: nullable({ type: 'array', items: { type: 'string', enum: [...PURPOSES] } }),
                      property_types: nullable({ type: 'array', items: { type: 'string', enum: [...PROPERTY_TYPES] } }),
                    },
                    required: ['label', 'loan_amount_min', 'loan_amount_max', 'occupancy', 'units_min', 'units_max', 'purposes', 'property_types'],
                    additionalProperties: false,
                  },
                },
                values: { type: 'array', items: { type: 'array', items: nullable({ type: 'number' }) }, description: 'values[row][column]: the max as a percent (97 for 97%), null for a blank, "—", "N/A" or "not offered". Never 0 for a blank.' },
                printed_rows: { type: 'integer', description: 'How many credit-score rows the printed grid has.' },
                printed_columns: { type: 'integer', description: 'How many value columns the printed grid has.' },
                notes: { type: 'string', description: 'Footnotes under the grid, as printed. Empty if none.' },
              },
              required: ['page', 'title', 'ratio', 'occupancy', 'property_types', 'purposes', 'doc_types', 'units_min', 'units_max', 'rows', 'columns', 'values', 'printed_rows', 'printed_columns', 'notes'],
              additionalProperties: false,
            },
          },
          rules: {
            type: 'array',
            description: 'Program-wide requirements that are not grid cells: max DTI, reserves, mortgage lates, credit event seasoning, states, citizenship, years self-employed, loan amount limits, min DSCR, units, first-time buyer, income limits.',
            items: {
              type: 'object',
              properties: {
                field: enumOf(RULE_FIELDS),
                op: enumOf(RULE_OPS),
                number: nullable({ type: 'number' }, 'For <= and >=.'),
                list: nullable({ type: 'array', items: { type: 'string' } }, 'For in / not_in (e.g. state codes).'),
                min: nullable({ type: 'number' }, 'For between.'),
                max: nullable({ type: 'number' }, 'For between.'),
                applies_purposes: nullable({ type: 'array', items: { type: 'string', enum: [...PURPOSES] } }, 'Only for these purposes, or null for all.'),
                applies_occupancies: nullable({ type: 'array', items: { type: 'string', enum: [...OCCUPANCIES] } }),
                applies_ltv_above: nullable({ type: 'number' }, 'Only above this LTV/CLTV, or null.'),
                severity: { type: 'string', enum: ['hard', 'verify'], description: 'hard = rules the program out; verify = something to check (e.g. "per AUS").' },
                message: { type: 'string', description: 'Plain English, e.g. "Max DTI 50%".' },
                page: { type: 'integer' },
                quote: { type: 'string', description: 'The words on the page, copied exactly.' },
              },
              required: ['field', 'op', 'number', 'list', 'min', 'max', 'applies_purposes', 'applies_occupancies', 'applies_ltv_above', 'severity', 'message', 'page', 'quote'],
              additionalProperties: false,
            },
          },
        },
        required: ['name', 'family', 'lien', 'doc_types', 'features', 'purposes', 'term_options', 'loan_amount_basis', 'description', 'grids', 'rules'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'Anything Connor should check: grids you could not read cleanly, footnotes that change limits, pages that look like a different program. Empty if nothing.' },
  },
  required: ['effective_date', 'programs', 'notes'],
  additionalProperties: false,
}

export const MATRIX_SYSTEM_PROMPT = `You read mortgage lender eligibility matrices for Connor, a licensed loan officer at MPS Mortgage LLC in Texas. Your reading is checked by Connor against the PDF, cell by cell, before anything is used, so accuracy matters more than completeness.

- Copy every max LTV / CLTV grid exactly as printed: one entry per grid, rows are credit-score bands top to bottom, columns left to right.
- A blank cell, "—", "N/A", "NA" or "not offered" is null. Never write 0 for a blank.
- A grid often covers several income types (e.g. one Non-QM grid for bank statement, asset depletion and IRA distribution): list every one in doc_types. Income types the lender names that aren't on the list go in notes.
- Put what a column changes on the column (a loan-amount tier, an occupancy, units, purposes or property types) and what the whole grid shares on the grid.
- Credit bands: "720-739" is 720 to 739; "740+" or "≥740" is 740 to 850; "<620" is 300 to 619.
- Loan amounts in dollars: "$1,000,001 - $1.5MM" is 1000001 to 1500000; "≤ $1MM" is 0 to 1000000.
- Use only the words in the schema's lists. If the lender uses another name, pick the matching one; if none fits, leave it out and say so in notes.
- A program is a loan product ("Conventional", "FHA", "Equity Advantage HELOC"), not a term: list its terms in term_options. Split a product into two programs only when the lender prints separate grids or rules for them.
- If the document is a guideline with no grids, still return each program it covers with its terms, doc types, purposes, rules and description, and an empty grids list.
- Program-wide requirements that are not grid cells go in rules, each with the exact quote and page.
- Do not calculate, average or fill gaps. Report what is printed.`

export const MATRIX_USER_PROMPT = 'Read this lender document (a matrix or a guideline) and return every program (loan product) with its term options, every grid (with every cell) and every program-wide rule, with pages and quotes.'

/**
 * The matrix form is too large for structured outputs ("The compiled grammar is
 * too large"), so its shape is given in the request instead, and every field
 * of the reply is checked by normalizeMatrixReading (anything off the lists is
 * dropped and listed for review).
 */
export const MATRIX_FORMAT_PROMPT = `Reply with one JSON object and nothing else (no Markdown, no commentary). It must match this JSON Schema exactly; use only the listed words where a list is given:\n${JSON.stringify(MATRIX_SCHEMA)}`

/** The JSON object in a reply, even if it came wrapped in a code fence or a sentence; null if there isn't one. */
export function parseJsonReply(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null)
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pick = <T extends readonly string[]>(values: T, v: unknown): T[number] | null => (values as readonly unknown[]).includes(v) ? (v as T[number]) : null
const pickAll = <T extends readonly string[]>(values: T, v: unknown, dropped: string[], what: string): T[number][] => {
  if (!Array.isArray(v)) return []
  const out: T[number][] = []
  for (const x of v) {
    const ok = pick(values, x)
    if (ok) out.push(ok)
    else dropped.push(`${what}: "${String(x)}"`)
  }
  return [...new Set(out)]
}

function normalizeGrid(g: Record<string, unknown>, program: string, dropped: string[]): ReadGrid | null {
  const where = `${program}, grid "${str(g.title)}"`
  const occupancy = pick(OCCUPANCIES, g.occupancy)
  // Older readings had one doc_type per grid.
  const docTypes = Array.isArray(g.doc_types) ? pickAll(DOC_TYPES, g.doc_types, dropped, `${where} income type`) : [pick(DOC_TYPES, g.doc_type)].filter((d): d is Of<typeof DOC_TYPES> => d != null)
  if (!occupancy || docTypes.length === 0) {
    dropped.push(`${where}: unknown occupancy or doc type`)
    return null
  }
  const rows = (Array.isArray(g.rows) ? g.rows : []).filter(isObject).map((r) => ({ label: str(r.label), ficoMin: int(r.fico_min) ?? 0, ficoMax: int(r.fico_max) ?? 0 }))
  const columns = (Array.isArray(g.columns) ? g.columns : []).filter(isObject).map(
    (c): GridColumn => ({
      label: str(c.label),
      loanAmountMin: numOrNull(c.loan_amount_min) ?? 0,
      loanAmountMax: numOrNull(c.loan_amount_max),
      occupancy: pick(OCCUPANCIES, c.occupancy),
      unitsMin: int(c.units_min),
      unitsMax: int(c.units_max),
      purposes: Array.isArray(c.purposes) ? pickAll(PURPOSES, c.purposes, dropped, `${where} column purpose`) : null,
      propertyTypes: Array.isArray(c.property_types) ? pickAll(PROPERTY_TYPES, c.property_types, dropped, `${where} column property type`) : null,
    }),
  )
  const values = (Array.isArray(g.values) ? g.values : []).map((row) => (Array.isArray(row) ? row.map((v) => numOrNull(v)) : []))
  return {
    page: int(g.page) ?? 0,
    title: str(g.title),
    ratio: g.ratio === 'cltv' ? 'cltv' : 'ltv',
    occupancy,
    propertyTypes: pickAll(PROPERTY_TYPES, g.property_types, dropped, `${where} property type`),
    purposes: pickAll(PURPOSES, g.purposes, dropped, `${where} purpose`),
    docTypes,
    unitsMin: int(g.units_min) ?? 1,
    unitsMax: int(g.units_max) ?? 4,
    rows,
    columns,
    values,
    printedRows: int(g.printed_rows) ?? rows.length,
    printedColumns: int(g.printed_columns) ?? columns.length,
    notes: str(g.notes) || null,
  }
}

function normalizeRule(r: Record<string, unknown>, program: string, dropped: string[]): ReadRule | null {
  const field = pick(RULE_FIELDS, r.field)
  const op = pick(RULE_OPS, r.op)
  if (!field || !op) {
    dropped.push(`${program} rule: "${str(r.message)}"`)
    return null
  }
  let value: ReadRule['value'] = null
  if (op === '<=' || op === '>=') value = numOrNull(r.number)
  else if (op === 'in' || op === 'not_in') value = Array.isArray(r.list) ? r.list.map(str).filter(Boolean) : null
  else if (op === 'between') value = numOrNull(r.min) != null && numOrNull(r.max) != null ? { min: numOrNull(r.min)!, max: numOrNull(r.max)! } : null
  if (op !== 'required' && value == null) {
    dropped.push(`${program} rule without a value: "${str(r.message)}"`)
    return null
  }
  const purposes = Array.isArray(r.applies_purposes) ? pickAll(PURPOSES, r.applies_purposes, dropped, `${program} rule purpose`) : []
  const occupancies = Array.isArray(r.applies_occupancies) ? pickAll(OCCUPANCIES, r.applies_occupancies, dropped, `${program} rule occupancy`) : []
  const ltvAbove = numOrNull(r.applies_ltv_above)
  const appliesWhen = purposes.length || occupancies.length || ltvAbove != null ? { ...(purposes.length && { purposes }), ...(occupancies.length && { occupancies }), ...(ltvAbove != null && { ltv_above: ltvAbove }) } : null
  return { field, op, value, appliesWhen, severity: r.severity === 'verify' ? 'verify' : 'hard', message: str(r.message) || `${field} ${op}`, page: int(r.page) && int(r.page)! > 0 ? int(r.page) : null, quote: str(r.quote) }
}

/** Checks Claude's reading. Anything outside the lists is dropped and listed, never guessed. */
export function normalizeMatrixReading(raw: unknown): MatrixReading | { error: string } {
  if (!isObject(raw) || !Array.isArray(raw.programs)) return { error: 'The assistant returned something unreadable.' }
  const dropped: string[] = []
  const programs = raw.programs.filter(isObject).flatMap((p): ReadProgram[] => {
    const name = str(p.name)
    const family = pick(FAMILIES, p.family)
    const lien = pick(LIENS, p.lien)
    if (!name || !family || !lien) {
      dropped.push(`Program "${name || 'unnamed'}": unknown product family or lien`)
      return []
    }
    return [
      {
        name,
        family,
        lien,
        docTypes: pickAll(DOC_TYPES, p.doc_types, dropped, `${name} doc type`),
        features: pickAll(FEATURES, p.features, dropped, `${name} feature`),
        purposes: pickAll(PURPOSES, p.purposes, dropped, `${name} purpose`),
        termOptions: Array.isArray(p.term_options) ? pickAll(TERMS, p.term_options, dropped, `${name} term`) : legacyTerms(p.terms_months),
        loanAmountBasis: p.loan_amount_basis === 'combined' ? 'combined' : 'this_lien',
        description: str(p.description) || null,
        grids: (Array.isArray(p.grids) ? p.grids : []).filter(isObject).flatMap((g) => normalizeGrid(g, name, dropped) ?? []),
        rules: (Array.isArray(p.rules) ? p.rules : []).filter(isObject).flatMap((r) => normalizeRule(r, name, dropped) ?? []),
      },
    ]
  })
  if (programs.length === 0) return { error: "The assistant couldn't find a loan program in this document. Check that it's a lender matrix or guideline." }
  const date = str(raw.effective_date)
  return { programs, effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null, notes: str(raw.notes) || null, dropped }
}

/** Older readings listed terms in months; fixed terms map to term options. */
function legacyTerms(months: unknown): Of<typeof TERMS>[] {
  const map: Record<number, Of<typeof TERMS>> = { 480: 'fixed_40', 360: 'fixed_30', 300: 'fixed_25', 240: 'fixed_20', 180: 'fixed_15', 120: 'fixed_10' }
  return Array.isArray(months) ? [...new Set(months.map(int).flatMap((n) => (n != null && map[n] ? [map[n]] : [])))] : []
}

/** Matrix PDFs are read one at a time; base64 adds a third, so 20 MB stays under the request limit. */
export const MAX_MATRIX_BYTES = 20 * 1024 * 1024
