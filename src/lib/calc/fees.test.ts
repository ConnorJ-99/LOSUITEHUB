import { describe, expect, it } from 'vitest'
import {
  cashToBorrower,
  feeSheet,
  firstMortgagePayment,
  firstPaymentDateFor,
  pointsAmount,
  pointsPct,
  prepaidInterest,
  prepaidInterestDays,
  purchaseCashToClose,
  sectionTotals,
  toMonthly,
  totalClosingCosts,
  totalPitia,
  type FeeContext,
  type FeeTemplate,
} from './fees'

const t = (key: string, section: FeeTemplate['section'], name: string, amount: number, extra: Partial<FeeTemplate> = {}): FeeTemplate => ({
  key, section, name, amountType: 'fixed', amount, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: 10, active: true, ...extra,
})

// Sample fee list shaped to Connor's test case totals (his real list replaces it in Settings).
const templates: FeeTemplate[] = [
  t('admin', 'A', 'Admin fee', 1505.75, { apr: true }),
  t('appraisal', 'B', 'Appraisal', 650),
  t('credit_report', 'B', 'Credit report', 65),
  t('flood_cert', 'B', 'Flood certification', 150),
  t('title_policy', 'C', 'Title - lender policy', 2086.25),
  t('settlement', 'C', 'Title - settlement fee', 750),
  t('recording', 'E', 'Recording fees', 223),
  t('misc', 'H', 'Title - tax certificate and courier', 150),
  t('survey', 'H', 'Survey', 450, { purposes: ['purchase'] }),
  t('old', 'B', 'Retired fee', 99, { active: false }),
]

// Refi cash-out, value $620,000, loan $465,000, 7.625%, 360 months, funding Oct 26, impounds waived.
const ctx: FeeContext = {
  purpose: 'refinance_cash_out',
  mortgageType: 'conventional',
  loanAmount: 465000,
  propertyValue: 620000,
  ratePct: 7.625,
  pointsPct: 4,
  lenderCredit: 0,
  prepaidInterestDays: prepaidInterestDays('2026-10-26'),
  monthlyHoi: 92.47,
  monthlyTaxes: 525,
  monthlyMi: 0,
  hoiPrepaidMonths: 0,
  taxPrepaidMonths: 0,
  hoiReserveMonths: 3,
  taxReserveMonths: 4,
  miReserveMonths: 0,
  aggregateAdjustment: -150,
  impoundWaiver: 'all',
}

describe("Connor's test case", () => {
  it('monthly payment', () => {
    const pi = firstMortgagePayment(465000, 7.625, 360, false)
    expect(pi).toBe(3291.24)
    expect(totalPitia({ principalAndInterest: pi, otherFinancing: 0, hoi: 92.47, supplemental: 0, taxes: 525, mi: 0, hoa: 0, other: 0 })).toBe(3908.71)
  })
  it('section totals, closing costs and cash to borrower', () => {
    const totals = sectionTotals(feeSheet(templates, [], ctx))
    expect(totals).toEqual({ A: 20105.75, B: 865, C: 2836.25, E: 223, F: 590.94, G: 0, H: 150 })
    const closing = totalClosingCosts(totals, 0)
    expect(closing).toBe(24770.94)
    expect(cashToBorrower({ loanAmount: 465000, closingCosts: closing, payoffs: 390694 })).toBe(49535.06)
  })
})

describe('fee math', () => {
  it('prepaid interest on a 360-day year, counting the funding day', () => {
    expect(prepaidInterestDays('2026-10-26')).toBe(6)
    expect(prepaidInterestDays('2026-02-27')).toBe(2)
    expect(prepaidInterest(465000, 7.625, 6)).toBe(590.94)
    expect(firstPaymentDateFor('2026-10-26')).toBe('2026-12-01')
    expect(firstPaymentDateFor('2026-12-15')).toBe('2027-02-01')
  })
  it('points both ways', () => {
    expect(pointsAmount(1.25, 465000)).toBe(5812.5)
    expect(pointsPct(5812.5, 465000)).toBe(1.25)
    expect(pointsPct(1000, 0)).toBe(0)
  })
  it('converts monthly, annual and % of value', () => {
    expect(toMonthly(92.47, 'monthly', null)).toBe(92.47)
    expect(toMonthly(6300, 'annual', null)).toBe(525)
    expect(toMonthly(1.25, 'pct_of_value', 620000)).toBe(645.83)
    expect(toMonthly(null, 'annual', null)).toBe(0)
  })
  it('escrows when impounds are not waived, and waiving only taxes', () => {
    const totals = sectionTotals(feeSheet(templates, [], { ...ctx, impoundWaiver: 'none' }))
    expect(totals.G).toBe(round2(92.47 * 3 + 525 * 4 - 150))
    expect(sectionTotals(feeSheet(templates, [], { ...ctx, impoundWaiver: 'taxes' })).G).toBe(round2(92.47 * 3 - 150))
  })
  it('only fees that apply to the file, active ones only', () => {
    const keys = feeSheet(templates, [], ctx).map((l) => l.key)
    expect(keys).not.toContain('survey')
    expect(keys).not.toContain('old')
    expect(feeSheet(templates, [], { ...ctx, purpose: 'purchase' }).map((l) => l.key)).toContain('survey')
  })
  it('edits override the engine and remember its value; custom fees are added; non-borrower fees do not count', () => {
    const lines = feeSheet(
      templates,
      [
        { key: 'appraisal', section: 'B', name: 'Appraisal', atClosing: 700, beforeClosing: null, paidBy: 'B', apr: false, paidTo: 'Sample AMC', custom: false },
        { key: 'custom_1', section: 'H', name: 'Courier', atClosing: 40, beforeClosing: null, paidBy: 'B', apr: false, paidTo: null, custom: true },
        { key: 'settlement', section: 'C', name: 'Title - settlement fee', atClosing: 750, beforeClosing: null, paidBy: 'S', apr: false, paidTo: null, custom: false },
      ],
      ctx,
    )
    expect(lines.find((l) => l.key === 'appraisal')).toMatchObject({ atClosing: 700, edited: true, calculated: 650, paidTo: 'Sample AMC' })
    expect(lines.find((l) => l.key === 'custom_1')).toMatchObject({ custom: true, section: 'H' })
    const totals = sectionTotals(lines)
    expect(totals.B).toBe(915)
    expect(totals.C).toBe(2086.25) // seller pays the settlement fee
    expect(totals.H).toBe(190)
    expect(lines.map((l) => l.section)).toEqual([...lines.map((l) => l.section)].sort((a, b) => 'ABCEFGH'.indexOf(a) - 'ABCEFGH'.indexOf(b)))
  })
  it('purchase cash to close', () => {
    expect(purchaseCashToClose({ purchasePrice: 400000, loanAmount: 380000, closingCosts: 9000, earnestMoney: 4000, sellerCredits: 3000 })).toBe(22000)
  })
})

function round2(n: number) {
  return Math.round(n * 100) / 100
}
