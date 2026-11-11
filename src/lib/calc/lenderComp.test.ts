import { describe, expect, it } from 'vitest'
import { lenderComp, missingPlan, planFor, type CompPlan } from './lenderComp'

const plan = (o: Partial<CompPlan> = {}): CompPlan => ({ id: 'p', lenderId: 'L', compType: 'lender_paid', compPct: 2.75, minAmount: null, maxAmount: null, fees: [], effectiveFrom: '2026-01-01', effectiveTo: null, programIds: null, ...o })

describe('lenderComp', () => {
  it('% only: 2.75% of $400,000 is $11,000', () => {
    expect(lenderComp(400_000, plan())).toBe(11_000)
  })
  it('the minimum is a floor', () => {
    expect(lenderComp(50_000, plan({ minAmount: 2_000 }))).toBe(2_000)
  })
  it('the maximum is a cap', () => {
    expect(lenderComp(1_000_000, plan({ maxAmount: 20_000 }))).toBe(20_000)
  })
  it('fees add to or take off the comp', () => {
    expect(lenderComp(400_000, plan({ fees: [{ name: 'Processing', amount: 500, adds: true }] }))).toBe(11_500)
    expect(lenderComp(400_000, plan({ fees: [{ name: 'Admin', amount: 995, adds: false }] }))).toBe(10_005)
  })
  it('rounds to cents', () => {
    expect(lenderComp(333_333, plan({ compPct: 2.125 }))).toBe(7083.33)
  })
  it('no plan or no loan amount is unknown (null), not $0', () => {
    expect(lenderComp(400_000, null)).toBeNull()
    expect(lenderComp(null, plan())).toBeNull()
    expect(lenderComp(0, plan())).toBeNull()
  })
})

describe('which plan applies', () => {
  const plans = [
    plan({ id: 'old', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', compPct: 2.5 }),
    plan({ id: 'now' }),
    plan({ id: 'heloc', programIds: ['heloc'], compPct: 1.5 }),
    plan({ id: 'bp', compType: 'borrower_paid', compPct: 2 }),
  ]
  it('the plan in effect on the closing date, so older loans keep the older plan', () => {
    expect(planFor(plans, { lenderId: 'L', programId: null, day: '2025-06-01' })?.id).toBe('old')
    expect(planFor(plans, { lenderId: 'L', programId: null, day: '2026-03-01' })?.id).toBe('now')
  })
  it('a program-specific plan wins for that program', () => {
    expect(planFor(plans, { lenderId: 'L', programId: 'heloc', day: '2026-03-01' })?.id).toBe('heloc')
    expect(planFor(plans, { lenderId: 'L', programId: 'conv', day: '2026-03-01' })?.id).toBe('now')
  })
  it('lender-paid first; borrower-paid when asked or when it is the only one', () => {
    expect(planFor(plans, { lenderId: 'L', programId: null, day: '2026-03-01', compType: 'borrower_paid' })?.id).toBe('bp')
    expect(planFor([plans[3]], { lenderId: 'L', programId: null, day: '2026-03-01' })?.id).toBe('bp')
  })
  it('no lender, another lender or a day before any plan gives none', () => {
    expect(planFor(plans, { lenderId: null, programId: null, day: '2026-03-01' })).toBeNull()
    expect(planFor(plans, { lenderId: 'X', programId: null, day: '2026-03-01' })).toBeNull()
    expect(planFor(plans, { lenderId: 'L', programId: null, day: '2024-01-01' })).toBeNull()
  })
  it('flags a lender with no plan in effect today', () => {
    expect(missingPlan('L', plans, '2026-03-01')).toBe(false)
    expect(missingPlan('X', plans, '2026-03-01')).toBe(true)
  })
})
