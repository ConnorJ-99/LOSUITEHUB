import { describe, expect, it } from 'vitest'
import { approvalDefaults, approvalFormFrom, approvalInput, type ApprovalFacts } from './maxApproval'

const facts: ApprovalFacts = { income: 9_000, debts: 400, assets: 30_000, gift: 10_000, payoffs: 0, conformingLimit: 832_750, fhaLimit: 557_750, defaultInsurancePct: null }
const loan = { mortgageType: 'fha' as const, noteRate: 6.25, termMonths: 360, upfrontFeePct: null }

describe('max approval form', () => {
  it('starts from the loan: occupancy, tax, HOA, and the seller credit as a percent of the price', () => {
    const f = approvalFormFrom({ occupancy: 'primary', estimatedTaxRatePct: 2.1, estimatedMonthlyHoa: 50, sellerCredits: 9_000, purchasePrice: 300_000 })
    expect(f).toMatchObject({ occupancy: 'primary', taxRatePct: 2.1, monthlyHoa: 50, sellerConcessionPct: 3, monthlyIncome: null })
  })

  it('fills blanks from the 1003 and the loan type, and typed figures win', () => {
    const form = approvalFormFrom({ occupancy: 'primary', estimatedTaxRatePct: null, estimatedMonthlyHoa: null, sellerCredits: null, purchasePrice: null })
    const input = approvalInput(loan, form, facts)
    expect(input).toMatchObject({ loanType: 'fha', monthlyIncome: 9_000, monthlyDebts: 400, assets: 30_000, giftAmount: 10_000, downPaymentPct: 3.5, maxDtiPct: 50, taxRatePct: 2.2, insuranceRatePct: 1, loanLimit: 557_750, reserveMonths: 0 })
    const typed = approvalInput(loan, { ...form, monthlyIncome: 12_000, maxDtiPct: 43, loanLimit: 600_000 }, facts)
    expect(typed).toMatchObject({ monthlyIncome: 12_000, maxDtiPct: 43, loanLimit: 600_000 })
  })

  it('uses the right county limit per loan type, none for VA and Non-QM', () => {
    const form = approvalFormFrom({ occupancy: 'investment', estimatedTaxRatePct: null, estimatedMonthlyHoa: null, sellerCredits: null, purchasePrice: null })
    expect(approvalDefaults('conventional', form, facts)).toMatchObject({ loanLimit: 832_750, downPaymentPct: 15, reserveMonths: 6 })
    expect(approvalDefaults('va', form, facts).loanLimit).toBeNull()
    expect(approvalDefaults('non_qm', form, facts)).toMatchObject({ loanLimit: null, maxDtiPct: 50 })
  })
})
