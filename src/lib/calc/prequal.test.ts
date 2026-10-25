import { describe, expect, it } from 'vitest'
import { defaultMiRates, mortgageInsurance } from './mortgageInsurance'
import { estimatedCashToClose, loanForPrice, maxDtiFor, maxPurchasePrice, prequalChecks, purchasePayment, type MaxPurchaseInput, type PrequalCheckInput } from './prequal'

describe('mortgage insurance defaults', () => {
  it('follows the loan type and LTV', () => {
    expect(defaultMiRates('conventional', 80)).toEqual({ annualRatePct: 0, upfrontFeePct: 0 })
    expect(defaultMiRates('conventional', 80.01)).toEqual({ annualRatePct: 0.5, upfrontFeePct: 0 })
    expect(defaultMiRates(null, 95)).toEqual({ annualRatePct: 0.5, upfrontFeePct: 0 })
    expect(defaultMiRates('fha', 96.5)).toEqual({ annualRatePct: 0.55, upfrontFeePct: 1.75 })
    expect(defaultMiRates('fha', 90)).toEqual({ annualRatePct: 0.5, upfrontFeePct: 1.75 })
    expect(defaultMiRates('va', 100).upfrontFeePct).toBe(2.15)
    expect(defaultMiRates('va', 95).upfrontFeePct).toBe(1.5)
    expect(defaultMiRates('va', 90).upfrontFeePct).toBe(1.25)
    expect(defaultMiRates('usda_rural', 100)).toEqual({ annualRatePct: 0.35, upfrontFeePct: 1 })
  })

  it('applies overrides, including 0 for a VA-exempt borrower', () => {
    const r = mortgageInsurance({ mortgageType: 'va', baseLoanAmount: 300_000, ltvPct: 100, upfrontFeePct: 0 })
    expect(r).toMatchObject({ financedFee: 0, totalLoanAmount: 300_000, usesDefaultFee: false, usesDefaultRate: true })
  })
})

const terms = {
  downPayment: { kind: 'percent' as const, pct: 5 },
  noteRatePct: 6.5,
  termMonths: 360,
  taxRatePct: 2.2,
  annualInsurance: 3_000,
  monthlyHoa: null,
  mortgageType: 'conventional' as const,
}

describe('purchase payment', () => {
  it('figures the loan from the down payment', () => {
    expect(loanForPrice(400_000, { kind: 'percent', pct: 5 })).toBe(380_000)
    expect(loanForPrice(400_000, { kind: 'amount', amount: 25_000 })).toBe(375_000)
    expect(loanForPrice(20_000, { kind: 'amount', amount: 25_000 })).toBe(0)
  })

  it('includes taxes from the rate, insurance and PMI', () => {
    const r = purchasePayment(400_000, terms)
    expect(r.loanAmount).toBe(380_000)
    expect(r.ltv).toBe(95)
    // 2,401.86 P&I + 733.33 taxes + 250 insurance + 158.33 PMI
    expect(r.payment.total).toBe(3543.52)
  })
})

describe('max purchase price', () => {
  const input: MaxPurchaseInput = { ...terms, monthlyIncome: 10_000, otherMonthlyDebts: 500, maxDtiPct: 45 }

  it('finds the highest price whose payment fits the DTI limit', () => {
    const r = maxPurchasePrice(input)!
    expect(r.housingBudget).toBe(4_000)
    expect(r.price % 1_000).toBe(0)
    expect(r.payment.total).toBeLessThanOrEqual(4_000)
    expect(purchasePayment(r.price + 1_000, input).payment.total).toBeGreaterThan(4_000)
    expect(r.price).toBe(455_000) // 455k pays 3,996.39; 456k would pay 4,004.60
  })

  it('gets lower with more debt or FHA fees, higher with a bigger down payment', () => {
    const base = maxPurchasePrice(input)!.price
    expect(maxPurchasePrice({ ...input, otherMonthlyDebts: 1_000 })!.price).toBeLessThan(base)
    expect(maxPurchasePrice({ ...input, downPayment: { kind: 'percent', pct: 20 } })!.price).toBeGreaterThan(base)
    const fha = maxPurchasePrice({ ...input, mortgageType: 'fha', downPayment: { kind: 'percent', pct: 3.5 } })!
    expect(fha.mi.financedFee).toBeGreaterThan(0)
  })

  it('handles a fixed down payment amount crossing the 80% PMI line', () => {
    const r = maxPurchasePrice({ ...input, downPayment: { kind: 'amount', amount: 100_000 } })!
    expect(r.payment.total).toBeLessThanOrEqual(4_000)
    expect(purchasePayment(r.price + 1_000, { ...input, downPayment: { kind: 'amount', amount: 100_000 } }).payment.total).toBeGreaterThan(4_000)
  })

  it('returns nothing when debts use up the budget or terms are missing', () => {
    expect(maxPurchasePrice({ ...input, otherMonthlyDebts: 4_500 })).toBeNull()
    expect(maxPurchasePrice({ ...input, monthlyIncome: 0 })).toBeNull()
    expect(maxPurchasePrice({ ...input, termMonths: 0 })).toBeNull()
  })

  it('uses the default DTI by loan type', () => {
    expect([maxDtiFor('conventional'), maxDtiFor('fha'), maxDtiFor('va'), maxDtiFor('usda_rural'), maxDtiFor(null)]).toEqual([45, 50, 50, 41, 45])
  })
})

describe('cash to close estimate', () => {
  it('uses 3% of the price when closing costs are not entered', () => {
    expect(estimatedCashToClose(400_000, 380_000, null)).toEqual({ downPayment: 20_000, closingCosts: 12_000, closingCostsEstimated: true, total: 32_000 })
    expect(estimatedCashToClose(400_000, 380_000, 9_000).total).toBe(29_000)
  })
})

describe('prequal checks', () => {
  const ok: PrequalCheckInput = { mortgageType: 'conventional', creditScore: 700, ltvPct: 95, backDtiPct: 40, maxDtiPct: 45, cashNeeded: 32_000, funds: 40_000, isPurchase: true }
  const status = (i: PrequalCheckInput) => Object.fromEntries(prequalChecks(i).map((c) => [c.label, c.status]))

  it('passes a solid file', () => {
    expect(status(ok)).toEqual({ 'Credit score': 'pass', 'Down payment': 'pass', DTI: 'pass', 'Cash to close': 'pass' })
  })

  it('flags problems', () => {
    expect(status({ ...ok, creditScore: 600, backDtiPct: 48, funds: 10_000 })).toEqual({ 'Credit score': 'fail', 'Down payment': 'pass', DTI: 'fail', 'Cash to close': 'fail' })
    expect(prequalChecks({ ...ok, funds: 10_000 }).find((c) => c.label === 'Cash to close')?.detail).toMatch(/Short about \$22,000/)
    expect(status({ ...ok, ltvPct: 97 })['Down payment']).toBe('warn')
    expect(status({ ...ok, ltvPct: 98 })['Down payment']).toBe('fail')
  })

  it('handles FHA scores from 500 to 579', () => {
    const fha = { ...ok, mortgageType: 'fha' as const, creditScore: 560, ltvPct: 96.5 }
    expect(status(fha)).toMatchObject({ 'Credit score': 'warn', 'Down payment': 'fail' })
    expect(status({ ...fha, ltvPct: 90 })['Down payment']).toBe('pass')
  })

  it('asks for what is missing, and skips purchase checks on a refinance', () => {
    expect(status({ ...ok, creditScore: null, funds: null })).toMatchObject({ 'Credit score': 'unknown', 'Cash to close': 'unknown' })
    expect(Object.keys(status({ ...ok, isPurchase: false }))).toEqual(['Credit score', 'DTI'])
  })
})
