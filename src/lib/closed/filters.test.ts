import { describe, expect, it } from 'vitest'
import { NO_FILTERS, activeCount, matchesFilters, rangeProblem, type ClosedFilters, type FilterableLoan } from './filters'

const loan: FilterableLoan = { creditScore: 712, rate: 6.25, loanAmount: 386000, closingDate: '2026-03-14', purpose: 'purchase', occupancy: 'primary_residence', termMonths: 360 }
const f = (patch: Partial<ClosedFilters>): ClosedFilters => ({ ...NO_FILTERS, ...patch })

describe('closed loan filters', () => {
  it('no filters match everything', () => {
    expect(matchesFilters(loan, NO_FILTERS)).toBe(true)
    expect(activeCount(NO_FILTERS)).toBe(0)
  })
  it('credit range, ends included, open ends', () => {
    expect(matchesFilters(loan, f({ credit: { min: 700, max: 739 } }))).toBe(true)
    expect(matchesFilters(loan, f({ credit: { min: 712, max: 712 } }))).toBe(true)
    expect(matchesFilters(loan, f({ credit: { min: 740, max: null } }))).toBe(false)
    expect(matchesFilters(loan, f({ credit: { min: null, max: 719 } }))).toBe(true)
  })
  it('a loan with no credit score is left out once a range is set', () => {
    expect(matchesFilters({ ...loan, creditScore: null }, f({ credit: { min: 600, max: null } }))).toBe(false)
  })
  it('rate range', () => {
    expect(matchesFilters(loan, f({ rate: { min: 6, max: 6.5 } }))).toBe(true)
    expect(matchesFilters({ ...loan, rate: 6.2500001 }, f({ rate: { min: 6.25, max: 6.25 } }))).toBe(true)
    expect(matchesFilters(loan, f({ rate: { min: 6.5, max: null } }))).toBe(false)
  })
  it('closed between two dates', () => {
    expect(matchesFilters(loan, f({ closedFrom: '2026-01-01', closedTo: '2026-03-14' }))).toBe(true)
    expect(matchesFilters(loan, f({ closedFrom: '2026-03-15' }))).toBe(false)
    expect(matchesFilters({ ...loan, closingDate: null }, f({ closedTo: '2026-12-31' }))).toBe(false)
  })
  it('all at once', () => {
    const all = f({ credit: { min: 700, max: null }, rate: { min: null, max: 6.5 }, closedFrom: '2026-01-01', closedTo: '2026-06-30', amount: { min: 300000, max: 400000 }, purpose: 'purchase', occupancy: 'primary_residence', termYears: 30 })
    expect(matchesFilters(loan, all)).toBe(true)
    expect(activeCount(all)).toBe(7)
    expect(matchesFilters({ ...loan, termMonths: 180 }, all)).toBe(false)
    expect(matchesFilters({ ...loan, purpose: 'refinance' }, all)).toBe(false)
  })
  it('flags a backwards range', () => {
    expect(rangeProblem({ min: 740, max: 700 })).toMatch(/above/)
    expect(rangeProblem({ min: 700, max: null })).toBeNull()
  })
})
