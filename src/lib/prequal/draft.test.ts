import { describe, expect, it } from 'vitest'
import type { LoanProfile } from '@/lib/api/types'
import { application, details, loan as refiLoan, properties } from '@/lib/mismo/testFixture'
import { changeLoanType, draftFrom, draftLoanAmount, hasChanges, prequalChanges, prequalSummary, SUGGESTED_ANNUAL_INSURANCE, SUGGESTED_TAX_RATE_PCT, type PrequalDraft } from './draft'

const purchase: LoanProfile = {
  ...refiLoan,
  purpose: 'purchase',
  details: { ...details, purchasePrice: 400_000, loanAmount: 380_000, subjectPropertyId: null, cashOutAmount: null },
}
const rentalOnly = properties.filter((p) => p.id === 'prop-rental')

describe('building the draft', () => {
  it('reads the saved deal and fills in suggestions', () => {
    const d = draftFrom(purchase, application, null)
    expect(d.loan).toMatchObject({ mortgageType: 'conventional', downPaymentPct: 5, downPaymentAmount: 20_000, termMonths: 360, maxDtiPct: 45 })
    expect(d.loan.estimatedTaxRatePct).toBe(SUGGESTED_TAX_RATE_PCT)
    expect(d.loan.estimatedAnnualInsurance).toBe(SUGGESTED_ANNUAL_INSURANCE)
    const saved = draftFrom(purchase, application, null, false)
    expect(saved.loan.estimatedTaxRatePct).toBeNull()
    expect(saved.loan.estimatedAnnualInsurance).toBeNull()
  })

  it('does not suggest estimates the subject property already has', () => {
    const home = properties.find((p) => p.id === 'prop-home')!
    const d = draftFrom(refiLoan, application, home)
    expect(d.loan.estimatedTaxRatePct).toBeNull()
    expect(d.loan.estimatedAnnualInsurance).toBeNull()
  })

  it('shows each job by its main figure and keeps the rest of the pay', () => {
    const [primary, co] = draftFrom(purchase, application, null).borrowers
    expect(primary.creditScore).toBe(700)
    expect(primary.jobs[0]).toMatchObject({ id: 'e1', monthly: 6500, otherPay: 400, selfEmployed: false })
    expect(co.jobs[0]).toMatchObject({ id: 'e2', monthly: -250, otherPay: 0, selfEmployed: true })
    expect(primary.otherIncomes[0]).toMatchObject({ incomeType: 'child_support', monthly: 600 })
  })

  it('figures the loan from the down payment on a purchase', () => {
    const l = draftFrom(purchase, application, null).loan
    expect(draftLoanAmount(true, l)).toBe(380_000)
    expect(draftLoanAmount(true, { ...l, downPaymentMode: 'amount', downPaymentAmount: 50_000 })).toBe(350_000)
    expect(draftLoanAmount(true, { ...l, purchasePrice: null })).toBeNull()
    expect(draftLoanAmount(false, { ...l, loanAmount: 200_000 })).toBe(200_000)
  })
})

describe('live figures', () => {
  const draft = draftFrom(purchase, application, null)
  const s = prequalSummary(purchase, draft, rentalOnly)

  it('adds up income, debts and the payment with estimates and PMI', () => {
    expect(s.borrowerIncomes).toEqual([7500, -250])
    expect(s.totalIncome).toBe(7250)
    expect(s.otherDebts).toBe(750) // car 450 + child support 300; the card being paid off doesn't count
    // 2,401.86 P&I + 733.33 taxes (2.2%) + 300 insurance + 158.33 PMI
    expect(s.housing).toBe(3593.52)
    expect(s.dti.back).toBe(59.911)
    expect(s.funds).toBe(40_000)
    expect(s.creditScore).toBe(700)
    expect(s.cash).toMatchObject({ downPayment: 20_000, closingCosts: 6_000, total: 26_000 })
  })

  it('finds the max price within the DTI limit and flags the DTI', () => {
    expect(s.max!.housingBudget).toBe(2512.5)
    expect(s.max!.payment.total).toBeLessThanOrEqual(2512.5)
    expect(Object.fromEntries(s.checks.map((c) => [c.label, c.status]))).toEqual({ 'Credit score': 'pass', 'Down payment': 'pass', DTI: 'fail', 'Cash to close': 'pass' })
  })

  it('has no max price without a rate', () => {
    expect(prequalSummary(purchase, { ...draft, loan: { ...draft.loan, noteRate: null } }, rentalOnly).max).toBeNull()
  })
})

describe('saving', () => {
  const saved = draftFrom(purchase, application, null, false)
  const draft = draftFrom(purchase, application, null)

  it('saves the suggested estimates and nothing else when untouched', () => {
    const c = prequalChanges(true, saved, draft)
    expect(c.loan).toEqual({ estimatedTaxRatePct: SUGGESTED_TAX_RATE_PCT, estimatedAnnualInsurance: SUGGESTED_ANNUAL_INSURANCE })
    expect(hasChanges(c)).toBe(true)
    expect(hasChanges(prequalChanges(true, draft, draft))).toBe(false)
  })

  it('collects new, edited and removed rows', () => {
    const edited: PrequalDraft = {
      ...draft,
      loan: { ...draft.loan, purchasePrice: 450_000 },
      borrowers: draft.borrowers.map((b, i) =>
        i === 0
          ? {
              ...b,
              creditScore: 720,
              jobs: [
                { ...b.jobs[0], monthly: 7000 },
                { key: 'new-1', id: null, employerName: 'Weekend Gig', selfEmployed: true, monthly: 800, otherPay: 0 },
                { key: 'new-2', id: null, employerName: '  ', selfEmployed: false, monthly: null, otherPay: 0 },
              ],
            }
          : b,
      ),
      debts: [...draft.debts, { key: 'new-3', id: null, contactId: 'c-1', liabilityType: 'installment', creditorName: 'Student loan', monthlyPayment: 200, toBePaidOff: false }],
      assets: draft.assets.filter((a) => a.id !== 's3'),
    }
    const c = prequalChanges(true, saved, edited)
    expect(c.loan).toMatchObject({ purchasePrice: 450_000, loanAmount: 427_500 })
    expect(c.scores).toEqual([{ contactId: 'c-1', creditScore: 720 }])
    expect(c.jobs.update.map((j) => [j.id, j.monthly])).toEqual([['e1', 7000]])
    expect(c.jobs.insert.map((j) => [j.employerName, j.contactId, j.selfEmployed])).toEqual([['Weekend Gig', 'c-1', true]])
    expect(c.debts.insert).toHaveLength(1)
    expect(c.assets.remove).toEqual(['s3'])
    expect(c.otherIncomes).toEqual({ insert: [], update: [], remove: [] })
  })

  it('leaves the price alone on a refinance', () => {
    const refiSaved = draftFrom(refiLoan, application, null, false)
    const c = prequalChanges(false, refiSaved, { ...refiSaved, loan: { ...refiSaved.loan, loanAmount: 360_000 } })
    expect(c.loan).toEqual({ loanAmount: 360_000 })
  })
})

describe('changing the loan type', () => {
  const l = draftFrom(purchase, application, null).loan

  it('moves untouched defaults to the new type', () => {
    const fresh = { ...l, downPaymentPct: 5 }
    expect(changeLoanType(fresh, 'fha')).toMatchObject({ mortgageType: 'fha', maxDtiPct: 50, downPaymentPct: 3.5 })
    expect(changeLoanType(fresh, 'va')).toMatchObject({ maxDtiPct: 50, downPaymentPct: 0 })
  })

  it('keeps figures Connor changed and clears type-specific overrides', () => {
    const custom = { ...l, maxDtiPct: 43, downPaymentPct: 10, upfrontFeePct: 0 }
    expect(changeLoanType(custom, 'fha')).toMatchObject({ maxDtiPct: 43, downPaymentPct: 10, upfrontFeePct: null })
  })
})
