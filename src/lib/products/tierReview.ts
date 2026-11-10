// Two views built on the engine's own lookup (limitAt), so they can never disagree with a search:
// the generated grid on the matrix review screen (credit cut points × loan-amount ranges, each square the
// effective maximum the engine would use), and the review list of matrices approved before loan amounts
// could be read as maximums (what each would change to, checked on standard scenarios). Pure.

import { formatCurrency, formatPercent } from '@/lib/format'
import type { MatrixReading, ReadGrid, ReadProgram } from '../../../supabase/functions/assistant/matrix'
import { limitAt } from './engine'
import { cellsFromGrid, gridSettings, labeledAsMaximum, settingsText, type GridSettings, type ImportCell } from './matrixImport'
import { MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, type DocType, type MatrixPropertyType, type MatrixPurpose } from './taxonomy'
import { cellGroups, gridsFromCells, parseBand, retagCells } from './typedMatrix'
import type { Catalog, CatalogProgram, MatrixCell, ProgramRule, Scenario } from './types'

// ---------------------------------------------------------------------------
// The generated grid
// ---------------------------------------------------------------------------

/** The circumstances one generated grid is for. */
export interface GridPick {
  purpose: MatrixPurpose
  propertyType: MatrixPropertyType
  docType: DocType
  occupancy: MatrixCell['occupancy']
  units: number
  /** The DSCR level to look at (null = the grid doesn't depend on DSCR). */
  dscr: number | null
}

export interface GeneratedSquare {
  /** covered = a limit applies; not_offered = a blank that blocks; not_covered = no row or tier reaches it. */
  status: 'covered' | 'not_offered' | 'not_covered'
  max: number | null
  /** Where the limit comes from ("80% via the $1,500,000 tier at 700+ FICO"). */
  why: string | null
  capped: boolean
}

export interface GeneratedGrid {
  ratio: 'LTV' | 'CLTV'
  rows: { ficoMin: number; label: string }[]
  columns: { min: number; max: number | null; label: string }[]
  squares: GeneratedSquare[][]
}

/** A scenario that only asks "what is the limit here": the value is far above the loan, so no ratio rule gets in the way. */
function probe(p: CatalogProgram, at: GridPick, fico: number, loanAmount: number): Scenario {
  return {
    lien: p.lien,
    family: p.family,
    docType: at.docType,
    features: [],
    purpose: at.purpose,
    occupancy: at.occupancy,
    propertyType: at.propertyType,
    units: at.units,
    state: '',
    county: null,
    purchasePrice: null,
    value: loanAmount * 100,
    loanAmount,
    firstLienBalance: 0,
    fico,
    dti: null,
    reservesMonths: null,
    dscr: at.dscr,
    citizenship: 'us_citizen',
    mortgageLates12: null,
    mortgageLates24: null,
    bkSeasoningMonths: null,
    fcSeasoningMonths: null,
    selfEmployedYears: null,
    firstTimeBuyer: false,
    incomeVsAmiPct: null,
    homestead: false,
  }
}

const matches = (c: MatrixCell, at: GridPick) => c.purposes.includes(at.purpose) && c.propertyTypes.includes(at.propertyType) && c.docType === at.docType && c.occupancy === at.occupancy && at.units >= c.unitsMin && at.units <= c.unitsMax

/** The program's minimum loan amount, from its rules (0 if none). */
export function minimumLoan(rules: ProgramRule[]): number {
  const mins = rules.flatMap((r) => (r.field !== 'loan_amount' || r.severity !== 'hard' || r.appliesWhen ? [] : r.op === '>=' && typeof r.value === 'number' ? [r.value] : r.op === 'between' && r.value && typeof r.value === 'object' && !Array.isArray(r.value) ? [r.value.min] : []))
  return mins.length ? Math.max(...mins) : 0
}

/**
 * The grid the engine works from: a row per credit cut point, a column per loan-amount range (cut at every tier,
 * at the program's minimum loan and at every "below $X" cap), and in each square the effective maximum.
 */
export function generatedGrid(p: CatalogProgram, at: GridPick): GeneratedGrid {
  const cells = p.cells.filter((c) => matches(c, at))
  const scores = [...new Set(cells.flatMap((c) => (c.creditMode === 'minimums' || c.ficoMax >= 850 ? [c.ficoMin] : [c.ficoMin, c.ficoMax + 1])))].sort((a, b) => b - a)
  const rows = scores.map((ficoMin, i) => ({ ficoMin, label: i === 0 ? `${ficoMin}+` : `${ficoMin}–${scores[i - 1] - 1}` }))

  const floor = Math.max(minimumLoan(p.rules), 0)
  const open = cells.some((c) => c.loanAmountMax == null)
  // Where a range ends: each tier's maximum, the dollar before a range starts, and the dollar before a small-loan cap stops applying.
  const ends = [
    ...cells.flatMap((c) => [...(c.loanAmountMax != null ? [c.loanAmountMax] : []), ...(c.loanAmountMin > 0 ? [c.loanAmountMin - 1] : [])]),
    ...p.rules.flatMap((r) => (r.appliesWhen?.loan_amount_below != null ? [r.appliesWhen.loan_amount_below - 1] : [])),
  ]
  const top = Math.max(0, ...cells.map((c) => c.loanAmountMax ?? c.loanAmountMin))
  const cuts = [...new Set(ends)].filter((e) => e >= floor && e > 0 && e <= top).sort((a, b) => a - b)
  const columns: GeneratedGrid['columns'] = cuts.map((max, i) => {
    const min = i === 0 ? floor : cuts[i - 1] + 1
    return { min, max, label: min > 0 ? `${formatCurrency(min)}–${formatCurrency(max)}` : `Up to ${formatCurrency(max)}` }
  })
  if (open || columns.length === 0) {
    const min = columns.length ? columns[columns.length - 1].max! + 1 : floor
    columns.push({ min, max: null, label: min > 0 ? `${formatCurrency(min)} and up` : 'Any amount' })
  }

  const squares = rows.map((row) =>
    columns.map((col): GeneratedSquare => {
      const r = limitAt(p, probe(p, at, row.ficoMin, col.max ?? Math.max(col.min, 1)))
      return r.status === 'covered' ? { status: 'covered', max: r.max, why: r.why, capped: r.limitedBy !== 'matrix' } : { status: r.status, max: null, why: null, capped: false }
    }),
  )
  // A credit row or loan range nothing reaches isn't part of the grid.
  const keepRow = rows.map((_, ri) => squares[ri].some((sq) => sq.status !== 'not_covered'))
  const keepCol = columns.map((_, ci) => squares.some((row) => row[ci].status !== 'not_covered'))
  return {
    ratio: p.lien === 'first' ? 'LTV' : 'CLTV',
    rows: rows.filter((_, i) => keepRow[i]),
    columns: columns.filter((_, i) => keepCol[i]),
    squares: squares.filter((_, i) => keepRow[i]).map((row) => row.filter((_, i) => keepCol[i])),
  }
}

/** What a square shows: a limit, "Not offered" (a blank that blocks) or "Not covered" (nothing reaches it); never a dash. */
export const squareText = (sq: GeneratedSquare) => (sq.status === 'covered' ? formatPercent(sq.max!, 3) : sq.status === 'not_offered' ? 'Not offered' : 'Not covered')

let seq = 0
/** Cells ready to save, as the engine sees them. */
export const asCatalogCells = (cells: ImportCell[]): MatrixCell[] => cells.map((c) => ({ ...c, id: `draft-${++seq}`, citizenship: null, maxDti: null, reservesMonths: null }))

/** A draft grid with its program's rules, as a program the engine can look limits up in. */
export function draftProgram(p: Pick<ReadProgram, 'name' | 'family' | 'lien' | 'docTypes' | 'purposes' | 'loanAmountBasis' | 'rules'>, g: ReadGrid): CatalogProgram {
  return {
    id: 'draft',
    lenderId: '',
    name: p.name,
    family: p.family,
    lien: p.lien,
    docTypes: p.docTypes,
    features: [],
    purposes: p.purposes,
    termOptions: [],
    loanAmountBasis: p.loanAmountBasis,
    active: true,
    cells: asCatalogCells(cellsFromGrid(g)),
    rules: p.rules.map((r, i) => ({ id: `draft-rule-${i}`, field: r.field, op: r.op, value: r.value, appliesWhen: r.appliesWhen, severity: r.severity, message: r.message, sourcePage: r.page, sourceQuote: r.quote || null })),
  }
}

/** One generated grid for each set of circumstances a draft grid covers (each purpose column, each income type once). */
export function picksFor(g: ReadGrid): { label: string; pick: GridPick }[] {
  const seen = new Set<string>()
  const out: { label: string; pick: GridPick }[] = []
  for (const c of cellsFromGrid({ ...g, docTypes: g.docTypes.slice(0, 1) })) {
    const key = [c.occupancy, c.purposes.join('+'), c.propertyTypes.join('+'), c.unitsMin, c.unitsMax].join('|')
    if (seen.has(key) || !c.purposes.length || !c.propertyTypes.length) continue
    seen.add(key)
    out.push({
      label: [c.purposes.map((x) => MATRIX_PURPOSES.label[x]).join(' & '), OCCUPANCIES.label[c.occupancy], c.propertyTypes.map((x) => MATRIX_PROPERTY_TYPES.label[x]).join(', '), ...(c.unitsMin === 1 && c.unitsMax === 1 ? [] : [c.unitsMin === c.unitsMax ? `${c.unitsMin} units` : `${c.unitsMin}–${c.unitsMax} units`])].join(' · '),
      pick: { purpose: c.purposes[0], propertyType: c.propertyTypes[0], docType: c.docType, occupancy: c.occupancy, units: c.unitsMin, dscr: g.dscrMin ?? null },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Matrices approved before loan amounts could be read as maximums
// ---------------------------------------------------------------------------

/** The headers the lender printed, from the readings a program was approved from. */
export interface PrintedLabels {
  /** Loan-amount column headers by the column's maximum. */
  columns: { max: number | null; label: string }[]
  /** Credit row labels. */
  rows: string[]
}

/** The printed headers in the readings each program was approved from (program id → labels). */
export function printedLabels(imports: { approvedProgramIds: string[] | null; reading: MatrixReading }[]): Map<string, PrintedLabels> {
  const out = new Map<string, PrintedLabels>()
  for (const imp of imports) {
    const ids = imp.approvedProgramIds ?? []
    const programs = imp.reading?.programs ?? []
    ids.forEach((id, i) => {
      // One program per id when the counts line up; otherwise every program in the reading (a skipped program shifts the order).
      const from = programs.length === ids.length ? [programs[i]] : programs
      const labels = out.get(id) ?? { columns: [], rows: [] }
      for (const p of from)
        for (const g of p?.grids ?? []) {
          labels.columns.push(...(g.columns ?? []).map((c) => ({ max: c.loanAmountMax ?? null, label: c.label ?? '' })))
          labels.rows.push(...(g.rows ?? []).map((r) => r.label ?? ''))
        }
      out.set(id, labels)
    })
  }
  return out
}

export interface TierGrid {
  title: string
  tiers: string[]
  current: GridSettings
  proposed: GridSettings
  /** Why this reading is proposed, in plain words. */
  basis: string
  /** False when nothing tells how the lender printed it: the PDF has to be checked. */
  confident: boolean
}

export interface ScenarioChange {
  scenario: string
  before: string
  after: string
}

export interface TierReviewItem {
  programId: string
  lenderId: string
  lenderName: string
  programName: string
  grids: TierGrid[]
  /** True when at least one grid would be read differently. */
  changes: boolean
  /** Standard scenarios whose result changes under the proposed reading. */
  results: ScenarioChange[]
  /** How many standard scenarios were checked. */
  checked: number
}

/** A row label printed as a minimum ("700", "700+", "≥ 700"), not a band ("700-719"). */
const labeledAsMinimum = (label: string) => {
  const b = parseBand(label)
  return b != null && (b.ficoMax == null || b.ficoMax >= 850)
}

/** How a grid approved as ranges and bands was most likely printed, from the headers the lender used. */
export function proposeSettings(g: ReadGrid, labels: PrintedLabels | undefined): Pick<TierGrid, 'proposed' | 'basis' | 'confident'> {
  const current = gridSettings(g)
  const maxes = [...new Set(g.columns.map((c) => c.loanAmountMax))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity))
  // The smallest tier reads "≤ $X" either way; the larger tiers' headers tell maximums from ranges.
  const upper = maxes.slice(1)
  const headers = (max: number | null) => (labels?.columns ?? []).filter((c) => c.max === max && c.label.trim()).map((c) => c.label.trim())
  const found = upper.map((max) => headers(max))
  // A tier printed as a range anywhere ("$1,000,001 - $1,500,000") is a range, even under a "Maximum Loan Amount" heading;
  // one printed both ways is unclear.
  const asMaximums = found.length > 0 && found.every((ls) => ls.some(labeledAsMaximum) && ls.every(labeledAsMaximum))
  const asRanges = found.length > 0 && found.every((ls) => ls.length > 0 && !ls.some(labeledAsMaximum))
  const mixed = !asMaximums && !asRanges && found.some((ls) => ls.some(labeledAsMaximum)) && found.some((ls) => ls.some((l) => !labeledAsMaximum(l)))
  const sample = [...new Set(found.flat())].slice(0, 3).map((l) => `"${l}"`).join(', ')
  const openRows = [...new Set((labels?.rows ?? []).filter(labeledAsMinimum).map((l) => parseBand(l)!.ficoMin))]
  const minimums = current.creditScores === 'minimums' || (asMaximums && openRows.length > 1 && g.rows.filter((r) => openRows.includes(r.ficoMin)).length > 1)
  if (asMaximums) {
    const proposed: GridSettings = { loanAmounts: 'max_tiers', creditScores: minimums ? 'minimums' : current.creditScores, blankCells: 'not_specified' }
    return { proposed, confident: true, basis: `The lender's headers are maximums (${sample})${minimums && current.creditScores !== 'minimums' ? ', and the credit rows are minimum scores' : ''}.` }
  }
  if (asRanges) return { proposed: current, confident: true, basis: `The lender printed ranges (${sample}): no change.` }
  if (mixed) return { proposed: current, confident: false, basis: `The headers read both ways (${sample}): check the PDF, and change it under Grid settings if the amounts are maximums.` }
  return { proposed: current, confident: false, basis: "The original headers weren't kept for this matrix (typed by hand or edited since): check the PDF, and change it under Grid settings if the amounts are maximums." }
}

const SCORES = [640, 660, 680, 700, 720, 740, 780]
const LOANS = [150_000, 400_000, 750_000, 1_200_000, 1_800_000, 2_500_000]

/** A program with its multi-tier grids re-read under the proposed settings (limits untouched). */
export function withProposed(p: CatalogProgram, labels: PrintedLabels | undefined): { program: CatalogProgram; grids: TierGrid[]; picks: GridPick[] } {
  const tierGrids: TierGrid[] = []
  const picks: GridPick[] = []
  // Each set of circumstances is re-read as a whole, cell by cell: nothing is added or dropped, only how the cells read.
  const cells = cellGroups(p.cells).flatMap((group) => {
    const parts = gridsFromCells(group, p.lien)
    const g: ReadGrid = { ...parts[0], title: parts[0].title.replace(/ · part \d+$/, ''), columns: parts.flatMap((x) => x.columns), rows: [...new Map(parts.flatMap((x) => x.rows).map((r) => [r.ficoMin, r])).values()] }
    const tiers = new Set(g.columns.map((c) => `${c.loanAmountMin}|${c.loanAmountMax}`))
    if (tiers.size < 2) return group
    const current = gridSettings(g)
    const proposal = proposeSettings(g, labels)
    tierGrids.push({ title: g.title, tiers: [...new Set(g.columns.map((c) => c.label))], current, ...proposal })
    picks.push(...picksFor(parts[0]).map((x) => x.pick))
    return retagCells(group, proposal.proposed)
  })
  return { program: { ...p, cells }, grids: tierGrids, picks }
}

const outcome = (p: CatalogProgram, s: Scenario) => {
  const r = limitAt(p, s)
  return r.status === 'covered' ? formatPercent(r.max, 3) : r.status === 'not_offered' ? 'Not offered' : 'Not covered'
}

/**
 * Every approved program with a grid of more than one loan-amount tier: how it reads now, the reading its printed
 * headers suggest, and which standard scenarios (credit score × loan amount, for each of the grid's circumstances)
 * would get a different maximum. Nothing here changes a matrix: approving a new version does.
 */
export function tierReview(catalog: Catalog, labels: Map<string, PrintedLabels>): TierReviewItem[] {
  const lenders = new Map(catalog.lenders.map((l) => [l.id, l]))
  const out: TierReviewItem[] = []
  for (const p of catalog.programs) {
    if (!p.active || p.cells.length === 0) continue
    const { program: proposed, grids, picks } = withProposed(p, labels.get(p.id))
    if (grids.length === 0) continue
    const changes = grids.some((g) => settingsText(g.current) !== settingsText(g.proposed))
    const top = Math.max(...p.cells.map((c) => c.loanAmountMax ?? 0))
    const results: ScenarioChange[] = []
    let checked = 0
    for (const pick of picks)
      for (const fico of SCORES)
        for (const loan of LOANS) {
          if (top > 0 && loan > top) continue
          checked++
          if (!changes) continue
          const before = outcome(p, probe(p, pick, fico, loan))
          const after = outcome(proposed, probe(proposed, pick, fico, loan))
          if (before !== after) results.push({ scenario: `${fico} FICO · ${formatCurrency(loan)} · ${MATRIX_PURPOSES.label[pick.purpose]} · ${OCCUPANCIES.label[pick.occupancy]}${pick.dscr != null ? ` · DSCR ${pick.dscr.toFixed(2)}+` : ''}`, before, after })
        }
    out.push({ programId: p.id, lenderId: p.lenderId, lenderName: lenders.get(p.lenderId)?.name ?? '', programName: p.name, grids, changes, results, checked })
  }
  // Programs that would change first, then by lender and program.
  return out.sort((a, b) => Number(b.changes) - Number(a.changes) || a.lenderName.localeCompare(b.lenderName) || a.programName.localeCompare(b.programName))
}
