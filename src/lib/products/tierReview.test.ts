import { describe, expect, it } from 'vitest'
import type { MatrixReading } from '../../../supabase/functions/assistant/matrix'
import { cellsFromGrid, gridSettings } from './matrixImport'
import { cell, lender, program, rule } from './testCatalog'
import { asCatalogCells, generatedGrid, picksFor, printedLabels, proposeSettings, squareText, tierReview } from './tierReview'
import { applyGridSettings, gridsFromCells } from './typedMatrix'
import type { Catalog, MatrixCell } from './types'

// The DSCR matrix from the tier fix, the way it was saved before: ranges and credit bands, with gaps the lender never printed.
const ranges: [number, number | null][] = [[0, 500000], [500001, 1000000], [1000001, 1500000]]
const bands: [number, number, (number | null)[]][] = [[720, 850, [75, 80, 80]], [700, 719, [75, null, 80]], [660, 699, [75, null, 75]], [640, 659, [75, null, null]]]
const dscrBase: Partial<MatrixCell> = { occupancy: 'investment', docType: 'dscr', dscrMin: 1, purposes: ['purchase', 'rate_term'] }
const saved = bands.flatMap(([ficoMin, ficoMax, limits]) => ranges.map(([loanAmountMin, loanAmountMax], i) => cell({ ...dscrBase, ficoMin, ficoMax, loanAmountMin, loanAmountMax, offered: limits[i] != null, maxLtv: limits[i] })))
const old = program('Tier Bank', 'DSCR', { family: 'non_qm', docTypes: ['dscr'], cells: saved })
const column = (label: string, min: number, max: number) => ({ label, loanAmountMin: min, loanAmountMax: max, occupancy: null, unitsMin: null, unitsMax: null, purposes: null, propertyTypes: null })
const reading = (labels: string[], rows = ['720+', '700', '660', '640']): MatrixReading => ({
  programs: [{ name: 'DSCR', family: 'non_qm', lien: 'first', docTypes: ['dscr'], features: [], purposes: ['purchase'], termOptions: [], loanAmountBasis: 'this_lien', description: null, rules: [], grids: [{ ...gridsFromCells(saved, 'first')[0], columns: ranges.map(([min, max], i) => column(labels[i], min, max!)), rows: rows.map((label, i) => ({ label, ficoMin: bands[i][0], ficoMax: bands[i][1] })) }] }],
  effectiveDate: null,
  notes: null,
  dropped: [],
})
const catalog: Catalog = { lenders: [lender('Tier Bank')], programs: [old], overlays: [] }

describe('the generated grid shows what the engine would use', () => {
  const pick = { purpose: 'purchase' as const, propertyType: 'sfr_pud' as const, docType: 'dscr' as const, occupancy: 'investment' as const, units: 1, dscr: 1 }

  it('saved as ranges and bands: the gaps show as "Not offered"', () => {
    const g = generatedGrid(old, pick)
    expect(g.rows.map((r) => r.label)).toEqual(['720+', '700–719', '660–699', '640–659'])
    expect(g.columns.map((c) => c.label)).toEqual(['Up to $500,000', '$500,001–$1,000,000', '$1,000,001–$1,500,000'])
    expect(g.squares.map((row) => row.map(squareText))).toEqual([
      ['75%', '80%', '80%'],
      ['75%', 'Not offered', '80%'],
      ['75%', 'Not offered', '75%'],
      ['75%', 'Not offered', 'Not offered'],
    ])
  })
  it('read as maximums and minimum scores: every square is the best tier the borrower reaches, and an uncovered one says "Not covered"', () => {
    const grid = applyGridSettings(gridsFromCells(saved, 'first')[0], { loanAmounts: 'max_tiers', creditScores: 'minimums' })
    expect(gridSettings(grid)).toEqual({ loanAmounts: 'max_tiers', creditScores: 'minimums', blankCells: 'not_specified' })
    expect(grid.columns.map((c) => [c.label, c.loanAmountMin])).toEqual([['≤$500,000', 0], ['≤$1,000,000', 0], ['≤$1,500,000', 0]])
    expect(grid.rows.map((r) => r.label)).toEqual(['720+', '700+', '660+', '640+'])
    const rules = [rule({ field: 'loan_amount', op: '>=', value: 125000, message: 'Minimum loan amount $125,000' }), rule({ field: 'ltv', op: '<=', value: 70, appliesWhen: { loan_amount_below: 150000 }, message: 'Loan amounts under $150,000 max 70% LTV' })]
    const g = generatedGrid({ ...old, rules, cells: asCatalogCells(cellsFromGrid(grid)) }, pick)
    expect(g.columns.map((c) => c.label)).toEqual(['$125,000–$149,999', '$150,000–$500,000', '$500,001–$1,000,000', '$1,000,001–$1,500,000'])
    expect(g.squares.map((row) => row.map(squareText))).toEqual([
      ['70%', '80%', '80%', '80%'],
      ['70%', '80%', '80%', '80%'],
      ['70%', '75%', '75%', '75%'],
      ['70%', '75%', 'Not covered', 'Not covered'],
    ])
    expect(g.squares[1][2]).toMatchObject({ why: '80% via the $1,500,000 tier at 700+ FICO', capped: false })
    expect(g.squares[0][0]).toMatchObject({ capped: true })
  })
  it('one generated grid per purpose column of a draft grid', () => {
    const grid = gridsFromCells(saved, 'first')[0]
    expect(picksFor(grid).map((x) => x.label)).toEqual(['Purchase & Rate/term · Investment · SFR/PUD · 1–4 units'])
  })
})

describe('the review list of matrices approved as ranges', () => {
  it('headers printed as maximums: proposes maximums, minimum scores and blank = not specified, and shows what changes', () => {
    const labels = printedLabels([{ approvedProgramIds: [old.id], reading: reading(['$500,000', '≤ $1MM', '≤ $1.5MM']) }])
    const [item] = tierReview(catalog, labels)
    expect(item).toMatchObject({ lenderName: 'Tier Bank', programName: 'DSCR', changes: true })
    expect(item.grids[0].current).toEqual({ loanAmounts: 'explicit_ranges', creditScores: 'bands', blankCells: 'not_offered' })
    expect(item.grids[0].proposed).toEqual({ loanAmounts: 'max_tiers', creditScores: 'minimums', blankCells: 'not_specified' })
    expect(item.grids[0].confident).toBe(true)
    expect(item.results).toContainEqual({ scenario: '700 FICO · $750,000 · Purchase · Investment · DSCR 1.00+', before: 'Not offered', after: '80%' })
    expect(item.results).toContainEqual({ scenario: '720 FICO · $400,000 · Purchase · Investment · DSCR 1.00+', before: '75%', after: '80%' })
    // 640 at $750,000 is still not a fit: nothing the lender printed covers it.
    expect(item.results).toContainEqual({ scenario: '640 FICO · $750,000 · Purchase · Investment · DSCR 1.00+', before: 'Not offered', after: 'Not covered' })
    // Nothing got worse.
    expect(item.results.every((r) => r.after !== 'Not offered')).toBe(true)
    expect(item.checked).toBe(7 * 4)
  })
  it('headers printed as ranges: no change proposed, nothing listed as changing', () => {
    const labels = printedLabels([{ approvedProgramIds: [old.id], reading: reading(['≤ $500,000', '$500,001 - $1MM', '$1MM+ to $1.5MM'], ['720+', '700-719', '660-699', '640-659']) }])
    const [item] = tierReview(catalog, labels)
    expect(item.changes).toBe(false)
    expect(item.grids[0].basis).toContain('printed ranges')
    expect(item.results).toEqual([])
  })
  it('no headers kept: says to check the PDF and proposes nothing', () => {
    const [item] = tierReview(catalog, new Map())
    expect(item.changes).toBe(false)
    expect(item.grids[0].confident).toBe(false)
    expect(proposeSettings(gridsFromCells(saved, 'first')[0], undefined).basis).toContain('check the PDF')
  })
  it('a program with one loan tier is not on the list', () => {
    const one = program('Tier Bank', 'One tier', { cells: [cell({ maxLtv: 80, loanAmountMax: 1000000 })] })
    expect(tierReview({ ...catalog, programs: [one] }, new Map())).toEqual([])
  })
  it('a matrix already read as maximums stays as it is', () => {
    const grid = applyGridSettings(gridsFromCells(saved, 'first')[0], { loanAmounts: 'max_tiers', creditScores: 'minimums' })
    const fixed = { ...old, cells: asCatalogCells(cellsFromGrid(grid)) }
    const [item] = tierReview({ ...catalog, programs: [fixed] }, printedLabels([{ approvedProgramIds: [old.id], reading: reading(['$500,000', '≤ $1MM', '≤ $1.5MM']) }]))
    expect(item.changes).toBe(false)
    expect(item.grids[0].current.loanAmounts).toBe('max_tiers')
  })
})

describe('a saved matrix opened for editing comes back exactly as saved', () => {
  // Like A&D Super Prime: the $500,000 tier prints 640–679 as one row, the $1,000,000 tier splits it at 660.
  const uneven = [
    cell({ ficoMin: 680, ficoMax: 850, loanAmountMax: 500000, maxLtv: 80 }),
    cell({ ficoMin: 640, ficoMax: 679, loanAmountMax: 500000, maxLtv: 75 }),
    cell({ ficoMin: 680, ficoMax: 850, loanAmountMin: 500001, loanAmountMax: 1000000, maxLtv: 75 }),
    cell({ ficoMin: 660, ficoMax: 679, loanAmountMin: 500001, loanAmountMax: 1000000, maxLtv: 70 }),
    cell({ ficoMin: 640, ficoMax: 659, loanAmountMin: 500001, loanAmountMax: 1000000, maxLtv: 65 }),
  ]
  it('no blank ("not offered") square is invented where the lender printed nothing', () => {
    const back = gridsFromCells(uneven, 'first').flatMap(cellsFromGrid)
    expect(back).toHaveLength(5)
    expect(back.every((c) => c.offered)).toBe(true)
  })
  it('re-reading as maximums never makes a scenario worse than "not covered"', () => {
    const p = program('Tier Bank', 'Uneven', { cells: uneven })
    const labels = printedLabels([{ approvedProgramIds: [p.id], reading: { ...reading(['≤ $500,000', '≤ $1,000,000', '']), programs: [{ ...reading(['']).programs[0], grids: [{ ...gridsFromCells(uneven, 'first')[0], columns: [column('$500,000', 0, 500000), column('≤ $1,000,000', 500001, 1000000)], rows: [] }] }] } }])
    const [item] = tierReview({ ...catalog, programs: [p] }, labels)
    expect(item.changes).toBe(true)
    expect(item.results.filter((r) => r.after === 'Not offered')).toEqual([])
  })
})
