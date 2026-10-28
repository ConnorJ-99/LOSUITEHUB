// Matrices typed or pasted by hand (no AI): reading credit bands, loan amount
// columns and pasted blocks from Excel, editing a grid's shape, and turning
// common program rules into the same rule rows the assistant produces. Pure.

import type { GridColumn, GridRow, ReadGrid, ReadProgram, ReadRule } from '../../../supabase/functions/assistant/matrix'
import { formatCurrency, formatNumber } from '@/lib/format'
import { parseSquare } from './matrixImport'
import { CITIZENSHIPS, MATRIX_PURPOSES, type Citizenship, type DocType, type Lien, type MatrixPropertyType, type MatrixPurpose } from './taxonomy'

type Occupancy = ReadGrid['occupancy']

// ---------------------------------------------------------------------------
// Credit score bands (rows)
// ---------------------------------------------------------------------------

export const bandLabel = (min: number, max: number) => (max >= 850 ? `${min}+` : `${min}–${max}`)

/**
 * A credit band as printed: "760+", "740-759", "740 to 759", "≥ 760", "<620",
 * or a bare "760" (its top is filled in from the band above by closeBands).
 */
export function parseBand(text: string): { ficoMin: number; ficoMax: number | null } | null {
  const t = text.trim().toLowerCase().replace(/fico|score|credit|and|&/g, ' ').replace(/\s+/g, ' ').trim()
  let m = t.match(/^(\d{3})\s*(?:-|–|—|to)\s*(\d{3})$/)
  if (m) return valid(Number(m[1]), Number(m[2]))
  m = t.match(/^(?:≥|>=)\s*(\d{3})$/) ?? t.match(/^(\d{3})\s*(?:\+|above|up|or (?:more|higher|above))$/)
  if (m) return valid(Number(m[1]), 850)
  m = t.match(/^(?:<|under|below)\s*(\d{3})$/)
  if (m) return valid(300, Number(m[1]) - 1)
  m = t.match(/^(?:≤|<=)\s*(\d{3})$/)
  if (m) return valid(300, Number(m[1]))
  m = t.match(/^(\d{3})$/)
  if (m) return Number(m[1]) >= 300 && Number(m[1]) <= 850 ? { ficoMin: Number(m[1]), ficoMax: null } : null
  return null
}

function valid(min: number, max: number) {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo >= 300 && hi <= 850 ? { ficoMin: lo, ficoMax: hi } : null
}

/** Bare minimums ("760", "740", ...) get their top from the next band up; the highest goes to 850. */
export function closeBands(bands: { ficoMin: number; ficoMax: number | null }[]): { ficoMin: number; ficoMax: number }[] {
  return bands.map((b) => {
    if (b.ficoMax != null) return { ficoMin: b.ficoMin, ficoMax: b.ficoMax }
    const above = bands.filter((o) => o.ficoMin > b.ficoMin).map((o) => o.ficoMin)
    return { ficoMin: b.ficoMin, ficoMax: above.length ? Math.min(...above) - 1 : 850 }
  })
}

const toRow = (b: { ficoMin: number; ficoMax: number }): GridRow => ({ label: bandLabel(b.ficoMin, b.ficoMax), ficoMin: b.ficoMin, ficoMax: b.ficoMax })

/** The usual bands, 760+ down to 620–639. */
export const STARTER_ROWS: GridRow[] = [760, 740, 720, 700, 680, 660, 640, 620].map((min) => toRow({ ficoMin: min, ficoMax: min === 760 ? 850 : min + 19 }))

// ---------------------------------------------------------------------------
// Loan amount columns
// ---------------------------------------------------------------------------

export function tierLabel(min: number, max: number | null): string {
  if (max == null) return min > 0 ? `Over ${formatCurrency(min - 1)}` : 'Any amount'
  return min > 0 ? `${formatCurrency(min)}–${formatCurrency(max)}` : `≤${formatCurrency(max)}`
}

/** "$150,000", "150k", "1.5M" → dollars. */
function money(text: string): number | null {
  const m = text.replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)(k|m|mm)?$/i)
  if (!m) return null
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000) : 1)
  return Math.round(n)
}

const OCCUPANCY_WORDS: [RegExp, Occupancy][] = [
  [/second\s*home|2nd\s*home/i, 'second_home'],
  [/invest(?:ment|or)?|\bnoo\b|non[-\s]?owner/i, 'investment'],
  [/primary|owner[-\s]?occ(?:upied)?|\boo\b/i, 'primary'],
]
const PURPOSE_WORDS: [RegExp, MatrixPurpose[]][] = [
  [/purch(?:ase)?\s*(?:\/|&|and|,)\s*(?:r\s*[/&]?\s*t\b|rate[-\s/]*(?:and|&)?\s*term|rate\/term)/i, ['purchase', 'rate_term']],
  [/cash[-\s]?out|\bc\/?o\b/i, ['cash_out']],
  [/rate[-\s/]*(?:and|&)?\s*term|\br\s*\/?\s*&?\s*t\b|no[-\s]cash/i, ['rate_term']],
  [/purch(?:ase)?/i, ['purchase']],
]

/**
 * A column header: a loan amount tier ("≤$150,000", "$150,001 - $250,000",
 * "1.5M+", "> $1,000,000", "Any"), optionally with an occupancy or purpose
 * ("Primary", "Investment", "Cash-Out ≤ $1M"). Null if nothing could be read.
 */
export function parseColumn(text: string): Omit<GridColumn, 'label' | 'unitsMin' | 'unitsMax' | 'propertyTypes'> | null {
  let t = text.trim()
  let occupancy: Occupancy | null = null
  let purposes: MatrixPurpose[] | null = null
  for (const [re, o] of OCCUPANCY_WORDS)
    if (re.test(t)) {
      occupancy = o
      t = t.replace(re, ' ')
      break
    }
  for (const [re, p] of PURPOSE_WORDS)
    if (re.test(t)) {
      purposes = p
      t = t.replace(re, ' ')
      break
    }
  t = t.replace(/loan\s*amount|amount|loans?|max|tier/gi, ' ').replace(/[()·:]/g, ' ').replace(/\s+/g, ' ').trim()
  const tier = parseTier(t)
  if (tier) return { ...tier, occupancy, purposes }
  if (t === '' && (occupancy || purposes)) return { loanAmountMin: 0, loanAmountMax: null, occupancy, purposes }
  return null
}

function parseTier(t: string): { loanAmountMin: number; loanAmountMax: number | null } | null {
  if (t === '' ) return null
  if (/^(any|all)(\s+amounts?)?$/i.test(t)) return { loanAmountMin: 0, loanAmountMax: null }
  let m = t.match(/^(?:≤|<=|up to|to|max(?:imum)?)\s*(.+)$/i)
  if (m) return money(m[1]) != null ? { loanAmountMin: 0, loanAmountMax: money(m[1]) } : null
  m = t.match(/^(?:<|under|below|less than)\s*(.+)$/i)
  if (m) return money(m[1]) != null ? { loanAmountMin: 0, loanAmountMax: money(m[1])! - 1 } : null
  m = t.match(/^(?:>|over|above|more than)\s*(.+)$/i)
  if (m) return money(m[1]) != null ? { loanAmountMin: money(m[1])! + 1, loanAmountMax: null } : null
  m = t.match(/^(?:≥|>=)\s*(.+)$/i) ?? t.match(/^(.+?)\s*(?:\+|and (?:up|above)|or more)$/i)
  if (m) return money(m[1]) != null ? { loanAmountMin: money(m[1])!, loanAmountMax: null } : null
  m = t.match(/^(.+?)\s*(?:-|–|—|to)\s*(.+)$/i)
  if (m) {
    const a = money(m[1])
    const b = money(m[2])
    return a != null && b != null && b >= a ? { loanAmountMin: a, loanAmountMax: b } : null
  }
  return null
}

/** Tiers printed as "$0–$1,000,000" then "$1,000,000–$1,500,000" share a boundary: the higher one starts a dollar later. */
export function closeTiers<T extends { loanAmountMin: number; loanAmountMax: number | null }>(cols: T[]): T[] {
  return cols.map((c) => {
    const touching = cols.some((o) => o !== c && o.loanAmountMax != null && o.loanAmountMax === c.loanAmountMin && o.loanAmountMin < c.loanAmountMin)
    return touching ? { ...c, loanAmountMin: c.loanAmountMin + 1 } : c
  })
}

const toColumn = (label: string, c: NonNullable<ReturnType<typeof parseColumn>>): GridColumn => ({ label, ...c, unitsMin: null, unitsMax: null, propertyTypes: null })

// ---------------------------------------------------------------------------
// Pasting a block from Excel (or a PDF)
// ---------------------------------------------------------------------------

export interface Paste {
  /** Read from the first row when it holds loan amounts (or occupancies / purposes). */
  columns: GridColumn[] | null
  /** Read from the first column when it holds credit bands. */
  rows: GridRow[] | null
  values: (number | null)[][]
  problems: string[]
}

function splitLines(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  const tabbed = lines.some((l) => l.includes('\t'))
  return lines.map((l) => {
    if (tabbed) return l.split('\t').map((s) => s.trim())
    // Copied from a PDF: columns are separated by spaces. Keep "740 - 759" and "$150,001 - $250,000" together.
    const joined = l.trim().replace(/\s*(-|–|—)\s*/g, '$1').replace(/\$\s+/g, '$')
    return joined.split(/\s{2,}|\s+/).filter(Boolean)
  })
}

/** Reads a copied block: an optional header row of loan amounts, an optional first column of credit bands, and the limits. */
export function parsePaste(text: string): Paste {
  const grid = splitLines(text)
  const problems: string[] = []
  if (grid.length === 0) return { columns: null, rows: null, values: [], problems: ['Nothing to paste.'] }

  const isBandColumn = grid.length > 0 && grid.every((r, i) => (i === 0 && !parseBand(r[0] ?? '')) || parseBand(r[0] ?? '') != null) && grid.some((r) => parseBand(r[0] ?? '') != null)
  const head = grid[0]
  const headCells = isBandColumn ? head.slice(1) : head
  const headColumns = headCells.map((c) => parseColumn(c))
  const hasHeader = headCells.length > 0 && headColumns.every((c) => c != null) && headCells.some((c) => parseSquare(c) === 'invalid')
  const body = hasHeader || (isBandColumn && parseBand(head[0] ?? '') == null) ? grid.slice(1) : grid

  const columns = hasHeader ? closeTiers(headCells.map((label, i) => toColumn(label, headColumns[i]!))) : null
  const rows = isBandColumn ? closeBands(body.map((r) => parseBand(r[0])!)).map(toRow) : null
  const width = columns?.length ?? Math.max(0, ...body.map((r) => r.length - (isBandColumn ? 1 : 0)))
  const values = body.map((r, ri) => {
    const cells = isBandColumn ? r.slice(1) : r
    return Array.from({ length: width }, (_, ci) => {
      const v = parseSquare(cells[ci] ?? '')
      if (v === 'invalid') {
        problems.push(`Row ${ri + 1}, column ${ci + 1}: "${cells[ci]}" isn't a percent.`)
        return null
      }
      return v
    })
  })
  return { columns, rows, values, problems }
}

/**
 * Puts a pasted block into a grid. With headers it replaces the grid's rows
 * and columns; numbers alone fill the grid from the square clicked.
 */
export function applyPaste(g: ReadGrid, p: Paste, at: { row: number; col: number } = { row: 0, col: 0 }): ReadGrid | { error: string } {
  if (p.problems.length) return { error: `Nothing was pasted. ${p.problems.slice(0, 3).join(' ')}${p.problems.length > 3 ? ` (and ${p.problems.length - 3} more)` : ''}` }
  if (p.values.length === 0) return { error: 'Nothing to paste.' }
  const width = p.values[0].length
  if (p.rows || p.columns) {
    const rows = p.rows ?? g.rows
    const columns = p.columns ?? g.columns
    if (rows.length !== p.values.length) return { error: `The paste has ${p.values.length} rows of numbers but the grid has ${rows.length} credit bands. Copy the credit scores too, or add rows first.` }
    if (columns.length !== width) return { error: `The paste has ${width} columns of numbers but the grid has ${columns.length} loan amount columns. Copy the header row too, or add columns first.` }
    return withCounts({ ...g, rows, columns, values: p.values.map((r) => [...r]) })
  }
  if (at.row + p.values.length > g.rows.length || at.col + width > g.columns.length)
    return { error: `The paste is ${p.values.length} × ${width}, but from that square the grid only has room for ${g.rows.length - at.row} × ${g.columns.length - at.col}. Add rows or columns, or copy the headers too.` }
  const values = g.values.map((r, ri) => r.map((v, ci) => (ri >= at.row && ri < at.row + p.values.length && ci >= at.col && ci < at.col + width ? p.values[ri - at.row][ci - at.col] : v)))
  return withCounts({ ...g, values })
}

// ---------------------------------------------------------------------------
// Grid and program shape
// ---------------------------------------------------------------------------

/** A typed grid is always complete, so its printed size is its size. */
export const withCounts = (g: ReadGrid): ReadGrid => ({ ...g, printedRows: g.rows.length, printedColumns: g.columns.length })

/** Single-unit types are 1 unit; 2–4 units alone is 2–4; a mix is 1–4. */
export function unitsFor(types: MatrixPropertyType[]): { unitsMin: number; unitsMax: number } {
  if (types.length === 1 && types[0] === 'two_to_four') return { unitsMin: 2, unitsMax: 4 }
  return types.includes('two_to_four') ? { unitsMin: 1, unitsMax: 4 } : { unitsMin: 1, unitsMax: 1 }
}

export const ratioFor = (lien: Lien): ReadGrid['ratio'] => (lien === 'first' ? 'ltv' : 'cltv')

export function blankGrid(p: Pick<ReadProgram, 'lien' | 'purposes' | 'docTypes'>, title = 'Primary'): ReadGrid {
  const columns: GridColumn[] = [toColumn('≤$1,000,000', { loanAmountMin: 0, loanAmountMax: 1_000_000, occupancy: null, purposes: null })]
  return withCounts({
    page: 0,
    title,
    ratio: ratioFor(p.lien),
    occupancy: 'primary',
    propertyTypes: ['sfr_pud'],
    purposes: p.purposes.length ? [...p.purposes] : [...MATRIX_PURPOSES.values],
    docType: (p.docTypes[0] ?? 'full_doc') as DocType,
    ...unitsFor(['sfr_pud']),
    rows: STARTER_ROWS.map((r) => ({ ...r })),
    columns,
    values: STARTER_ROWS.map(() => columns.map(() => null)),
    printedRows: 0,
    printedColumns: 0,
    notes: null,
  })
}

export function blankProgram(name = ''): ReadProgram {
  const p: ReadProgram = { name, family: 'conventional', lien: 'first', docTypes: ['full_doc'], features: [], purposes: ['purchase', 'rate_term', 'cash_out'], termsMonths: [360], loanAmountBasis: 'this_lien', description: null, grids: [], rules: [] }
  return { ...p, grids: [blankGrid(p)] }
}

/**
 * Keeps grids inside what the program offers: a purpose the program dropped
 * leaves its grids (all of them if none would be left), and a grid on a doc
 * type the program dropped moves to the program's first doc type.
 */
export function syncGrids<P extends Pick<ReadProgram, 'purposes' | 'docTypes' | 'grids'>>(p: P): P {
  return {
    ...p,
    grids: p.grids.map((g) => {
      const kept = g.purposes.filter((x) => p.purposes.includes(x))
      return { ...g, purposes: kept.length ? kept : [...p.purposes], docType: p.docTypes.includes(g.docType) || !p.docTypes.length ? g.docType : p.docTypes[0] }
    }),
  }
}

/** A copy to start the next grid from (e.g. Second Home from Primary). */
export const copyGrid = (g: ReadGrid): ReadGrid => ({ ...g, title: `${g.title || 'Grid'} (copy)`, rows: g.rows.map((r) => ({ ...r })), columns: g.columns.map((c) => ({ ...c })), values: g.values.map((r) => [...r]) })

/** Adds the next band down (20 points wide, never below 300). */
export function addRow(g: ReadGrid): ReadGrid {
  const lowest = Math.min(...g.rows.map((r) => r.ficoMin), 850)
  const min = Math.max(300, lowest - 20)
  const row = toRow({ ficoMin: min, ficoMax: Math.max(min, lowest - 1) })
  return withCounts({ ...g, rows: [...g.rows, row], values: [...g.values, g.columns.map(() => null)] })
}

/** Adds the next loan amount tier after the largest one. */
export function addColumn(g: ReadGrid): ReadGrid {
  const top = Math.max(0, ...g.columns.map((c) => c.loanAmountMax ?? c.loanAmountMin))
  const col = toColumn(tierLabel(top + 1, top + 500_000), { loanAmountMin: top + 1, loanAmountMax: top + 500_000, occupancy: null, purposes: null })
  return withCounts({ ...g, columns: [...g.columns, col], values: g.values.map((r) => [...r, null]) })
}

export const removeRow = (g: ReadGrid, i: number): ReadGrid => withCounts({ ...g, rows: g.rows.filter((_, j) => j !== i), values: g.values.filter((_, j) => j !== i) })
export const removeColumn = (g: ReadGrid, i: number): ReadGrid => withCounts({ ...g, columns: g.columns.filter((_, j) => j !== i), values: g.values.map((r) => r.filter((_, j) => j !== i)) })

/** Renames a row from its typed band ("700-719"); an unreadable band is an error and changes nothing. */
export function setRowBand(g: ReadGrid, i: number, text: string): ReadGrid | { error: string } {
  const b = parseBand(text)
  if (!b) return { error: `"${text}" isn't a credit band. Use something like 700-719 or 760+.` }
  const [closed] = closeBands([b, ...g.rows.filter((_, j) => j !== i).map((r) => ({ ficoMin: r.ficoMin, ficoMax: r.ficoMax }))])
  return withCounts({ ...g, rows: g.rows.map((r, j) => (j === i ? toRow(closed) : r)) })
}

/** Renames a column from its typed header ("$150,001-$250,000", "Investment", "Cash-Out ≤1M"). */
export function setColumnHeader(g: ReadGrid, i: number, text: string): ReadGrid | { error: string } {
  const c = parseColumn(text)
  if (!c) return { error: `"${text}" isn't a loan amount. Use something like ≤$150,000, $150,001-$250,000, 1.5M+ or Any.` }
  const label = text.trim()
  return withCounts({ ...g, columns: g.columns.map((col, j) => (j === i ? { ...col, ...c, label } : col)) })
}

// ---------------------------------------------------------------------------
// Program rules typed by hand
// ---------------------------------------------------------------------------

export type RulePresetId = 'max_dti' | 'min_reserves' | 'max_lates_12' | 'max_lates_24' | 'bk_seasoning' | 'fc_seasoning' | 'min_fico' | 'loan_amount' | 'min_dscr' | 'self_employed' | 'states' | 'citizenship'

export interface RulePreset {
  id: RulePresetId
  label: string
  field: ReadRule['field']
  op: ReadRule['op']
  input: 'number' | 'range' | 'states' | 'citizenship'
  unit?: string
}

export const RULE_PRESETS: RulePreset[] = [
  { id: 'max_dti', label: 'Max DTI', field: 'dti', op: '<=', input: 'number', unit: '%' },
  { id: 'min_reserves', label: 'Min reserves', field: 'reserves_months', op: '>=', input: 'number', unit: 'months' },
  { id: 'max_lates_12', label: 'Max 30-day mortgage lates, last 12 months', field: 'mortgage_lates_12', op: '<=', input: 'number' },
  { id: 'max_lates_24', label: 'Max 30-day mortgage lates, last 24 months', field: 'mortgage_lates_24', op: '<=', input: 'number' },
  { id: 'bk_seasoning', label: 'Bankruptcy seasoning', field: 'bk_seasoning_months', op: '>=', input: 'number', unit: 'months' },
  { id: 'fc_seasoning', label: 'Foreclosure / short sale seasoning', field: 'fc_seasoning_months', op: '>=', input: 'number', unit: 'months' },
  { id: 'min_fico', label: 'Min credit score', field: 'fico', op: '>=', input: 'number' },
  { id: 'loan_amount', label: 'Loan amount range', field: 'loan_amount', op: 'between', input: 'range' },
  { id: 'min_dscr', label: 'Min DSCR', field: 'dscr', op: '>=', input: 'number' },
  { id: 'self_employed', label: 'Years self-employed', field: 'self_employed_years', op: '>=', input: 'number', unit: 'years' },
  { id: 'states', label: 'States allowed', field: 'state', op: 'in', input: 'states' },
  { id: 'citizenship', label: 'Citizenship allowed', field: 'citizenship', op: 'in', input: 'citizenship' },
]

export interface RuleInput {
  preset: RulePresetId
  number?: number | null
  min?: number | null
  max?: number | null
  /** States as typed ("TX, OK") or citizenship values. */
  list?: string[]
  severity?: ReadRule['severity']
  page?: number | null
  /** Only for these purposes (e.g. cash-out); empty = always. */
  purposes?: MatrixPurpose[]
}

const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`

/** Builds a rule (with its plain-English message) from the form; an error explains what's missing. */
export function ruleFromInput(input: RuleInput): ReadRule | { error: string } {
  const preset = RULE_PRESETS.find((r) => r.id === input.preset)
  if (!preset) return { error: 'Pick a rule.' }
  let value: ReadRule['value']
  let message: string
  const n = input.number
  if (preset.input === 'number') {
    if (n == null || !Number.isFinite(n) || n < 0) return { error: `Enter a number for ${preset.label.toLowerCase()}.` }
    if (preset.field === 'dti' && (n <= 0 || n > 100)) return { error: 'Max DTI is a percent between 1 and 100.' }
    if (preset.field === 'fico' && (n < 300 || n > 850)) return { error: 'A credit score is between 300 and 850.' }
    value = n
    message = {
      max_dti: `Max DTI ${formatNumber(n)}%`,
      min_reserves: `Min ${plural(n, 'month')} reserves`,
      max_lates_12: n === 0 ? 'No 30-day mortgage lates in the last 12 months' : `Max ${plural(n, '30-day mortgage late')} in the last 12 months`,
      max_lates_24: n === 0 ? 'No 30-day mortgage lates in the last 24 months' : `Max ${plural(n, '30-day mortgage late')} in the last 24 months`,
      bk_seasoning: `Bankruptcy seasoned ${plural(n, 'month')}`,
      fc_seasoning: `Foreclosure / short sale seasoned ${plural(n, 'month')}`,
      min_fico: `Min credit score ${formatNumber(n, 0)}`,
      min_dscr: `Min DSCR ${n.toFixed(2)}`,
      self_employed: `Self-employed ${plural(n, 'year')}`,
    }[preset.id as Exclude<RulePresetId, 'loan_amount' | 'states' | 'citizenship'>]
  } else if (preset.input === 'range') {
    const min = input.min ?? 0
    const max = input.max ?? null
    if (min < 0 || (max != null && max < min) || (input.min == null && max == null)) return { error: 'Enter a minimum, a maximum, or both.' }
    value = { min, max: max ?? 999_999_999 }
    message = max == null ? `Loan amount at least ${formatCurrency(min)}` : min > 0 ? `Loan amount ${formatCurrency(min)}–${formatCurrency(max)}` : `Loan amount up to ${formatCurrency(max)}`
  } else if (preset.input === 'states') {
    const states = [...new Set((input.list ?? []).flatMap((s) => s.split(/[\s,;]+/)).map((s) => s.trim().toUpperCase()).filter(Boolean))]
    if (!states.length) return { error: 'Enter at least one state, like TX.' }
    const bad = states.filter((s) => !/^[A-Z]{2}$/.test(s))
    if (bad.length) return { error: `Use two-letter state codes (not ${bad.join(', ')}).` }
    value = states
    message = `States: ${states.join(', ')}`
  } else {
    const list = (input.list ?? []).filter((c): c is Citizenship => (CITIZENSHIPS.values as readonly string[]).includes(c))
    if (!list.length) return { error: 'Pick at least one citizenship.' }
    value = list
    message = `Citizenship: ${list.map((c) => CITIZENSHIPS.label[c]).join(', ')}`
  }
  const purposes = input.purposes?.length && input.purposes.length < MATRIX_PURPOSES.values.length ? input.purposes : null
  if (purposes) message += ` (${purposes.map((p) => MATRIX_PURPOSES.label[p]).join(', ')} only)`
  return { field: preset.field, op: preset.op, value, appliesWhen: purposes ? { purposes } : null, severity: input.severity ?? 'hard', message, page: input.page ?? null, quote: '' }
}
