import { describe, expect, it } from 'vitest'
import { averageDaysToClose, groupProducts, lastMatrixUpdate, licensedLine, productRow } from './lenderDetail'
import { cell, program } from './testCatalog'
import type { MatrixCell } from './types'

const c = (over: Partial<MatrixCell>): MatrixCell => cell({ ficoMin: 660, ficoMax: 850, loanAmountMin: 100000, loanAmountMax: 3000000, maxLtv: 80, ...over })

describe('products table', () => {
  it('a DSCR program: min FICO, max LTV, loan range and occupancy from its matrix', () => {
    const p = program('L', 'DSCR', { family: 'non_qm', docTypes: ['dscr'], cells: [c({ occupancy: 'investment' }), c({ occupancy: 'investment', ficoMin: 700, maxLtv: 75 }), c({ occupancy: 'investment', ficoMin: 620, ficoMax: 659, offered: false, maxLtv: null })] })
    expect(productRow(p)).toMatchObject({ group: 'non_qm_dscr', tags: ['DSCR'], minFico: 660, maxRatio: 80, ratio: 'LTV', loanRange: '$100K–$3M', occupancy: 'Investment' })
  })
  it('a 2nd lien shows CLTV, "up to" without a minimum, and every occupancy as All', () => {
    const p = program('L', 'Bank Statement Second', { family: 'non_qm', lien: 'ces', docTypes: ['bank_statement_12'], cells: (['primary', 'second_home', 'investment'] as const).map((o) => c({ occupancy: o, loanAmountMin: 0, loanAmountMax: 500000, maxLtv: null, maxCltv: 80 })) })
    expect(productRow(p)).toMatchObject({ ratio: 'CLTV', maxRatio: 80, loanRange: 'Up to $500K', occupancy: 'All', tags: ['Bank statement', '2nd lien'] })
  })
  it('a program without an approved matrix has no numbers', () => {
    expect(productRow(program('L', 'New', { cells: [] }))).toMatchObject({ minFico: null, maxRatio: null, loanRange: null, occupancy: null })
  })
  it('groups by product type in browse order, names A–Z', () => {
    const rows = [program('L', 'FHA', { family: 'fha' }), program('L', 'DSCR No-Ratio', { family: 'non_qm', docTypes: ['dscr'] }), program('L', 'DSCR', { family: 'non_qm', docTypes: ['dscr'] })].map(productRow)
    expect(groupProducts(rows).map((g) => [g.label, g.rows.map((r) => r.program.name)])).toEqual([
      ['FHA', ['FHA']],
      ['Non-QM · DSCR', ['DSCR', 'DSCR No-Ratio']],
    ])
  })
})

describe('header', () => {
  it('shortens a long list of states', () => {
    expect(licensedLine(['TX', 'OK'])).toBe('Licensed in TX, OK')
    expect(licensedLine(['TX', 'OK', 'FL', 'GA', ...Array.from({ length: 18 }, (_, i) => `S${i}`)])).toBe('Licensed in TX, OK, FL, GA and 18 more')
    expect(licensedLine(null)).toBeNull()
  })
  it('averages application to closing over closed files', () => {
    expect(averageDaysToClose([{ applicationOn: '2026-09-01', closedOn: '2026-09-25' }, { applicationOn: '2026-08-01', closedOn: '2026-08-23' }, { applicationOn: '2026-10-01', closedOn: null }])).toBe(23)
    expect(averageDaysToClose([])).toBeNull()
  })
})

describe('last matrix update', () => {
  const dscrOld = [c({ occupancy: 'investment', ficoMin: 700, ficoMax: 719, loanAmountMin: 1000001, loanAmountMax: 3000000, maxLtv: 75 })]
  const dscrNew = [c({ occupancy: 'investment', ficoMin: 700, ficoMax: 719, loanAmountMin: 1000001, loanAmountMax: 3000000, maxLtv: 70 })]
  it('lists limits that moved in the newest update, and new programs (like mockup 09)', () => {
    const u = lastMatrixUpdate([
      { programName: 'DSCR', current: { version: 2, approvedAt: '2026-10-14T15:00:00Z', cells: dscrNew }, previous: { version: 1, cells: dscrOld } },
      { programName: 'DSCR No-Ratio', current: { version: 1, approvedAt: '2026-10-14T15:01:00Z', cells: dscrNew }, previous: null },
      { programName: 'FHA', current: { version: 3, approvedAt: '2026-08-02T15:00:00Z', cells: [] }, previous: { version: 2, cells: [] } },
    ])!
    expect(u.approvedAt).toBe('2026-10-14T15:00:00Z')
    expect(u.newPrograms).toEqual(['DSCR No-Ratio'])
    expect(u.changes).toHaveLength(1)
    expect(u.changes[0]).toMatchObject({ programName: 'DSCR', from: 75, to: 70, direction: 'down' })
  })
  it('nothing approved yet', () => {
    expect(lastMatrixUpdate([])).toBeNull()
  })
})
