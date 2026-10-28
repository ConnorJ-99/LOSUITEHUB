// A matrix reading turned into cells, the automatic checks before approval,
// and the difference from the version in use (plan §5.4–5.6). Pure.

import { formatCurrency, formatPercent } from '@/lib/format'
import type { ReadGrid, ReadProgram } from '../../../supabase/functions/assistant/matrix'
import { MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, termMonths, type MatrixPropertyType, type MatrixPurpose } from './taxonomy'
import type { MatrixCell } from './types'

/** A cell ready to save (no id yet). */
export type ImportCell = Omit<MatrixCell, 'id' | 'dscrMin' | 'citizenship' | 'maxDti' | 'reservesMonths'>

/** Every square of every grid as a cell; a blank square is "not offered", never 0. */
export function cellsFromProgram(p: ReadProgram): ImportCell[] {
  return p.grids.flatMap((g) => cellsFromGrid(g))
}

export function cellsFromGrid(g: ReadGrid): ImportCell[] {
  const out: ImportCell[] = []
  g.rows.forEach((row, ri) =>
    g.columns.forEach((col, ci) => {
      const v = g.values[ri]?.[ci] ?? null
      out.push({
        occupancy: col.occupancy ?? g.occupancy,
        propertyTypes: col.propertyTypes?.length ? col.propertyTypes : g.propertyTypes,
        purposes: col.purposes?.length ? col.purposes : g.purposes,
        docType: g.docType,
        unitsMin: col.unitsMin ?? g.unitsMin,
        unitsMax: col.unitsMax ?? g.unitsMax,
        ficoMin: row.ficoMin,
        ficoMax: row.ficoMax,
        loanAmountMin: col.loanAmountMin,
        loanAmountMax: col.loanAmountMax,
        offered: v != null,
        maxLtv: v != null && g.ratio === 'ltv' ? v : null,
        maxCltv: v != null && g.ratio === 'cltv' ? v : null,
        sourcePage: g.page > 0 ? g.page : null,
        notes: g.notes,
      })
    }),
  )
  return out
}

// ---------------------------------------------------------------------------
// Automatic checks (plan §5.5)
// ---------------------------------------------------------------------------

export interface ImportWarning {
  level: 'error' | 'warning'
  message: string
  page: number | null
}

const limitOf = (c: Pick<ImportCell, 'maxLtv' | 'maxCltv'>) => c.maxLtv ?? c.maxCltv
const band = (min: number, max: number) => (max >= 850 ? `${min}+` : `${min}–${max}`)
const tier = (min: number, max: number | null) => (max == null ? (min > 0 ? `over ${formatCurrency(min - 1)}` : 'any amount') : min > 0 ? `${formatCurrency(min)}–${formatCurrency(max)}` : `≤${formatCurrency(max)}`)

/** Errors block approval; warnings are shown for Connor to confirm against the PDF. */
export function checkProgram(p: ReadProgram): ImportWarning[] {
  const out: ImportWarning[] = []
  if (!p.docTypes.length) out.push({ level: 'error', message: 'Pick at least one doc type for the program.', page: null })
  if (!p.purposes.length) out.push({ level: 'error', message: 'Pick at least one purpose for the program.', page: null })
  const cells = cellsFromProgram(p)
  if (!cells.some((c) => c.offered)) out.push({ level: 'error', message: 'The program has no matrix cells with a limit.', page: null })

  for (const g of p.grids) {
    const where = g.title || (g.page > 0 ? `the grid on page ${g.page}` : 'a grid')
    const pg = g.page > 0 ? g.page : null
    const filled = g.values.reduce((n, row) => n + row.length, 0)
    if (g.values.length !== g.rows.length || g.values.some((row) => row.length !== g.columns.length)) out.push({ level: 'error', message: `${where}: ${filled} squares read for ${g.rows.length} rows × ${g.columns.length} columns.`, page: pg })
    if (g.printedRows !== g.rows.length || g.printedColumns !== g.columns.length) out.push({ level: 'warning', message: `${where}: the page shows ${g.printedRows} × ${g.printedColumns}, but ${g.rows.length} × ${g.columns.length} were read.`, page: pg })
    if (!g.propertyTypes.length && g.columns.some((c) => !c.propertyTypes?.length)) out.push({ level: 'error', message: `${where}: no property type.`, page: pg })
    if (!g.purposes.length && g.columns.some((c) => !c.purposes?.length)) out.push({ level: 'error', message: `${where}: no purpose.`, page: pg })

    g.rows.forEach((r) => {
      if (r.ficoMin < 300 || r.ficoMax > 850 || r.ficoMin > r.ficoMax) out.push({ level: 'error', message: `${where}: credit band "${r.label || band(r.ficoMin, r.ficoMax)}" isn't possible (${r.ficoMin}–${r.ficoMax}).`, page: pg })
    })
    g.columns.forEach((c) => {
      if (c.loanAmountMin < 0 || (c.loanAmountMax != null && c.loanAmountMax < c.loanAmountMin)) out.push({ level: 'error', message: `${where}: loan amounts in column "${c.label}" aren't possible.`, page: pg })
    })
    g.values.forEach((row, ri) =>
      row.forEach((v, ci) => {
        if (v != null && (v <= 0 || v > 100)) out.push({ level: 'error', message: `${where}: ${g.ratio.toUpperCase()} ${v}% at ${g.rows[ri]?.label ?? ''} / ${g.columns[ci]?.label ?? ''} isn't possible.`, page: pg })
      }),
    )

    // Within a column, the limit never goes up as the credit score goes down.
    const order = g.rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.ficoMin - a.r.ficoMin)
    g.columns.forEach((col, ci) => {
      for (let k = 1; k < order.length; k++) {
        const higher = g.values[order[k - 1].i]?.[ci] ?? null
        const lower = g.values[order[k].i]?.[ci] ?? null
        if (lower != null && (higher == null || lower > higher))
          out.push({ level: 'warning', message: `${where}, ${col.label}: ${band(order[k].r.ficoMin, order[k].r.ficoMax)} allows ${higher == null ? 'a loan where a higher score is not offered' : `${formatPercent(lower, 3)}, more than ${formatPercent(higher, 3)} at ${band(order[k - 1].r.ficoMin, order[k - 1].r.ficoMax)}`}. Check the PDF.`, page: pg })
      }
    })
    // Across loan tiers that differ only by amount, the limit never goes up as the loan amount goes up.
    const same = (a: ReadGrid['columns'][number], b: ReadGrid['columns'][number]) => a.occupancy === b.occupancy && a.unitsMin === b.unitsMin && a.unitsMax === b.unitsMax && JSON.stringify(a.purposes) === JSON.stringify(b.purposes) && JSON.stringify(a.propertyTypes) === JSON.stringify(b.propertyTypes)
    const tiers = g.columns.map((c, i) => ({ c, i })).sort((a, b) => a.c.loanAmountMin - b.c.loanAmountMin)
    g.rows.forEach((row, ri) => {
      for (let a = 0; a < tiers.length; a++)
        for (let b = a + 1; b < tiers.length; b++) {
          if (!same(tiers[a].c, tiers[b].c) || tiers[b].c.loanAmountMin <= tiers[a].c.loanAmountMin) continue
          const small = g.values[ri]?.[tiers[a].i] ?? null
          const big = g.values[ri]?.[tiers[b].i] ?? null
          if (big != null && small != null && big > small)
            out.push({ level: 'warning', message: `${where}, ${band(row.ficoMin, row.ficoMax)}: ${tiers[b].c.label} allows ${formatPercent(big, 3)}, more than ${formatPercent(small, 3)} for the smaller ${tiers[a].c.label}. Check the PDF.`, page: pg })
        }
    })
  }

  // Two grids that cover exactly the same loans (usually a copied grid whose occupancy or purpose wasn't changed).
  const owner = new Map<string, number>()
  const pairs = new Map<string, string>()
  p.grids.forEach((g, gi) =>
    cellsFromGrid(g).forEach((c) => {
      const k = key(c)
      const first = owner.get(k)
      if (first == null) owner.set(k, gi)
      else if (first !== gi && !pairs.has(`${first}|${gi}`)) {
        const name = (i: number) => p.grids[i].title || `grid ${i + 1}`
        pairs.set(`${first}|${gi}`, `"${name(first)}" and "${name(gi)}" cover the same loans (${cellLabel(c)}). Change one grid's occupancy, property types, purposes or doc type.`)
      }
    }),
  )
  for (const message of pairs.values()) out.push({ level: 'error', message, page: null })
  return out
}

// ---------------------------------------------------------------------------
// Difference from the version in use (plan §5.6)
// ---------------------------------------------------------------------------

type CellKeyed = Pick<ImportCell, 'occupancy' | 'propertyTypes' | 'purposes' | 'docType' | 'unitsMin' | 'unitsMax' | 'ficoMin' | 'ficoMax' | 'loanAmountMin' | 'loanAmountMax' | 'maxLtv' | 'maxCltv' | 'offered'>

const key = (c: CellKeyed) => [c.occupancy, [...c.propertyTypes].sort().join('+'), [...c.purposes].sort().join('+'), c.docType, c.unitsMin, c.unitsMax, c.ficoMin, c.ficoMax, c.loanAmountMin, c.loanAmountMax ?? ''].join('|')

/** "Primary · SFR/PUD · Purchase · 680–699 · ≤$1,000,000". */
export function cellLabel(c: CellKeyed): string {
  const units = c.unitsMin === 1 && c.unitsMax === 1 ? '' : c.unitsMin === c.unitsMax ? ` · ${c.unitsMin} units` : ` · ${c.unitsMin}–${c.unitsMax} units`
  return `${OCCUPANCIES.label[c.occupancy]} · ${c.propertyTypes.map((t: MatrixPropertyType) => MATRIX_PROPERTY_TYPES.label[t]).join(', ')} · ${c.purposes.map((p: MatrixPurpose) => MATRIX_PURPOSES.label[p]).join(', ')}${units} · ${band(c.ficoMin, c.ficoMax)} · ${tier(c.loanAmountMin, c.loanAmountMax)}`
}

export interface CellChange {
  label: string
  /** Null = not offered; undefined = the cell didn't exist. */
  from: number | null | undefined
  to: number | null | undefined
}

const show = (v: number | null | undefined) => (v === undefined ? 'not in the matrix' : v === null ? 'not offered' : formatPercent(v, 3))
export const changeText = (c: CellChange) => `${c.label}: ${show(c.from)} → ${show(c.to)}`

/** What changes between the version in use and a new reading: changed limits, newly offered or dropped cells. */
export function diffCells(current: CellKeyed[], next: CellKeyed[]): CellChange[] {
  const before = new Map(current.map((c) => [key(c), c]))
  const after = new Map(next.map((c) => [key(c), c]))
  const out: CellChange[] = []
  for (const [k, n] of after) {
    const o = before.get(k)
    const to = n.offered ? limitOf(n) : null
    if (!o) out.push({ label: cellLabel(n), from: undefined, to })
    else {
      const from = o.offered ? limitOf(o) : null
      if (from !== to) out.push({ label: cellLabel(n), from, to })
    }
  }
  for (const [k, o] of before) if (!after.has(k)) out.push({ label: cellLabel(o), from: o.offered ? limitOf(o) : null, to: undefined })
  return out
}

// ---------------------------------------------------------------------------
// What approval saves
// ---------------------------------------------------------------------------

/** A program as reviewed: the reading (edited), whether to approve it, and the existing program it updates. */
export interface ReviewProgram extends ReadProgram {
  include: boolean
  /** The lender's existing program this updates, or null for a new program. */
  programId: string | null
}

/** The programs to approve, in the shape approve_matrix_import() takes. */
export function approvalPayload(programs: ReviewProgram[]) {
  return programs
    .filter((p) => p.include)
    .map((p) => ({
      program_id: p.programId,
      name: p.name.trim(),
      family: p.family,
      lien: p.lien,
      doc_types: p.docTypes,
      features: p.features,
      purposes: p.purposes,
      term_options: p.termOptions,
      terms_months: [...new Set(p.termOptions.map(termMonths))],
      loan_amount_basis: p.loanAmountBasis,
      description: p.description ?? '',
      cells: cellsFromProgram(p).map((c) => ({
        occupancy: c.occupancy,
        property_types: c.propertyTypes,
        purposes: c.purposes,
        doc_type: c.docType,
        units_min: c.unitsMin,
        units_max: c.unitsMax,
        fico_min: c.ficoMin,
        fico_max: c.ficoMax,
        loan_amount_min: c.loanAmountMin,
        loan_amount_max: c.loanAmountMax,
        offered: c.offered,
        max_ltv: c.maxLtv,
        max_cltv: c.maxCltv,
        notes: c.notes,
        source_page: c.sourcePage,
      })),
      rules: p.rules.map((r) => ({ field: r.field, op: r.op, value: r.value, applies_when: r.appliesWhen, severity: r.severity, message: r.message, source_page: r.page, source_quote: r.quote })),
    }))
}

/** The lender's existing program with the same name (ignoring case and spacing), so a newer matrix updates it instead of duplicating it. */
export function matchProgram(name: string, existing: { id: string; name: string }[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return existing.find((e) => norm(e.name) === norm(name))?.id ?? null
}

/** A typed square: blank, "—", "N/A" or "NA" means not offered; otherwise a percent. */
export function parseSquare(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/%$/, '')
  if (t === '' || /^(—|-|–|n\/?a)$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : 'invalid'
}
