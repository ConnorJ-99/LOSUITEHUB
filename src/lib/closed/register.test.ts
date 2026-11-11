import { describe, expect, it } from 'vitest'
import type { CompPlan } from '@/lib/calc/lenderComp'
import { filterRegister, registerRow, registerTotals, thisMonth, type RegisterLoan } from './register'

const loan = (o: Partial<RegisterLoan> = {}): RegisterLoan => ({
  id: 'a', closingDate: '2026-11-06', fundingDate: '2026-11-06', stageChangedAt: '2026-11-09T15:00:00Z', borrower: 'Pat TEST', property: null, loId: 'me', loName: 'Connor',
  lenderId: 'L', lender: 'Lender', programId: null, program: null, purpose: 'purchase', occupancy: 'primary', loanAmount: 400_000, rate: 6.5, termMonths: 360,
  ariveLoanNumber: null, leadSourceType: 'self', revenueType: 'amount', revenueValue: 11_000, compPlanId: null,
  snapshot: { baseMode: 'revenue', baseBps: null, splitPct: 70.25, memberType: 'commission' }, ...o,
})
const plans: CompPlan[] = [{ id: 'p', lenderId: 'L', compType: 'lender_paid', compPct: 2.75, minAmount: null, maxAmount: null, fees: [], effectiveFrom: '2026-01-01', effectiveTo: null, programIds: null }]

describe('register rows', () => {
  it('works out comp and checks against the plan', () => {
    const r = registerRow(loan(), plans)
    expect(r).toMatchObject({ productionDate: '2026-11-06', gross: 11_000, loComp: 7727.5, net: 3272.5, planFigure: 11_000, flags: [] })
  })
  it('flags no funding date, missing revenue, and revenue off the plan', () => {
    expect(registerRow(loan({ fundingDate: null }), plans).flags).toEqual(['No funding date'])
    expect(registerRow(loan({ revenueType: null, revenueValue: null }), plans).flags).toEqual(['Needs revenue'])
    expect(registerRow(loan({ revenueValue: 8000 }), plans).flags[0]).toMatch(/differs from the plan \(\$11,000\.00\)/)
  })
  it('no plan: no plan figure and no mismatch flag', () => {
    expect(registerRow(loan({ lenderId: 'X' }), plans)).toMatchObject({ planFigure: null, flags: [] })
  })
})

describe('filters and totals', () => {
  const rows = [
    registerRow(loan({ id: 'fri', fundingDate: '2026-10-31', closingDate: '2026-10-31' }), plans),
    registerRow(loan({ id: 'nov', loId: 'dave', leadSourceType: 'company' }), plans),
    registerRow(loan({ id: 'norev', revenueType: null, revenueValue: null }), plans),
  ]
  it('defaults to this month by production date', () => {
    expect(thisMonth('2026-11-10')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(filterRegister(rows, { ...thisMonth('2026-11-10'), loId: null, leadSource: null }).map((r) => r.id)).toEqual(['nov', 'norev'])
  })
  it('filters by loan officer and lead source', () => {
    expect(filterRegister(rows, { from: null, to: null, loId: 'dave', leadSource: null }).map((r) => r.id)).toEqual(['nov'])
    expect(filterRegister(rows, { from: null, to: null, loId: null, leadSource: 'self' }).map((r) => r.id).sort()).toEqual(['fri', 'norev'])
  })
  it('totals count, volume, gross, LO comp and net; missing revenue adds nothing', () => {
    expect(registerTotals(rows)).toEqual({ count: 3, volume: 1_200_000, gross: 22_000, loComp: 7727.5 * 2, net: 3272.5 * 2, missingRevenue: 1 })
  })
})
