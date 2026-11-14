import { describe, expect, it } from 'vitest'
import { activeDpa, cltvWithDpa, dpaLien, dpaMonthly, dpaProblem, type Dpa } from './dpa'

const dpa = (over: Partial<Dpa>): Dpa => ({ kind: 'repayable', amount: 10000, ratePct: 7, termMonths: 360, name: null, ...over })

describe('down payment assistance', () => {
  it('a repayable DPA has a monthly payment from its rate and term', () => {
    expect(dpaMonthly(dpa({}))).toBe(66.53)
    expect(dpaMonthly(dpa({ ratePct: 0, termMonths: 120 }))).toBe(83.33)
    expect(dpaMonthly(dpa({ termMonths: null }))).toBe(0)
    expect(dpaProblem(dpa({ termMonths: null }))).toBe('Add the term to work out the payment.')
  })
  it('a forgivable DPA and a gift have no payment', () => {
    expect(dpaMonthly(dpa({ kind: 'forgivable' }))).toBe(0)
    expect(dpaMonthly(dpa({ kind: 'gift' }))).toBe(0)
    expect(dpaProblem(dpa({ kind: 'forgivable', termMonths: null }))).toBeNull()
  })
  it('DPA liens count in CLTV; a gift does not', () => {
    expect(dpaLien(dpa({ kind: 'forgivable' }))).toBe(10000)
    expect(dpaLien(dpa({ kind: 'gift' }))).toBe(0)
    expect(cltvWithDpa(260550, dpa({ kind: 'forgivable' }), 270000)).toBe(100.20)
    expect(cltvWithDpa(260550, dpa({ kind: 'gift' }), 270000)).toBe(96.5)
    expect(cltvWithDpa(260550, null, null)).toBeNull()
  })
  it('no amount = no DPA', () => {
    expect(activeDpa(dpa({ amount: 0 }))).toBeNull()
    expect(activeDpa(null)).toBeNull()
  })
})
