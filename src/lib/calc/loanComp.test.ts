import { describe, expect, it } from 'vitest'
import { loanComp, type CompSnapshot } from './loanComp'

const snap = (o: Partial<CompSnapshot> = {}): CompSnapshot => ({ baseMode: 'revenue', baseBps: null, splitPct: 35.25, memberType: 'commission', ...o })

describe('loanComp', () => {
  it('company-generated lead: 35.25% of $11,000 revenue', () => {
    expect(loanComp({ loanAmount: 400_000, revenue: 11_000 }, snap())).toEqual({ gross: 11_000, base: 11_000, loComp: 3877.5, net: 7122.5, needsRevenue: false })
  })
  it('self-generated lead: 70.25%', () => {
    expect(loanComp({ loanAmount: 400_000, revenue: 11_000 }, snap({ splitPct: 70.25 }))).toMatchObject({ loComp: 7727.5, net: 3272.5 })
  })
  it('salary-only: all of it to the company', () => {
    expect(loanComp({ loanAmount: 400_000, revenue: 11_000 }, snap({ memberType: 'salary' }))).toMatchObject({ loComp: 0, net: 11_000 })
  })
  it('loan amount × bps base: 100 bps of $400,000 = $4,000, 35.25% of that', () => {
    expect(loanComp({ loanAmount: 400_000, revenue: 11_000 }, snap({ baseMode: 'loan_bps', baseBps: 100 }))).toEqual({ gross: 11_000, base: 4000, loComp: 1410, net: 9590, needsRevenue: false })
  })
  it('missing revenue: "needs revenue", never $0', () => {
    expect(loanComp({ loanAmount: 400_000, revenue: null }, snap())).toEqual({ gross: null, base: null, loComp: null, net: null, needsRevenue: true })
    // A bps base still gives the LO's comp; net needs the revenue.
    expect(loanComp({ loanAmount: 400_000, revenue: null }, snap({ baseMode: 'loan_bps', baseBps: 100 }))).toMatchObject({ loComp: 1410, net: null, needsRevenue: true })
  })
  it('no snapshot (closed before comp settings): revenue only', () => {
    expect(loanComp({ loanAmount: 400_000, revenue: 11_000 }, null)).toEqual({ gross: 11_000, base: null, loComp: null, net: null, needsRevenue: false })
  })
})
