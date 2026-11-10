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
export const PROPERTY_TYPES = ['sfr_pud', 'condo', 'non_warrantable_condo', 'two_to_four', 'manufactured', 'mixed_use', 'condotel', 'rural', 'five_plus'] as const
export const OCCUPANCIES = ['primary', 'second_home', 'investment'] as const
/** Term options: fixed terms, ARMs, and HELOC draw/repay periods (years). */
export const TERMS = ['fixed_40', 'fixed_30', 'fixed_25', 'fixed_20', 'fixed_15', 'fixed_10', 'arm_5_6', 'arm_7_6', 'arm_10_6', 'heloc_10_20', 'heloc_10_15', 'heloc_5_25', 'heloc_3_27'] as const
export const RULE_FIELDS = ['dti', 'reserves_months', 'mortgage_lates_12', 'mortgage_lates_24', 'bk_seasoning_months', 'fc_seasoning_months', 'state', 'citizenship', 'self_employed_years', 'loan_amount', 'fico', 'ltv', 'cltv', 'dscr', 'units', 'first_time_buyer', 'income_vs_ami'] as const
export const RULE_OPS = ['<=', '>=', 'in', 'not_in', 'required', 'between'] as const
/** How a grid's loan amounts read: "up to $X" tiers (a larger tier also covers smaller loans) or printed ranges. */
export const LOAN_AMOUNT_MODES = ['max_tiers', 'explicit_ranges'] as const
/** How a grid's credit scores read: minimums (700 = 700 and up) or printed bands (700-719). */
export const CREDIT_MODES = ['minimums', 'bands'] as const
/** What a blank square means: nothing printed there, or not offered. */
export const BLANK_MODES = ['not_specified', 'not_offered'] as const

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

/** One row of a row-list matrix, exactly as the lender prints it: a maximum loan amount, a minimum credit score, and a limit per purpose. */
export interface PrintedRow {
  /** Null = no maximum printed. */
  loanAmountMax: number | null
  ficoMin: number
  /** One limit per value column (null = blank). */
  values: (number | null)[]
  notes: string | null
}

/** A row-list matrix as printed. The grid (rows, columns, values) is generated from this, never the other way around. */
export interface PrintedRows {
  /** The limit columns, left to right ("Purchase / R&T", "Cash-out"). */
  columns: { label: string; purposes: Of<typeof PURPOSES>[] | null }[]
  rows: PrintedRow[]
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
  /** The lowest DSCR the grid applies to (1 for "DSCR 1.00+", 0.75 for "0.75-0.99"); null when the grid doesn't depend on DSCR. */
  dscrMin?: number | null
  rows: GridRow[]
  columns: GridColumn[]
  /** values[row][column]: the limit as a percent, or null for a blank ("—", "N/A"). */
  values: (number | null)[][]
  /** The grid's size as counted on the page (checked against rows × columns). */
  printedRows: number
  printedColumns: number
  notes: string | null
  /** The three reading settings. Left out on older readings: worked out from the grid's shape (gridSettings). */
  loanAmounts?: Of<typeof LOAN_AMOUNT_MODES>
  creditScores?: Of<typeof CREDIT_MODES>
  blankCells?: Of<typeof BLANK_MODES>
  /** The structure is unclear (tiers that look like ranges but aren't labeled, "use the lower of"...): Connor confirms the settings before approving. */
  ambiguous?: boolean
  ambiguousReason?: string | null
  /** Connor confirmed how to read an ambiguous grid. */
  settingsConfirmed?: boolean
  /** A row-list matrix's rows exactly as read, kept beside the generated grid. */
  asPrinted?: PrintedRows | null
}

export interface ReadRule {
  field: Of<typeof RULE_FIELDS>
  op: Of<typeof RULE_OPS>
  value: number | string[] | { min: number; max: number } | null
  appliesWhen: { purposes?: Of<typeof PURPOSES>[]; occupancies?: Of<typeof OCCUPANCIES>[]; ltv_above?: number; loan_amount_below?: number; states?: string[]; property_types?: Of<typeof PROPERTY_TYPES>[] } | null
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
  /** A draft opened from "Edit limits": the program whose matrix in use it copies (approving replaces it). */
  editOf?: string
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
                dscr_min: nullable({ type: 'number' }, 'Lowest DSCR the grid applies to: 1 for "DSCR >= 1.00", 0.75 for "0.75 - 0.99", 0 for "< 0.75" or no ratio. Null when the grid does not depend on DSCR.'),
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
                loan_amounts: { type: 'string', enum: [...LOAN_AMOUNT_MODES], description: 'max_tiers when loan amounts are printed as plain amounts or "≤ $X" (each is "up to $X", and a larger tier also covers smaller loans). explicit_ranges only when the lender prints ranges ("$500,001 - $1,000,000").' },
                credit_scores: { type: 'string', enum: [...CREDIT_MODES], description: 'minimums when each row gives a minimum score (a row list, or rows like "700", "700+"); bands when ranges are printed ("700 - 719").' },
                blank_cells: { type: 'string', enum: [...BLANK_MODES], description: 'not_specified when a blank or "N/A" only means nothing is printed there (the usual case with max tiers); not_offered when the document says the combination is not offered, and in classic grids of ranges and bands.' },
                ambiguous: { type: 'boolean', description: 'true when you cannot tell how to read the loan amounts or credit scores: tiers that look like ranges but are not labeled as ranges, a note like "use the lower of", rows that contradict each other.' },
                ambiguous_reason: { type: 'string', description: 'One sentence on what is unclear. Empty when ambiguous is false.' },
                row_list: {
                    type: 'object',
                    description: 'Only for a row-list matrix (each row: a loan amount, a credit score and a max LTV per purpose): the rows exactly as printed. Then leave rows, columns and values as empty lists and printed_rows and printed_columns 0; the grid is built from this. For a classic grid, both lists here are empty.',
                    properties: {
                      value_columns: {
                        type: 'array',
                        description: 'The limit columns, left to right (e.g. "Purchase / R&T", "Cash-out").',
                        items: { type: 'object', properties: { label: { type: 'string' }, purposes: { type: 'array', items: { type: 'string', enum: [...PURPOSES] }, description: 'The purposes this column is for; empty if it is for all of the grid\'s purposes.' } }, required: ['label', 'purposes'], additionalProperties: false },
                      },
                      rows: {
                        type: 'array',
                        description: 'One entry per printed loan amount and credit score, top to bottom. A printed row "$1,500,000 | 700 / 660 | 80 / 75 | 75 / 70" is two entries: 1500000 at 700 (80, 75) and 1500000 at 660 (75, 70).',
                        items: {
                          type: 'object',
                          properties: {
                            loan_amount_max: { type: 'number', description: 'The maximum loan amount printed on the row, in dollars; 0 if the row prints none.' },
                            fico_min: { type: 'integer', description: 'The minimum credit score printed on the row.' },
                            values: { type: 'array', items: nullable({ type: 'number' }), description: 'One limit per value column, as a percent; null for a blank.' },
                            notes: { type: 'string', description: 'Anything else printed on the row. Empty if none.' },
                          },
                          required: ['loan_amount_max', 'fico_min', 'values', 'notes'],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ['value_columns', 'rows'],
                    additionalProperties: false,
                },
              },
              required: ['page', 'title', 'ratio', 'occupancy', 'property_types', 'purposes', 'doc_types', 'units_min', 'units_max', 'dscr_min', 'rows', 'columns', 'values', 'printed_rows', 'printed_columns', 'notes', 'loan_amounts', 'credit_scores', 'blank_cells', 'ambiguous', 'ambiguous_reason', 'row_list'],
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
                applies_loan_amount_below: { type: 'number', description: 'Only when the loan amount is below this many dollars; 0 when the rule does not depend on the loan amount. "Loan amounts < $150,000 max 70% LTV" is field ltv, op <=, number 70, applies_loan_amount_below 150000.' },
                applies_states: { type: 'array', items: { type: 'string' }, description: 'Only in these states (two-letter codes); empty for all states.' },
                applies_property_types: { type: 'array', items: { type: 'string', enum: [...PROPERTY_TYPES] }, description: 'Only for these property types; empty for all. "Florida condos max 75%" is field ltv, op <=, number 75, applies_states ["FL"], applies_property_types ["condo"].' },
                severity: { type: 'string', enum: ['hard', 'verify'], description: 'hard = rules the program out; verify = something to check (e.g. "per AUS").' },
                message: { type: 'string', description: 'Plain English, e.g. "Max DTI 50%".' },
                page: { type: 'integer' },
                quote: { type: 'string', description: 'The words on the page, copied exactly.' },
              },
              required: ['field', 'op', 'number', 'list', 'min', 'max', 'applies_purposes', 'applies_occupancies', 'applies_ltv_above', 'applies_loan_amount_below', 'applies_states', 'applies_property_types', 'severity', 'message', 'page', 'quote'],
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
- Rows for borrowers with no credit score ("No FICO", "No score") are not credit bands: leave them out of rows and describe them in notes.
- A grid for rural properties ("SFR Rural") uses property type rural; a condotel grid uses condotel; a grid for 5-8 or 5-9 unit buildings uses five_plus with units_min 5 and units_max as printed.
- Credit bands: "720-739" is 720 to 739; "740+" or "≥740" is 740 to 850; "<620" is 300 to 619.
- Loan amounts in dollars: "$1,000,001 - $1.5MM" is 1000001 to 1500000; "≤ $1MM" is 0 to 1000000.
- DSCR matrices often print one grid per DSCR level ("DSCR >= 1.00", "0.75 - 0.99", "No ratio / < 0.75"): give each grid its dscr_min (1, 0.75, 0). If DSCR levels are columns, split them into one grid per level.
- Loan amounts printed as plain amounts or "≤ $X" ("$500,000 | $1,000,000 | $1,500,000", "≤ $750K | ≤ $1MM | ≤ $1.5MM", a "Max Loan Amount" column) are maximums: loan_amounts is max_tiers and every tier runs from 0 to its amount (0 to 750000, 0 to 1000000, 0 to 1500000). A larger tier also covers smaller loans. Never start a tier one dollar above the tier before. The program's minimum loan amount is a rule (field loan_amount, op >=), not a tier.
- Only ranges the lender prints as ranges ("$500,001 - $1MM", "$1MM+ to $1.5MM", "> $1,500,000") are explicit_ranges, read as printed.
- A row list (each row gives a loan amount, a credit score and a max LTV for each purpose, often DSCR and other Non-QM matrices) goes in row_list exactly as printed, one entry per loan amount and credit score, with loan_amounts max_tiers and credit_scores minimums. The credit score on a row is a minimum: 700 means 700 to 850. Never turn a row list into credit bands (never 700-719), never fill in a score or loan amount the row does not print, and leave rows, columns and values empty.
- In a classic grid, rows printed as ranges ("700 - 719") are credit_scores bands; rows printed as single scores or "700+" stacked one under the other are minimums.
- A blank or "N/A" where loan amounts are maximums means nothing is printed there (blank_cells not_specified) unless the document says the combination is not offered. In a grid of printed ranges and bands, a blank is not_offered.
- Set ambiguous to true, with ambiguous_reason, when the structure is unclear: loan amounts that look like ranges but are not labeled as ranges, a note like "use the lower of", or rows that contradict each other. Still give your best reading.
- A limit that depends on the loan amount, the state or the property type and is printed as a note ("loan amounts < $150,000 max 70% LTV", "Florida condos max 75% LTV") is a rule with field ltv (or cltv), op <=, and applies_loan_amount_below, applies_states or applies_property_types.
- Use only the words in the schema's lists. If the lender uses another name, pick the matching one; if none fits, leave it out and say so in notes.
- A program is a loan product ("Conventional", "FHA", "Equity Advantage HELOC"), not a term: list its terms in term_options. Split a product into two programs only when the lender prints separate grids or rules for them.
- If the document is a guideline with no grids, still return each program it covers with its terms, doc types, purposes, rules and description, and an empty grids list.
- Some matrices list "special circumstances" (cash-out, manufactured home, second home, investment, manual underwrite, streamline) each with a credit score and max LTV instead of a grid. Turn each into cells on the matching column dimension: a purpose (cash-out, rate/term), a property type (manufactured, condo), an occupancy (second home, investment) or units. The row with no circumstance covers everything else.
- Apart from maximum loan tiers and minimum scores (which overlap on purpose), never return two cells that cover the same occupancy, property type, purpose, income type, units, credit band and loan amount with different limits. Where circumstances overlap ("when multiple circumstances apply the lowest LTV is used"), put the lowest limit in the overlapping cell.
- A circumstance that is really another product (FHA Streamline, Simple Refinance, VA IRRRL, 203(k)) is a separate program with its own grid. A circumstance with no matching dimension (manual underwrite, non-occupant co-borrower, high balance) goes in rules (e.g. field ltv, op <=) with its quote, not in cells.
- A limit that is higher only for first-time buyers (e.g. 97% first-time buyer, 95% otherwise): put the higher limit in the cell and add a rule field first_time_buyer, op required, applies_ltv_above = the limit for everyone else (95), message "Above 95% LTV, first-time buyers only". Do the same for any "higher LTV only if" condition the rule fields can express.
- Rule values: states as two-letter codes (TX); "all states" means no state rule. Citizenship as us_citizen, permanent_resident, non_permanent_resident, itin, foreign_national.
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

/** A DSCR from 0 to 5 ("1.25" or 1.25), else null. */
const dscrOf = (v: unknown) => {
  const n = numOrNull(v)
  return n != null && n >= 0 && n <= 5 ? n : null
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
    dscrMin: dscrOf(g.dscr_min),
    rows,
    columns,
    values,
    printedRows: int(g.printed_rows) ?? rows.length,
    printedColumns: int(g.printed_columns) ?? columns.length,
    notes: str(g.notes) || null,
    ...(pick(LOAN_AMOUNT_MODES, g.loan_amounts) && { loanAmounts: pick(LOAN_AMOUNT_MODES, g.loan_amounts)! }),
    ...(pick(CREDIT_MODES, g.credit_scores) && { creditScores: pick(CREDIT_MODES, g.credit_scores)! }),
    ...(pick(BLANK_MODES, g.blank_cells) && { blankCells: pick(BLANK_MODES, g.blank_cells)! }),
    ...(g.ambiguous === true && { ambiguous: true, ambiguousReason: str(g.ambiguous_reason) || null }),
    ...rowList(g, where, dropped),
  }
}

/** A row-list matrix: the rows as printed, and the grid generated from them (maximum loan tiers, minimum scores). */
function rowList(g: Record<string, unknown>, where: string, dropped: string[]): Partial<ReadGrid> {
  const list = g.row_list
  if (!isObject(list) || !Array.isArray(list.rows) || !Array.isArray(list.value_columns)) return {}
  const columns = list.value_columns.filter(isObject).map((c) => ({ label: str(c.label), purposes: Array.isArray(c.purposes) && c.purposes.length ? pickAll(PURPOSES, c.purposes, dropped, `${where} column purpose`) : null }))
  const rows = list.rows.filter(isObject).flatMap((r): PrintedRow[] => {
    const ficoMin = int(r.fico_min)
    if (ficoMin == null) {
      dropped.push(`${where}: a row with no credit score`)
      return []
    }
    const values = Array.isArray(r.values) ? r.values.map((v) => numOrNull(v)) : []
    // 0 (or nothing) on the row means the lender printed no maximum.
    const max = numOrNull(r.loan_amount_max)
    return [{ loanAmountMax: max != null && max > 0 ? max : null, ficoMin, values: columns.map((_, i) => values[i] ?? null), notes: str(r.notes) || null }]
  })
  if (rows.length === 0 || columns.length === 0) return {}
  const asPrinted: PrintedRows = { columns, rows }
  const built = gridFromPrintedRows(asPrinted)
  // Two printed rows for the same loan amount and score can't both be right: Connor confirms.
  const twice = rows.length !== new Set(rows.map((r) => `${r.loanAmountMax}|${r.ficoMin}`)).size
  return {
    asPrinted,
    ...built,
    printedRows: built.rows.length,
    printedColumns: built.columns.length,
    loanAmounts: 'max_tiers',
    creditScores: 'minimums',
    blankCells: pick(BLANK_MODES, g.blank_cells) ?? 'not_specified',
    ...(twice && { ambiguous: true, ambiguousReason: 'Two rows are printed for the same loan amount and credit score.' }),
  }
}

const dollars = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/**
 * The grid a row-list matrix generates: one row per minimum score (highest first), one column per value column
 * and maximum loan amount (each from $0 up to its amount), and a blank wherever the lender printed no row.
 */
export function gridFromPrintedRows(p: PrintedRows): Pick<ReadGrid, 'rows' | 'columns' | 'values'> {
  const scores = [...new Set(p.rows.map((r) => r.ficoMin))].sort((a, b) => b - a)
  const maxes = [...new Set(p.rows.map((r) => r.loanAmountMax))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity))
  const tier = (max: number | null) => (max == null ? 'Any amount' : `≤ ${dollars(max)}`)
  return {
    rows: scores.map((s) => ({ label: `${s}+`, ficoMin: s, ficoMax: 850 })),
    columns: p.columns.flatMap((vc) => maxes.map((max): GridColumn => ({ label: p.columns.length > 1 && vc.label ? `${vc.label} ${tier(max)}` : tier(max), loanAmountMin: 0, loanAmountMax: max, occupancy: null, unitsMin: null, unitsMax: null, purposes: vc.purposes, propertyTypes: null }))),
    values: scores.map((s) => p.columns.flatMap((_, vi) => maxes.map((max) => p.rows.find((r) => r.ficoMin === s && r.loanAmountMax === max)?.values[vi] ?? null))),
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
  const loanBelow = numOrNull(r.applies_loan_amount_below)
  const states = Array.isArray(r.applies_states) ? [...new Set(r.applies_states.map((x) => str(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)))] : []
  const propertyTypes = Array.isArray(r.applies_property_types) ? pickAll(PROPERTY_TYPES, r.applies_property_types, dropped, `${program} rule property type`) : []
  const when = { ...(purposes.length && { purposes }), ...(occupancies.length && { occupancies }), ...(ltvAbove != null && { ltv_above: ltvAbove }), ...(loanBelow != null && loanBelow > 0 && { loan_amount_below: loanBelow }), ...(states.length && { states }), ...(propertyTypes.length && { property_types: propertyTypes }) }
  const appliesWhen = Object.keys(when).length ? when : null
  const rule: ReadRule = { field, op, value, appliesWhen, severity: r.severity === 'verify' ? 'verify' : 'hard', message: str(r.message) || `${field} ${op}`, page: int(r.page) && int(r.page)! > 0 ? int(r.page) : null, quote: str(r.quote) }
  const clean = cleanRule(rule)
  if (!clean) dropped.push(`${program} rule with no usable value (e.g. "all states"): "${rule.message}"`)
  return clean
}

export const CITIZENSHIP_CODES = ['us_citizen', 'permanent_resident', 'non_permanent_resident', 'itin', 'foreign_national'] as const

/**
 * Puts a rule's values in the words the search compares against: two-letter
 * states ("all states" means no rule at all) and citizenship codes ("US
 * Citizen" → us_citizen). Null when nothing usable is left (the rule is dropped).
 */
export function cleanRule(r: ReadRule): ReadRule | null {
  if ((r.op !== 'in' && r.op !== 'not_in') || !Array.isArray(r.value)) return r
  const values = r.value.map((v) => String(v).trim())
  if (r.field === 'state') {
    if (r.op === 'in' && values.some((v) => /\ball\b|nationwide|united states|\bu\.?s\.?\b|50 states/i.test(v) && !/^[A-Z]{2}$/.test(v))) return null
    const codes = [...new Set(values.filter((v) => /^[a-z]{2}$/i.test(v)).map((v) => v.toUpperCase()))]
    return codes.length ? { ...r, value: codes } : null
  }
  if (r.field === 'citizenship') {
    const code = (v: string): (typeof CITIZENSHIP_CODES)[number] | null => {
      const t = v.toLowerCase()
      if ((CITIZENSHIP_CODES as readonly string[]).includes(t)) return t as (typeof CITIZENSHIP_CODES)[number]
      if (/itin/.test(t)) return 'itin'
      if (/foreign/.test(t)) return 'foreign_national'
      if (/permanent|resident|green/.test(t)) return /non[- ]?perm|temporary|non[- ]?resident/.test(t) ? 'non_permanent_resident' : 'permanent_resident'
      if (/citizen/.test(t)) return 'us_citizen'
      return null
    }
    const codes = [...new Set(values.map(code).filter((c): c is (typeof CITIZENSHIP_CODES)[number] => c != null))]
    return codes.length ? { ...r, value: codes } : null
  }
  return r
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
