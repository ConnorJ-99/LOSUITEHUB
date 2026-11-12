import { describe, expect, it } from 'vitest'
import { approvalAt, approvalConcessions, approvalDownPct, approvalFunds, approvalTypeFor, giftAllowed, maxApproval, mortgageTypeFor, type MaxApprovalInput } from './maxApproval'

const base: MaxApprovalInput = {
  loanType: 'conventional',
  occupancy: 'primary',
  monthlyIncome: 10_000,
  monthlyDebts: 500,
  assets: 500_000,
  giftAmount: 0,
  nonQmAllowsGift: true,
  noteRatePct: 6.5,
  termMonths: 360,
  downPaymentPct: 5,
  maxDtiPct: 45,
  maxMonthlyPayment: null,
  taxRatePct: 2.2,
  insuranceRatePct: 1,
  monthlyHoa: 0,
  miRatePct: null,
  upfrontFeePct: null,
  sellerConcessionPct: 0,
  nonQmConcessionCapPct: 6,
  reserveMonths: 0,
  loanLimit: null,
}

describe('loan type helpers', () => {
  it('maps Non-QM to the saved "other" type and back', () => {
    expect(mortgageTypeFor('non_qm')).toBe('other')
    expect(approvalTypeFor('other')).toBe('non_qm')
    expect(approvalTypeFor('fha')).toBe('fha')
    expect(approvalTypeFor(null)).toBe('conventional')
    expect(approvalTypeFor('usda_rural')).toBe('conventional')
  })

  it('suggests 15% down on a conventional investment home', () => {
    expect(approvalDownPct('conventional', 'investment')).toBe(15)
    expect(approvalDownPct('conventional', 'primary')).toBe(5)
    expect(approvalDownPct('fha', 'primary')).toBe(3.5)
    expect(approvalDownPct('va', 'primary')).toBe(0)
  })

  it('allows gifts except on investment homes; Non-QM follows the switch', () => {
    expect(giftAllowed('conventional', 'primary', false)).toBe(true)
    expect(giftAllowed('conventional', 'investment', true)).toBe(false)
    expect(giftAllowed('non_qm', 'investment', true)).toBe(true)
    expect(giftAllowed('non_qm', 'primary', false)).toBe(false)
  })

  it('splits 1003 assets into own funds and cash gifts', () => {
    const funds = approvalFunds([
      { assetType: 'checking', amount: 20_000, useAs: 'down_payment' },
      { assetType: 'retirement', amount: 50_000, useAs: 'reserves' },
      { assetType: 'retirement', amount: 900_000, useAs: 'depletion' },
      { assetType: 'gift_cash', amount: 15_000, useAs: 'down_payment' },
      { assetType: 'gift_equity', amount: 30_000, useAs: 'down_payment' },
    ])
    expect(funds).toEqual({ own: 70_000, gift: 15_000 })
  })
})

describe('seller concessions', () => {
  const c = (over: Partial<Parameters<typeof approvalConcessions>[0]>) =>
    approvalConcessions({ loanType: 'conventional', occupancy: 'primary', price: 400_000, loanAmount: 380_000, costs: 12_000, enteredPct: 0, nonQmCapPct: 5, ...over })

  it('caps conventional by LTV', () => {
    expect(c({ loanAmount: 380_000 }).maxAllowedPct).toBe(3) // 95%
    expect(c({ loanAmount: 340_000 }).maxAllowedPct).toBe(6) // 85%
    expect(c({ loanAmount: 300_000 }).maxAllowedPct).toBe(9) // 75%
    expect(c({ loanAmount: 300_000, occupancy: 'investment' }).maxAllowedPct).toBe(2)
  })

  it('FHA 6%, VA 4% plus closing costs, Non-QM as entered', () => {
    expect(c({ loanType: 'fha' }).maxAllowed).toBe(24_000)
    expect(c({ loanType: 'va' }).maxAllowed).toBe(16_000 + 12_000)
    expect(c({ loanType: 'non_qm' }).maxAllowed).toBe(20_000)
  })

  it('applies the lowest of entered, allowed and usable, and warns', () => {
    const over = c({ enteredPct: 6 }) // $24,000 on a 3% cap, $12,000 of costs
    expect(over).toMatchObject({ entered: 24_000, maxAllowed: 12_000, maxUsable: 12_000, applied: 12_000, overAllowed: true, overUsable: true })
    const fine = c({ loanType: 'fha', enteredPct: 2 })
    expect(fine).toMatchObject({ applied: 8_000, overAllowed: false, overUsable: false })
    const tooMuchForCosts = c({ loanType: 'fha', enteredPct: 4 })
    expect(tooMuchForCosts).toMatchObject({ applied: 12_000, overAllowed: false, overUsable: true })
  })
})

describe('max approval', () => {
  it('says what is missing', () => {
    expect(maxApproval({ ...base, monthlyIncome: 0 }).missing).toMatch(/income/)
    expect(maxApproval({ ...base, noteRatePct: null }).missing).toMatch(/rate/)
  })

  it('is limited by DTI when cash is plentiful, and the max passes while $1,000 more does not', () => {
    const r = maxApproval(base)
    expect(r.limitedBy).toBe('dti')
    expect(r.max!.dti.back!).toBeLessThanOrEqual(45)
    expect(approvalAt(r.max!.price + 1_000, base).passes.dti).toBe(false)
    expect(r.max!.price % 1_000).toBe(0)
  })

  it('a payment cap lower than the DTI room sets the max', () => {
    const r = maxApproval({ ...base, maxMonthlyPayment: 2_500 })
    expect(r.limitedBy).toBe('payment')
    expect(r.max!.payment.total).toBeLessThanOrEqual(2_500)
  })

  it('cash to close: down payment, costs and reserves against assets + gift', () => {
    const r = maxApproval({ ...base, assets: 20_000 })
    expect(r.limitedBy).toBe('cash')
    const m = r.max!
    expect(m.cashNeeded).toBeLessThanOrEqual(m.funds)
    // 5% down + 3% costs = 8% of the price ≈ $20,000
    expect(m.price).toBe(250_000)
    // A gift raises it; the gift counts like any other funds.
    const withGift = maxApproval({ ...base, assets: 20_000, giftAmount: 10_000 })
    expect(withGift.max!.price).toBe(375_000)
    expect(withGift.limitedBy).toBe('cash')
    expect(withGift.max!.gift).toEqual({ entered: 10_000, counted: 10_000, allowed: true })
  })

  it('ignores a gift on an investment home', () => {
    const r = maxApproval({ ...base, occupancy: 'investment', assets: 20_000, giftAmount: 50_000, downPaymentPct: 15 })
    expect(r.max!.gift.counted).toBe(0)
    expect(r.limitedBy).toBe('cash')
  })

  it('seller concessions lower the cash needed, up to the costs', () => {
    const without = maxApproval({ ...base, loanType: 'fha', downPaymentPct: 3.5, assets: 20_000 })
    const withConc = maxApproval({ ...base, loanType: 'fha', downPaymentPct: 3.5, assets: 20_000, sellerConcessionPct: 3 })
    expect(withConc.max!.price).toBeGreaterThan(without.max!.price)
    expect(withConc.max!.concessions.applied).toBeLessThanOrEqual(withConc.max!.costs)
  })

  it('debts paid off at closing come out of the funds', () => {
    const a = approvalAt(300_000, { ...base, payoffs: 5_000 })
    const b = approvalAt(300_000, base)
    expect(a.cashToClose - b.cashToClose).toBe(5_000)
  })

  it('reserves count against funds', () => {
    const r = maxApproval({ ...base, assets: 40_000, reserveMonths: 6 })
    expect(r.max!.reservesRequired).toBeCloseTo(r.max!.payment.total * 6, 0)
    expect(r.max!.cashNeeded).toBeLessThanOrEqual(r.max!.funds)
  })

  it('stops at the county loan limit', () => {
    const r = maxApproval({ ...base, monthlyIncome: 60_000, loanLimit: 500_000 })
    expect(r.limitedBy).toBe('loan_limit')
    expect(r.max!.loanAmount).toBeLessThanOrEqual(500_000)
    expect(r.max!.price).toBe(526_000)
  })

  it('FHA always uses the MIP schedule and VA has no monthly MI', () => {
    const fha = approvalAt(300_000, { ...base, loanType: 'fha', downPaymentPct: 3.5, miRatePct: 0 })
    expect(fha.mi.annualRatePct).toBe(0.55)
    expect(fha.mi.financedFee).toBeGreaterThan(0)
    const va = approvalAt(300_000, { ...base, loanType: 'va', downPaymentPct: 0 })
    expect(va.payment.mortgageInsurance).toBe(0)
    expect(va.mi.upfrontFeePct).toBe(2.15)
    const nonQm = approvalAt(300_000, { ...base, loanType: 'non_qm', miRatePct: 0.3 })
    expect(nonQm.mi.annualRatePct).toBe(0.3)
  })

  it('names the blocking limit when nothing fits', () => {
    const r = maxApproval({ ...base, monthlyDebts: 5_000 })
    expect(r.max).toBeNull()
    expect(r.limitedBy).toBe('dti')
  })

  it('uses a fee-list estimate for costs when given', () => {
    const r = approvalAt(400_000, { ...base, costsAt: (_p, loan) => 5_000 + loan * 0.01 })
    expect(r.costs).toBe(5_000 + 3_800)
  })
})
