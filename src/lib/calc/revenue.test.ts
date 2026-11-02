import { describe, expect, it } from 'vitest'
import { loanRevenue } from './revenue'

describe('loanRevenue', () => {
  it('a percent gives the dollars on the loan amount', () => {
    expect(loanRevenue(105_000, 'percent', 2)).toEqual({ pct: 2, amount: 2100 })
    expect(loanRevenue(467_250, 'percent', 2.25)).toEqual({ pct: 2.25, amount: 10_513.13 })
  })
  it('dollars give the percent of the loan amount', () => {
    expect(loanRevenue(105_000, 'amount', 2100)).toEqual({ pct: 2, amount: 2100 })
    expect(loanRevenue(300_000, 'amount', 4500)).toEqual({ pct: 1.5, amount: 4500 })
  })
  it('keeps what was typed when there is no loan amount yet', () => {
    expect(loanRevenue(null, 'percent', 2)).toEqual({ pct: 2, amount: null })
    expect(loanRevenue(0, 'amount', 2100)).toEqual({ pct: null, amount: 2100 })
  })
  it('nothing typed is nothing', () => {
    expect(loanRevenue(105_000, null, null)).toEqual({ pct: null, amount: null })
  })
})
