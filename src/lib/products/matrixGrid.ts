// The program drawer's matrix grid (mockup 04): the lender's grid rebuilt from
// its cells. Rows are credit bands, columns are occupancy and units; filters
// pick the purpose, property type, doc type and loan tier. A blank cell is
// "not offered" ("—"), never 0.

import { formatCurrency, formatPercent } from '@/lib/format'
import { tierAmount } from './engine'
import { DOC_TYPES, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, type DocType, type MatrixPropertyType, type MatrixPurpose } from './taxonomy'
import type { CatalogProgram, MatrixCell, ProgramResult, Scenario } from './types'

export interface Tier {
  min: number
  max: number | null
  label: string
}

export interface GridFilters {
  purpose: MatrixPurpose
  propertyType: MatrixPropertyType
  docType: DocType
  /** Index into the program's loan tiers. */
  tier: number
}

const OCC_ORDER = { primary: 0, second_home: 1, investment: 2 } as const

const tierLabel = (min: number, max: number | null) => (max == null ? (min > 0 ? `Over ${formatCurrency(min - 1)}` : 'Any amount') : min > 0 ? `${formatCurrency(min)}–${formatCurrency(max)}` : `Up to ${formatCurrency(max)}`)

/** The values the program's cells use, for the filter buttons. */
export function gridOptions(p: CatalogProgram) {
  const uniq = <T,>(xs: T[]) => [...new Set(xs)]
  const tiers: Tier[] = uniq(p.cells.map((c) => `${c.loanAmountMin}|${c.loanAmountMax ?? ''}`))
    .map((k) => {
      const [min, max] = k.split('|')
      return { min: Number(min), max: max === '' ? null : Number(max), label: '' }
    })
    .sort((a, b) => a.min - b.min || (a.max ?? Infinity) - (b.max ?? Infinity))
    .map((t) => ({ ...t, label: tierLabel(t.min, t.max) }))
  return {
    purposes: MATRIX_PURPOSES.values.filter((v) => p.cells.some((c) => c.purposes.includes(v))),
    propertyTypes: MATRIX_PROPERTY_TYPES.values.filter((v) => p.cells.some((c) => c.propertyTypes.includes(v))),
    docTypes: DOC_TYPES.values.filter((v) => p.cells.some((c) => c.docType === v)),
    tiers,
  }
}

/** Filters preset to the scenario (falling back to what the program offers). */
export function defaultFilters(p: CatalogProgram, s: Scenario): GridFilters {
  const o = gridOptions(p)
  const amount = tierAmount(p, s)
  const tier = o.tiers.findIndex((t) => amount >= t.min && (t.max == null || amount <= t.max))
  return {
    purpose: o.purposes.includes(s.purpose) ? s.purpose : (o.purposes[0] ?? s.purpose),
    propertyType: o.propertyTypes.includes(s.propertyType) ? s.propertyType : (o.propertyTypes[0] ?? s.propertyType),
    docType: o.docTypes.includes(s.docType) ? s.docType : (o.docTypes[0] ?? s.docType),
    tier: Math.max(0, tier),
  }
}

export interface GridColumn {
  occupancy: MatrixCell['occupancy']
  unitsMin: number
  unitsMax: number
  label: string
}

export interface GridRow {
  ficoMin: number
  ficoMax: number
  label: string
}

/** One square of the grid: the governing cell, its limit (null = not offered), and whether it has a footnote. */
export interface GridSquare {
  cell: MatrixCell | null
  limit: number | null
}

export interface MatrixGrid {
  ratio: 'LTV' | 'CLTV'
  columns: GridColumn[]
  rows: GridRow[]
  squares: GridSquare[][]
  /** The borrower's square, when the scenario lands in this filtered grid. */
  highlight: { row: number; col: number } | null
  pages: number[]
  notes: string[]
}

const unitsLabel = (min: number, max: number) => (min === max ? `${min} unit${min === 1 ? '' : 's'}` : `${min}–${max} units`)

export function matrixGrid(p: CatalogProgram, f: GridFilters, s: Scenario | null): MatrixGrid {
  const tier = gridOptions(p).tiers[f.tier]
  const cells = p.cells.filter(
    (c) => c.purposes.includes(f.purpose) && c.propertyTypes.includes(f.propertyType) && c.docType === f.docType && (!tier || (c.loanAmountMin === tier.min && c.loanAmountMax === tier.max)),
  )
  const ratio = p.lien === 'first' ? 'LTV' : 'CLTV'
  const limitOf = (c: MatrixCell) => (ratio === 'LTV' ? (c.maxLtv ?? c.maxCltv) : (c.maxCltv ?? c.maxLtv))

  const colKeys = [...new Set(cells.map((c) => `${c.occupancy}|${c.unitsMin}|${c.unitsMax}`))]
  const columns: GridColumn[] = colKeys
    .map((k) => {
      const [occupancy, a, b] = k.split('|')
      return { occupancy: occupancy as GridColumn['occupancy'], unitsMin: Number(a), unitsMax: Number(b), label: '' }
    })
    .sort((a, b) => OCC_ORDER[a.occupancy] - OCC_ORDER[b.occupancy] || a.unitsMin - b.unitsMin)
  // Name the units only when an occupancy has more than one units column.
  for (const c of columns) c.label = columns.filter((x) => x.occupancy === c.occupancy).length > 1 || c.unitsMin > 1 ? `${OCCUPANCIES.label[c.occupancy]} · ${unitsLabel(c.unitsMin, c.unitsMax)}` : OCCUPANCIES.label[c.occupancy]

  // Columns can use different credit bands; rows are the finest split of every band edge.
  const cuts = [...new Set(cells.flatMap((c) => [c.ficoMin, c.ficoMax + 1]))].sort((a, b) => a - b)
  const rows: GridRow[] = cuts
    .slice(0, -1)
    .map((a, i) => ({ ficoMin: a, ficoMax: cuts[i + 1] - 1 }))
    .filter((r) => cells.some((c) => c.ficoMin <= r.ficoMin && c.ficoMax >= r.ficoMax))
    .map((r) => ({ ...r, label: r.ficoMax >= 850 ? `${r.ficoMin}+` : `${r.ficoMin} – ${r.ficoMax}` }))
    .sort((a, b) => b.ficoMin - a.ficoMin)

  const squares = rows.map((r) =>
    columns.map((col): GridSquare => {
      const hits = cells.filter((c) => c.ficoMin <= r.ficoMin && c.ficoMax >= r.ficoMax && c.occupancy === col.occupancy && c.unitsMin === col.unitsMin && c.unitsMax === col.unitsMax)
      if (hits.length === 0) return { cell: null, limit: null }
      const blank = hits.find((c) => !c.offered)
      if (blank) return { cell: blank, limit: null }
      const low = hits.reduce((a, c) => ((limitOf(c) ?? 0) < (limitOf(a) ?? 0) ? c : a))
      return { cell: low, limit: limitOf(low) }
    }),
  )

  let highlight: MatrixGrid['highlight'] = null
  if (s && s.fico != null && f.purpose === s.purpose && f.propertyType === s.propertyType && f.docType === s.docType && (!tier || (tierAmount(p, s) >= tier.min && (tier.max == null || tierAmount(p, s) <= tier.max)))) {
    const row = rows.findIndex((r) => s.fico! >= r.ficoMin && s.fico! <= r.ficoMax)
    const col = columns.findIndex((c) => c.occupancy === s.occupancy && s.units >= c.unitsMin && s.units <= c.unitsMax)
    if (row >= 0 && col >= 0) highlight = { row, col }
  }
  return {
    ratio,
    columns,
    rows,
    squares,
    highlight,
    pages: [...new Set(cells.map((c) => c.sourcePage).filter((n): n is number => n != null))].sort((a, b) => a - b),
    notes: [...new Set(cells.map((c) => c.notes).filter((n): n is string => !!n && n !== 'Not offered'))],
  }
}

/** One line stating the result (mockup 04): "Fits: 720 FICO · Primary 1-unit · LTV 95% against 97% max · $380,000 within the tier". */
export function fitLine(r: ProgramResult, s: Scenario): string {
  const where = `${OCCUPANCIES.label[s.occupancy]} ${s.units}-unit`
  if (r.eligible && r.limit) {
    const ratio = r.limit.ratio.toUpperCase()
    const cap = r.limit.limitedBy === 'texas' ? ' (Texas §50(a)(6) cap)' : ''
    const tier = r.cell?.loanAmountMax != null ? ` · ${formatCurrency(tierAmount(r.program, s))} within the ${formatCurrency(r.cell.loanAmountMax)} limit` : ''
    const more = r.maxLoan != null && r.program.lien !== 'first' ? ` · up to ${formatCurrency(r.maxLoan)}` : ''
    return `Fits: ${s.fico} FICO · ${where} · ${ratio} ${formatPercent(r.limit.actual, 2)} against ${formatPercent(r.limit.max, 3)} max${cap}${tier}${more}`
  }
  return `Doesn't fit: ${r.reasons.map((x) => x.message).join('; ')}`
}

/** Filters for browsing a program without a scenario: the first grid it has. */
export function firstFilters(p: CatalogProgram): GridFilters {
  const o = gridOptions(p)
  return { purpose: o.purposes[0] ?? 'purchase', propertyType: o.propertyTypes[0] ?? 'sfr_pud', docType: o.docTypes[0] ?? 'full_doc', tier: 0 }
}
