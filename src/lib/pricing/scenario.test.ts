import { describe, expect, it } from 'vitest'
import type { FeeTemplate } from '@/lib/calc'
import { details as baseDetails } from '@/lib/mismo/testFixture'
import type { LoanDetails, Property } from '@/lib/api/types'
import { cashFigure, loanChangesFrom, otherFinancingFor, payoffsFor, priceScenario, scenarioFigures, scenarioFrom, type PricingScenario } from './scenario'

const t = (key: string, section: FeeTemplate['section'], amount: number): FeeTemplate => ({
  key, section, name: key, amountType: 'fixed', amount, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: 10, active: true,
})
// Sample fee list shaped to Connor's test case totals.
const templates = [t('admin', 'A', 1505.75), t('appraisal', 'B', 650), t('credit', 'B', 65), t('flood', 'B', 150), t('title', 'C', 2086.25), t('settlement', 'C', 750), t('recording', 'E', 223), t('misc', 'H', 150)]

const details = (over: Partial<LoanDetails> = {}): LoanDetails => ({ ...baseDetails, ...over })
const home = (over: Partial<Property> = {}): Property => ({
  id: 'p1', loanId: 'l1', addressLine: '1 Test St', city: null, state: 'TX', zip: null, county: null, propertyType: null, status: 'interested',
  listPrice: 400000, estimatedValue: null, annualTaxes: 8800, annualInsurance: 3600, monthlyHoa: 50, monthlyRent: null, isHomestead: false, listingUrl: null,
  unitCount: null, reoDisposition: null, reoOccupancy: null, rentalIncomeMethod: 'lease', scheduleEMonthlyIncome: null, createdAt: '', liens: [], ...over,
})

describe("Connor's test case as a scenario", () => {
  // Refi cash-out, value $620,000, loan $465,000, 7.625%, 360 months, 4 points, funding Oct 26, impounds waived.
  const loan = {
    id: 'l1',
    purpose: 'refinance_cash_out' as const,
    details: details({ loanAmount: 465000, noteRate: 7.625, termMonths: 360, mortgageType: 'conventional', hasInterestOnly: false, purchasePrice: null, estimatedFundingDate: '2026-10-26', impoundWaiver: 'all', discountPointsAmount: 18600, lenderCredits: null, subjectPropertyId: 'p1' }),
  }
  const s = scenarioFrom(loan, home({ estimatedValue: 620000, annualTaxes: 6300, annualInsurance: 1109.64, monthlyHoa: null }), 'Cash-out')

  it('starts from the loan and the home', () => {
    expect(s).toMatchObject({ loanAmount: 465000, propertyValue: 620000, purchasePrice: null, pointsPct: 4, taxesValue: 6300, taxesFactor: 'annual', impoundWaiver: 'all' })
  })
  it('payment, fees, closing costs', () => {
    const r = priceScenario(s, loan.purpose, templates, [])
    expect(r.figures.ltvPct).toBe(75)
    expect(r.figures.payment).toMatchObject({ principalAndInterest: 3291.24, hoi: 92.47, taxes: 525, mi: 0 })
    expect(r.figures.pitia).toBe(3908.71)
    expect(r.totals).toEqual({ A: 20105.75, B: 865, C: 2836.25, E: 223, F: 590.94, G: 0, H: 150 })
    expect(r.closingCosts).toBe(24770.94)
  })
  it('Use for this loan writes the terms to the loan and taxes and insurance to the home', () => {
    const c = loanChangesFrom({ ...s, id: 's1' } as PricingScenario, loan.purpose, 24770.94, 590.94)
    expect(c.loan).toMatchObject({ loanAmount: 465000, noteRate: 7.625, discountPointsAmount: 18600, estimatedClosingCosts: 24180, prepaidItemsAmount: 590.94, pricingScenarioId: 's1', subjectPropertyId: 'p1' })
    expect(c.loan).not.toHaveProperty('purchasePrice')
    expect(c.property).toEqual({ annualTaxes: 6300, annualInsurance: 1109.64, monthlyHoa: null, estimatedValue: 620000 })
  })
})

describe('existing mortgages and cash', () => {
  const lien = (over: Partial<Property['liens'][number]>): Property['liens'][number] => ({
    id: 'x', propertyId: 'p1', position: 'first', lender: null, balance: 300000, noteRate: 3, monthlyPayment: 1800, isHeloc: false, originatedOn: null, isTexasCashOut: false, toBePaidOff: false, creditLimit: null, mortgageType: null, ...over,
  })
  const withLiens = home({ liens: [lien({}), lien({ id: 'y', position: 'second', balance: 40000, monthlyPayment: 400 })] })

  it('a refinance pays off the first lien; a second stays unless marked', () => {
    expect(payoffsFor('refinance_cash_out', withLiens)).toBe(300000)
    expect(otherFinancingFor('refinance_cash_out', withLiens)).toBe(400)
    const marked = home({ liens: [lien({}), lien({ id: 'y', position: 'second', balance: 40000, toBePaidOff: true })] })
    expect(payoffsFor('refinance_rate_term', marked)).toBe(340000)
  })
  it('a HELOC keeps the first lien in the payment', () => {
    expect(payoffsFor('heloc', withLiens)).toBe(0)
    expect(otherFinancingFor('heloc', withLiens)).toBe(2200)
  })
  it("Connor's test case: $49,535.06 to the borrower", () => {
    expect(cashFigure({ purpose: 'refinance_cash_out', purchasePrice: null, totalLoanAmount: 465000, closingCosts: 24770.94, payoffs: 390694, earnestMoney: 0, sellerCredits: 0 })).toEqual({ label: 'Cash to borrower', amount: 49535.06 })
  })
  it('a purchase brings cash to close', () => {
    expect(cashFigure({ purpose: 'purchase', purchasePrice: 400000, totalLoanAmount: 380000, closingCosts: 9000, payoffs: 0, earnestMoney: 4000, sellerCredits: 3000 })).toEqual({ label: 'Cash to close', amount: 22000 })
    expect(payoffsFor('purchase', withLiens)).toBe(0)
  })
})

describe('Push to pricer', () => {
  const purchase = { id: 'l1', purpose: 'purchase' as const, details: details({ purchasePrice: 300000, loanAmount: 285000, subjectPropertyId: null, estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: 3600 }) }

  it('another house keeps the same down payment and uses its own taxes, insurance and HOA', () => {
    const s = scenarioFrom(purchase, home(), '1 Test St')
    expect(s).toMatchObject({ propertyId: 'p1', purchasePrice: 400000, propertyValue: 400000, loanAmount: 380000, taxesValue: 8800, insuranceValue: 3600, monthlyHoa: 50 })
  })
  it('without a house, uses the loan and its estimates', () => {
    const s = scenarioFrom(purchase, null, 'Option 1')
    expect(s).toMatchObject({ propertyId: null, purchasePrice: 300000, loanAmount: 285000, taxesValue: 2.2, taxesFactor: 'pct_of_value', insuranceValue: 3600 })
    expect(scenarioFigures(s).payment.taxes).toBe(550)
    const c = loanChangesFrom({ ...s, id: 's2' } as PricingScenario, 'purchase', 9000, 2000)
    expect(c.property).toBeNull()
    expect(c.loan).toMatchObject({ purchasePrice: 300000, estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: 3600 })
  })
  it('FHA: the financed upfront fee is in the payment, and MI is calculated unless typed', () => {
    const s = { ...scenarioFrom(purchase, null, 'FHA'), mortgageType: 'fha' as const, loanAmount: 289500, noteRate: 6, termMonths: 360 }
    const f = scenarioFigures(s)
    expect(f.financedFee).toBe(5066.25)
    expect(f.totalLoanAmount).toBe(294566.25)
    expect(f.payment.mi).toBe(132.69)
    expect(scenarioFigures({ ...s, monthlyMi: 100 }).payment.mi).toBe(100)
  })
})
