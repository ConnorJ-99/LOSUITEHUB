import { describe, expect, it } from 'vitest'
import { cellsFromGrid, checkProgram } from './matrixImport'
import type { MatrixPurpose } from './taxonomy'
import { addColumn, addRow, applyPaste, blankGrid, blankProgram, closeBands, closeTiers, copyGrid, parseBand, parseColumn, parsePaste, programFromGuess, removeColumn, removeRow, ruleFromInput, setColumnHeader, setRowBand, syncGrids, unitsFor } from './typedMatrix'

/** The Equity Flex CLTV grid from the Product Search mockup, as copied from Excel (tabs between squares). */
const EXCEL = [
  'Credit score\t≤ $150,000\t$150,001 – $250,000\t$250,001 – $350,000\t$350,001 – $500,000',
  '760+\t90%\t90%\t85%\t80%',
  '740 – 759\t90%\t85%\t85%\t80%',
  '720 – 739\t85%\t85%\t80%\t75%',
  '700 – 719\t85%\t80%\t80%\t75%',
  '680 – 699\t85%\t80%\t75%\t—',
  '660 – 679\t80%\t80%\t70%\t—',
  '640 – 659\t80%\t75%\t—\t—',
  '620 – 639\t70%\t65%\t—\t—',
].join('\r\n')

describe('credit bands', () => {
  it('reads the ways lenders print them', () => {
    expect(parseBand('760+')).toEqual({ ficoMin: 760, ficoMax: 850 })
    expect(parseBand('740 - 759')).toEqual({ ficoMin: 740, ficoMax: 759 })
    expect(parseBand('740–759')).toEqual({ ficoMin: 740, ficoMax: 759 })
    expect(parseBand('700 to 719')).toEqual({ ficoMin: 700, ficoMax: 719 })
    expect(parseBand('≥ 720')).toEqual({ ficoMin: 720, ficoMax: 850 })
    expect(parseBand('FICO 680 & above')).toEqual({ ficoMin: 680, ficoMax: 850 })
    expect(parseBand('<620')).toEqual({ ficoMin: 300, ficoMax: 619 })
    expect(parseBand('720')).toEqual({ ficoMin: 720, ficoMax: null })
  })
  it('rejects anything that is not a score', () => {
    expect(parseBand('Credit score')).toBeNull()
    expect(parseBand('900+')).toBeNull()
    expect(parseBand('85%')).toBeNull()
  })
  it('gives bare minimums their top from the band above', () => {
    expect(closeBands([{ ficoMin: 760, ficoMax: null }, { ficoMin: 740, ficoMax: null }, { ficoMin: 700, ficoMax: null }])).toEqual([
      { ficoMin: 760, ficoMax: 850 },
      { ficoMin: 740, ficoMax: 759 },
      { ficoMin: 700, ficoMax: 739 },
    ])
  })
})

describe('loan amount columns', () => {
  it('reads tiers', () => {
    expect(parseColumn('≤ $150,000')).toMatchObject({ loanAmountMin: 0, loanAmountMax: 150000 })
    expect(parseColumn('$150,001 – $250,000')).toMatchObject({ loanAmountMin: 150001, loanAmountMax: 250000 })
    expect(parseColumn('Up to 1.5M')).toMatchObject({ loanAmountMin: 0, loanAmountMax: 1500000 })
    expect(parseColumn('1.5M+')).toMatchObject({ loanAmountMin: 1500000, loanAmountMax: null })
    expect(parseColumn('> $1,000,000')).toMatchObject({ loanAmountMin: 1000001, loanAmountMax: null })
    expect(parseColumn('150k-250k')).toMatchObject({ loanAmountMin: 150000, loanAmountMax: 250000 })
    expect(parseColumn('Any')).toMatchObject({ loanAmountMin: 0, loanAmountMax: null })
  })
  it('reads occupancy and purpose columns', () => {
    expect(parseColumn('Investment')).toEqual({ loanAmountMin: 0, loanAmountMax: null, occupancy: 'investment', purposes: null })
    expect(parseColumn('Second Home')).toMatchObject({ occupancy: 'second_home' })
    expect(parseColumn('Purchase / R&T')).toMatchObject({ purposes: ['purchase', 'rate_term'], loanAmountMax: null })
    expect(parseColumn('Cash-Out ≤ $1M')).toEqual({ loanAmountMin: 0, loanAmountMax: 1000000, occupancy: null, purposes: ['cash_out'] })
  })
  it('rejects headers it cannot read', () => {
    expect(parseColumn('Notes')).toBeNull()
    expect(parseColumn('$500,000 - $100,000')).toBeNull()
  })
  it('separates tiers that share a boundary', () => {
    const cols = closeTiers([
      { loanAmountMin: 0, loanAmountMax: 1000000 },
      { loanAmountMin: 1000000, loanAmountMax: 1500000 },
    ])
    expect(cols[1].loanAmountMin).toBe(1000001)
  })
})

describe('pasting from Excel', () => {
  it('reads headers, credit bands and limits; dashes are not offered', () => {
    const p = parsePaste(EXCEL)
    expect(p.problems).toEqual([])
    expect(p.columns?.map((c) => [c.loanAmountMin, c.loanAmountMax])).toEqual([
      [0, 150000],
      [150001, 250000],
      [250001, 350000],
      [350001, 500000],
    ])
    expect(p.rows?.map((r) => r.label)).toEqual(['760+', '740–759', '720–739', '700–719', '680–699', '660–679', '640–659', '620–639'])
    expect(p.values[6]).toEqual([80, 75, null, null])
  })
  it("gives Marcus's 652 FICO / $75,000 square 80% once pasted into a CLTV grid", () => {
    const g = applyPaste({ ...blankGrid({ lien: 'ces', purposes: ['cash_out'], docTypes: ['bank_statement_12'] }) }, parsePaste(EXCEL))
    if ('error' in g) throw new Error(g.error)
    const cell = cellsFromGrid(g).find((c) => c.ficoMin <= 652 && c.ficoMax >= 652 && c.loanAmountMin <= 75000 && (c.loanAmountMax ?? Infinity) >= 75000)
    expect(cell).toMatchObject({ maxCltv: 80, maxLtv: null, offered: true, docType: 'bank_statement_12', purposes: ['cash_out'] })
    expect(cellsFromGrid(g)).toHaveLength(32)
    expect(cellsFromGrid(g).filter((c) => !c.offered)).toHaveLength(6)
  })
  it('reads a block copied from a PDF (spaces, not tabs)', () => {
    const p = parsePaste('720 - 739   85%   80%\n700 - 719   80%   75%\n')
    expect(p.rows?.map((r) => [r.ficoMin, r.ficoMax])).toEqual([
      [720, 739],
      [700, 719],
    ])
    expect(p.values).toEqual([
      [85, 80],
      [80, 75],
    ])
  })
  it('reads bare score minimums down the side', () => {
    const p = parsePaste('\t≤1M\t1M-1.5M\n740\t80\t75\n700\t75\t70\n660\t70\t')
    expect(p.rows?.map((r) => [r.ficoMin, r.ficoMax])).toEqual([
      [740, 850],
      [700, 739],
      [660, 699],
    ])
    expect(p.columns?.map((c) => [c.loanAmountMin, c.loanAmountMax])).toEqual([
      [0, 1000000],
      [1000001, 1500000],
    ])
    expect(p.values[2]).toEqual([70, null])
  })
  it('flags squares that are not percents and pastes nothing', () => {
    const p = parsePaste('80\tabc\n75\t70')
    expect(p.problems).toEqual(['Row 1, column 2: "abc" isn\'t a percent.'])
    expect(applyPaste(blankGrid(blankProgram()), p)).toHaveProperty('error')
  })
  it('fills numbers alone from the square clicked', () => {
    const g = addColumn(blankGrid(blankProgram()))
    const r = applyPaste(g, parsePaste('97\t95\n95\t90'), { row: 1, col: 0 })
    if ('error' in r) throw new Error(r.error)
    expect(r.values.slice(0, 3)).toEqual([
      [null, null],
      [97, 95],
      [95, 90],
    ])
  })
  it('says so when numbers alone do not fit', () => {
    const r = applyPaste(blankGrid(blankProgram()), parsePaste('97\t95'), { row: 0, col: 0 })
    expect(r).toHaveProperty('error')
    expect((r as { error: string }).error).toContain('only has room for 8 × 1')
  })
})

describe('grid shape', () => {
  it('starts with the usual bands and one loan column, nothing offered yet', () => {
    const p = blankProgram('Typed Program')
    expect(p.grids[0].rows).toHaveLength(8)
    expect(p.grids[0].printedRows).toBe(8)
    expect(checkProgram(p).some((w) => w.message.startsWith('No matrix grid'))).toBe(true)
  })
  it('adds and removes rows and columns, keeping the squares lined up', () => {
    let g = blankGrid(blankProgram())
    g = addRow(g)
    expect(g.rows.at(-1)).toMatchObject({ ficoMin: 600, ficoMax: 619, label: '600–619' })
    g = addColumn(g)
    expect(g.columns[1]).toMatchObject({ loanAmountMin: 1000001, loanAmountMax: 1500000 })
    expect(g.values.every((r) => r.length === 2)).toBe(true)
    g = removeRow(removeColumn(g, 0), 0)
    expect([g.rows.length, g.columns.length, g.values.length, g.values[0].length, g.printedColumns]).toEqual([8, 1, 8, 1, 1])
  })
  it('renames rows and columns from what is typed, or explains', () => {
    const g = blankGrid(blankProgram())
    expect(setRowBand(g, 0, '780+')).toMatchObject({ rows: expect.arrayContaining([expect.objectContaining({ ficoMin: 780, ficoMax: 850 })]) })
    expect(setRowBand(g, 0, 'great')).toHaveProperty('error')
    expect(setColumnHeader(g, 0, 'Investment ≤ $2M')).toMatchObject({ columns: [expect.objectContaining({ occupancy: 'investment', loanAmountMax: 2000000, label: 'Investment ≤ $2M' })] })
    expect(setColumnHeader(g, 0, '???')).toHaveProperty('error')
  })
  it('blocks a copied grid that still covers the same loans', () => {
    const p = blankProgram('Typed')
    p.grids[0].values[0][0] = 80
    const copy = copyGrid(p.grids[0])
    const twice = checkProgram({ ...p, grids: [p.grids[0], copy] }).filter((w) => w.level === 'error')
    expect(twice).toHaveLength(1)
    expect(twice[0].message).toContain('"Primary" and "Primary (copy)" cover the same loans')
    expect(checkProgram({ ...p, grids: [p.grids[0], { ...copy, occupancy: 'second_home' }] }).filter((w) => w.level === 'error')).toEqual([])
  })
  it('copies a grid so the next one can start from it', () => {
    const g = blankGrid(blankProgram(), 'Primary')
    const c = copyGrid(g)
    c.values[0][0] = 90
    expect(c.title).toBe('Primary (copy)')
    expect(g.values[0][0]).toBeNull()
  })
  it('sets units from property types', () => {
    expect(unitsFor(['sfr_pud', 'condo'])).toEqual({ unitsMin: 1, unitsMax: 1 })
    expect(unitsFor(['two_to_four'])).toEqual({ unitsMin: 2, unitsMax: 4 })
    expect(unitsFor(['sfr_pud', 'two_to_four'])).toEqual({ unitsMin: 1, unitsMax: 4 })
  })
  it('keeps grids inside the purposes and doc types the program offers', () => {
    const p = blankProgram()
    const synced = syncGrids({ ...p, purposes: ['cash_out'], docTypes: ['bank_statement_12'] })
    expect(synced.grids[0]).toMatchObject({ purposes: ['cash_out'], docTypes: ['bank_statement_12'] })
    const g = { ...p.grids[0], purposes: ['purchase'] as MatrixPurpose[] }
    expect(syncGrids({ ...p, grids: [g], purposes: ['cash_out'] }).grids[0].purposes).toEqual(['cash_out'])
    expect(syncGrids({ ...p, docTypes: [] }).grids[0].docTypes).toEqual(['full_doc'])
  })
  it('starts a program from what an uploaded PDF looks like', () => {
    const p = programFromGuess({ name: 'Equity Advantage HELOC', family: 'non_qm', lien: 'heloc', docTypes: ['full_doc'], features: [], termOptions: ['heloc_10_20'] })
    expect(p).toMatchObject({ name: 'Equity Advantage HELOC', lien: 'heloc', purposes: ['cash_out'], termOptions: ['heloc_10_20'] })
    expect(p.grids[0]).toMatchObject({ ratio: 'cltv', purposes: ['cash_out'], docTypes: ['full_doc'] })
  })
  it('uses CLTV for 2nd liens', () => {
    expect(blankGrid({ lien: 'heloc', purposes: [], docTypes: [] }).ratio).toBe('cltv')
    expect(blankGrid({ lien: 'first', purposes: [], docTypes: [] }).ratio).toBe('ltv')
  })
})

describe('typed rules', () => {
  it('builds the rule and its message', () => {
    expect(ruleFromInput({ preset: 'max_dti', number: 50, page: 3 })).toEqual({ field: 'dti', op: '<=', value: 50, appliesWhen: null, severity: 'hard', message: 'Max DTI 50%', page: 3, quote: '' })
    expect(ruleFromInput({ preset: 'min_reserves', number: 3, severity: 'verify' })).toMatchObject({ field: 'reserves_months', op: '>=', value: 3, severity: 'verify', message: 'Min 3 months reserves' })
    expect(ruleFromInput({ preset: 'max_lates_12', number: 1 })).toMatchObject({ message: 'Max 1 30-day mortgage late in the last 12 months' })
    expect(ruleFromInput({ preset: 'max_lates_24', number: 0 })).toMatchObject({ message: 'No 30-day mortgage lates in the last 24 months' })
    expect(ruleFromInput({ preset: 'min_dscr', number: 1 })).toMatchObject({ value: 1, message: 'Min DSCR 1.00' })
    expect(ruleFromInput({ preset: 'loan_amount', min: 35000, max: 500000 })).toMatchObject({ op: 'between', value: { min: 35000, max: 500000 }, message: 'Loan amount $35,000–$500,000' })
    expect(ruleFromInput({ preset: 'states', list: ['tx, ok'] })).toMatchObject({ value: ['TX', 'OK'], message: 'States: TX, OK' })
    expect(ruleFromInput({ preset: 'citizenship', list: ['us_citizen', 'permanent_resident'] })).toMatchObject({ value: ['us_citizen', 'permanent_resident'], message: 'Citizenship: US citizen, Permanent resident' })
  })
  it('limits a rule to some purposes', () => {
    expect(ruleFromInput({ preset: 'min_fico', number: 680, purposes: ['cash_out'] })).toMatchObject({ appliesWhen: { purposes: ['cash_out'] }, message: 'Min credit score 680 (Cash-out only)' })
    expect(ruleFromInput({ preset: 'min_fico', number: 680, purposes: ['purchase', 'rate_term', 'cash_out'] })).toMatchObject({ appliesWhen: null })
  })
  it('explains what is missing', () => {
    expect(ruleFromInput({ preset: 'max_dti', number: null })).toHaveProperty('error')
    expect(ruleFromInput({ preset: 'max_dti', number: 150 })).toHaveProperty('error')
    expect(ruleFromInput({ preset: 'min_fico', number: 90 })).toHaveProperty('error')
    expect(ruleFromInput({ preset: 'loan_amount', min: 500000, max: 100000 })).toHaveProperty('error')
    expect(ruleFromInput({ preset: 'states', list: ['Texas'] })).toHaveProperty('error')
    expect(ruleFromInput({ preset: 'citizenship', list: [] })).toHaveProperty('error')
  })
})
