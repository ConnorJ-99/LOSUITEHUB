import { describe, expect, it } from 'vitest'
import { filterLenders, lenderTiles, loanCounts, matrixState, needsAttention, offerCounts, offerTags, tabCounts, type ListLender } from './lenderSummary'

const TODAY = '2026-10-28'
const prog = (over: Partial<ListLender['programs'][number]> = {}): ListLender['programs'][number] => ({ name: 'Conventional', family: 'conventional', lien: 'first', docTypes: ['full_doc'], features: [], active: true, lastVerifiedOn: '2026-10-14', ...over })
const lender = (over: Partial<ListLender> = {}): ListLender => ({ id: 'L', name: 'Keystone Non-QM', shortName: 'KN', status: 'approved', states: ['TX', 'OK'], aeName: 'Rachel Kim', programs: [], pendingReviews: 0, ...over })

/** Fictional lenders like mockup 08. */
const keystone = lender({
  id: 'k',
  programs: [
    prog({ name: 'DSCR', family: 'non_qm', docTypes: ['dscr'] }),
    prog({ name: 'DSCR Closed-End Second', family: 'non_qm', lien: 'ces', docTypes: ['dscr'], features: ['llc_vesting'] }),
    prog({ name: 'Bank Statement', family: 'non_qm', docTypes: ['bank_statement_12', 'bank_statement_24'] }),
    prog({ name: 'ITIN', family: 'non_qm', docTypes: ['full_doc'], features: ['itin'] }),
    prog({ name: 'Old DSCR', family: 'non_qm', docTypes: ['dscr'], active: false }),
  ],
})
const north = lender({ id: 'n', name: 'Northgate Wholesale', shortName: 'NW', aeName: 'Dana', programs: [prog(), prog({ name: 'FHA', family: 'fha' })], pendingReviews: 1 })
const lake = lender({ id: 'l', name: 'Lakeshore Capital', shortName: null, status: 'not_signed_up', aeName: null, states: ['TX'], programs: [prog({ lastVerifiedOn: '2026-08-01' })] })
const empty = lender({ id: 'e', name: 'New Lender', status: 'pending', programs: [] })
const ALL = [keystone, north, lake, empty]

describe('what a lender offers', () => {
  it('counts a program under every product type it fits', () => {
    expect(offerTags(keystone.programs[1])).toEqual(['DSCR', '2nd lien'])
    expect(offerTags(prog({ family: 'fha', features: ['dpa'] }))).toEqual(['FHA', 'DPA'])
    expect(offerTags(prog({ family: 'non_qm', lien: 'heloc', docTypes: ['full_doc'] }))).toEqual(['HELOC'])
    expect(offerTags(prog({ family: 'non_qm', docTypes: ['bank_statement_12', 'asset_depletion', 'retirement_distribution'] }))).toEqual(['Bank statement', 'Asset depletion', 'IRA / retirement'])
  })
  it('counts only programs in searches, like mockup 09 (DSCR 2 · Bank statement 1 · 2nd lien 1 · ITIN 1)', () => {
    expect(offerCounts(keystone.programs)).toEqual([
      { tag: 'DSCR', count: 2 },
      { tag: 'Bank statement', count: 1 },
      { tag: '2nd lien', count: 1 },
      { tag: 'ITIN', count: 1 },
    ])
  })
})

describe('your loans with a lender', () => {
  it('closed this year, and still in process (not lost or nurture)', () => {
    const loans = [
      { stage: 'closed', closingDate: '2026-03-02' },
      { stage: 'closed', closingDate: '2025-12-20' },
      { stage: 'closed', closingDate: null },
      { stage: 'submitted', closingDate: '2026-11-20' },
      { stage: 'lost', closingDate: null },
      { stage: 'nurture', closingDate: null },
    ]
    expect(loanCounts(loans, 2026)).toEqual({ closedThisYear: 2, active: 1 })
  })
})

describe('matrix date and attention', () => {
  it('shows the oldest date among programs in searches, orange when stale', () => {
    expect(matrixState(keystone, TODAY)).toEqual({ verifiedOn: '2026-10-14', state: 'current' })
    expect(matrixState(lake, TODAY)).toEqual({ verifiedOn: '2026-08-01', state: 'stale' })
    expect(matrixState(empty, TODAY)).toEqual({ verifiedOn: null, state: 'none' })
  })
  it('a matrix waiting for review or a stale matrix needs attention', () => {
    expect(ALL.map((l) => needsAttention(l, TODAY))).toEqual([false, true, true, false])
  })
  it('sums the tiles', () => {
    expect(lenderTiles(ALL, TODAY)).toEqual({ lenders: 4, approved: 2, notYet: 2, programs: 7, attention: 2 })
  })
})

describe('filters', () => {
  const f = (over = {}) => ({ tab: 'all' as const, text: '', offers: [], ...over })
  it('tabs by status or attention', () => {
    expect(filterLenders(ALL, f({ tab: 'approved' }), TODAY).map((l) => l.id)).toEqual(['k', 'n'])
    expect(filterLenders(ALL, f({ tab: 'attention' }), TODAY).map((l) => l.id)).toEqual(['n', 'l'])
  })
  it('lenders that offer every picked product type', () => {
    expect(filterLenders(ALL, f({ offers: ['DSCR', '2nd lien'] }), TODAY).map((l) => l.id)).toEqual(['k'])
    expect(filterLenders(ALL, f({ offers: ['Conventional'] }), TODAY).map((l) => l.id)).toEqual(['n', 'l'])
  })
  it('searches names, AEs, states and program names', () => {
    expect(filterLenders(ALL, f({ text: 'rachel' }), TODAY).map((l) => l.id)).toEqual(['k', 'e'])
    expect(filterLenders(ALL, f({ text: 'closed-end' }), TODAY).map((l) => l.id)).toEqual(['k'])
    expect(filterLenders(ALL, f({ text: 'ok' }), TODAY).map((l) => l.id)).toEqual(['k', 'n', 'e'])
  })
  it('counts each tab with the other filters applied', () => {
    expect(tabCounts(ALL, { text: '', offers: ['Conventional'] }, TODAY)).toMatchObject({ all: 2, approved: 1, not_signed_up: 1, attention: 2 })
  })
})
