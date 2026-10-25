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
    const d = draftFrom(purchase, application, rentalOnly)
    expect(d.loan).toMatchObject({ mortgageType: 'conventional', downPaymentPct: 5, downPaymentAmount: 20_000, termMonths: 360, maxDtiPct: 45 })
    expect(d.loan.estimatedTaxRatePct).toBe(SUGGESTED_TAX_RATE_PCT)
    expect(d.loan.estimatedAnnualInsurance).toBe(SUGGESTED_ANNUAL_INSURANCE)
    const saved = draftFrom(purchase, application, rentalOnly, false)
    expect(saved.loan.estimatedTaxRatePct).toBeNull()
    expect(saved.loan.estimatedAnnualInsurance).toBeNull()
  })

  it('does not suggest estimates the subject property already has', () => {
    const d = draftFrom(refiLoan, application, properties)
    expect(d.loan.estimatedTaxRatePct).toBeNull()
    expect(d.loan.estimatedAnnualInsurance).toBeNull()
  })

  it('shows each job by its main figure and keeps the rest of the pay', () => {
    const [primary, co] = draftFrom(purchase, application, rentalOnly).borrowers
    expect(primary.creditScore).toBe(700)
    expect(primary.jobs[0]).toMatchObject({ id: 'e1', monthly: 6500, otherPay: 400, selfEmployed: false })
    expect(co.jobs[0]).toMatchObject({ id: 'e2', monthly: -250, otherPay: 0, selfEmployed: true })
    expect(primary.otherIncomes[0]).toMatchObject({ incomeType: 'child_support', monthly: 600 })
  })

  it('figures the loan from the down payment on a purchase', () => {
    const l = draftFrom(purchase, application, rentalOnly).loan
    expect(draftLoanAmount(true, l)).toBe(380_000)
    expect(draftLoanAmount(true, { ...l, downPaymentMode: 'amount', downPaymentAmount: 50_000 })).toBe(350_000)
    expect(draftLoanAmount(true, { ...l, purchasePrice: null })).toBeNull()
    expect(draftLoanAmount(false, { ...l, loanAmount: 200_000 })).toBe(200_000)
  })
})

describe('live figures', () => {
  const draft = draftFrom(purchase, application, rentalOnly)
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
  const saved = draftFrom(purchase, application, rentalOnly, false)
  const draft = draftFrom(purchase, application, rentalOnly)

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
      debts: [...draft.debts, { key: 'new-3', id: null, contactId: 'c-1', liabilityType: 'installment', creditorName: 'Student loan', monthlyPayment: 200, toBePaidOff: false, unpaidBalance: null }],
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
    const refiSaved = draftFrom(refiLoan, application, properties, false)
    const c = prequalChanges(false, refiSaved, { ...refiSaved, loan: { ...refiSaved.loan, loanAmount: 360_000 } })
    expect(c.loan).toEqual({ loanAmount: 360_000 })
  })
})

describe('changing the loan type', () => {
  const l = draftFrom(purchase, application, rentalOnly).loan

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

describe('prequal upgrades', () => {
  // A purchase where they own a home with a $1,100/mo mortgage (150k balance), $2,000 rent, 250k value.
  const base = draftFrom(purchase, application, rentalOnly)
  const withPlan = (plan: 'keep' | 'rent' | 'sell'): PrequalDraft => ({ ...base, properties: base.properties.map((h) => ({ ...h, plan })) })

  it('reads the plan for each owned home from the saved record', () => {
    expect(base.properties).toHaveLength(1)
    expect(base.properties[0]).toMatchObject({ addressLine: '7 Rental Ave', plan: 'rent', monthlyRent: 2000, sellingCostPct: 8 })
  })

  it('keep counts the full payment as debt, rent nets 75% of rent, sell adds proceeds', () => {
    const keep = prequalSummary(purchase, withPlan('keep'), rentalOnly)
    expect(keep.otherDebts).toBe(750 + 1500) // car + child support + the home's 1,500 payment
    const rent = prequalSummary(purchase, withPlan('rent'), rentalOnly)
    expect(rent.otherDebts).toBe(750) // 75% of 2,000 covers the 1,500 payment exactly
    const sell = prequalSummary(purchase, withPlan('sell'), rentalOnly)
    expect(sell.otherDebts).toBe(750)
    expect(sell.saleProceeds).toBe(80_000) // 250k − 8% − 150k
    expect(sell.funds).toBe(sell.savings.downPayment + 80_000)
  })

  it('splits savings by use, counts depletion income and figures reserves', () => {
    const d: PrequalDraft = {
      ...base,
      assets: [
        { key: 'a1', id: null, contactId: 'c-1', assetType: 'checking', institutionName: '', amount: 40_000, useAs: 'down_payment' },
        { key: 'a2', id: null, contactId: 'c-1', assetType: 'retirement', amount: 216_000, institutionName: '', useAs: 'depletion' },
        { key: 'a3', id: null, contactId: 'c-1', assetType: 'savings', amount: 9_000, institutionName: '', useAs: 'reserves' },
      ],
    }
    const s = prequalSummary(purchase, d, rentalOnly)
    expect(s.depletionIncome).toBe(420) // 216,000 × 70% ÷ 360
    expect(s.totalIncome).toBe(7250 + 420)
    expect(s.funds).toBe(40_000)
    // 40,000 − 29,000 cash needed (26,000 + the 3,000 card payoff) = 11,000 left + 9,000 reserve account
    expect(s.reserves?.amount).toBe(20_000)
    expect(s.reserves?.months).toBe(round1(20_000 / s.housing!))
  })

  it('adds payoff balances to the cash needed and drops their payments', () => {
    const d: PrequalDraft = { ...base, debts: base.debts.map((x) => (x.id === 'l1' ? { ...x, toBePaidOff: true } : x)) }
    const s = prequalSummary(purchase, d, rentalOnly)
    expect(s.otherDebts).toBe(300) // only child support stays
    expect(s.payoffs).toBe(18_000 + 3_000) // car plus the card already marked paid off
    expect(s.cashNeeded).toBe(26_000 + 21_000)
  })

  it('shows buying power at 43, 45 and 50% and a use-all down payment', () => {
    const s = prequalSummary(purchase, base, rentalOnly)
    expect(s.buyingPower.map((b) => b.dtiPct)).toEqual([43, 45, 50])
    const [p43, p45, p50] = s.buyingPower.map((b) => b.price!)
    expect(p43).toBeLessThan(p45)
    expect(p45).toBeLessThan(p50)
    expect(p45).toBe(s.max!.price)
    // 40,000 funds − 6,000 closing costs − 3,000 card payoff
    expect(s.useAllDownPayment).toBe(31_000)
  })

  it('saves plan, rent and value changes for homes', () => {
    const saved = draftFrom(purchase, application, rentalOnly, false)
    const sell = withPlan('sell')
    expect(prequalChanges(true, saved, sell).properties.map((h) => h.plan)).toEqual(['sell'])
    expect(prequalChanges(true, saved, { ...sell, properties: sell.properties.map((h) => ({ ...h, plan: 'rent' as const, sellingCostPct: 6 })) }).properties).toEqual([])
  })
})

const round1 = (n: number) => Math.round(n * 10) / 10
