import { describe, expect, it } from 'vitest'
import { breakEven, categoryWinners, sortQuotes, type FeeTemplate } from '@/lib/calc'
import { details as baseDetails } from '@/lib/mismo/testFixture'
import { compareQuotes, quoteClosingCosts, quoteDeal, type CompareContext, type SavedQuote } from './compare'
import { scenarioFrom } from './scenario'

// Mockup 07: TBD purchase (no property), $400,000, 5% down, $380,000, 30-year fixed, taxes 2.2%, HOI $150/mo.
const tbd = {
  ...scenarioFrom({ id: 'l1', purpose: 'purchase', details: { ...baseDetails, purchasePrice: 400000, loanAmount: 380000, termMonths: 360, mortgageType: 'conventional', estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: null, subjectPropertyId: null } }, null, 'TBD purchase'),
  insuranceValue: 150,
  insuranceFactor: 'monthly' as const,
}
const ctx: CompareContext = { purpose: 'purchase', scenario: tbd, property: null, templates: [], overrides: [], earnestMoney: 0, sellerCredits: 0 }
const quote = (id: string, rate: number, closingCosts: number, mi: number): SavedQuote => ({ id, optionId: id, pricingScenarioId: 's', rate, lockDays: 30, pointsPct: 0, lenderCredit: 0, closingCosts, closingCostsFromFeeSheet: false, monthlyMi: mi, quoteDate: '2026-10-26', notes: null })
const quotes = [quote('UWM', 7.5, 20000, 120), quote('PennyMac', 7.3, 30000, 118), quote('A&D', 7.875, 10000, 125)]

describe('mockup 07 through a TBD pricing scenario', () => {
  it('the deal: no property, taxes 2.2% and HOI $150 a month = $883.33', () => {
    expect(tbd.propertyId).toBeNull()
    expect(quoteDeal(ctx)).toEqual({ loanAmount: 380000, termMonths: 360, purchasePrice: 400000, payoffs: 0, monthlyTaxesInsurance: 883.33, monthlyHoa: 0, earnestMoney: 0, sellerCredits: 0 })
  })
  it('the three cards, sorting and break-even match the mockup', () => {
    const figs = compareQuotes(quotes, ctx)
    expect(figs.map((f) => [f.id, f.cashToClose, f.totalPayment, Math.round(f.horizonCost)])).toEqual([
      ['UWM', 40000, 3660.35, 206621],
      ['PennyMac', 50000, 3606.5, 213390],
      ['A&D', 30000, 3763.59, 202816],
    ])
    expect(sortQuotes(figs, 'rate')[0].id).toBe('PennyMac')
    expect(categoryWinners(figs)).toEqual({ rate: 'PennyMac', cash: 'A&D', payment: 'PennyMac', cost: 'A&D' })
    expect(breakEven(figs[1], figs[0])).toMatchObject({ years: 15.5 })
  })
  it('mortgage insurance left blank is calculated (conventional, 95% LTV: 0.5% a year)', () => {
    const [f] = compareQuotes([{ ...quotes[0], monthlyMi: null }], ctx)
    expect(f.mi).toBe(158.33)
  })
})

describe('"Use fee sheet"', () => {
  const fees: FeeTemplate[] = [{ key: 'appraisal', section: 'B', name: 'Appraisal', amountType: 'fixed', amount: 650, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: 10, active: true }]
  it("runs the scenario's fees at the quote's rate and points", () => {
    const withFees = { ...ctx, templates: fees, scenario: { ...tbd, estimatedFundingDate: null } }
    const q = { ...quotes[0], closingCosts: null, closingCostsFromFeeSheet: true, pointsPct: 1 }
    // 1% of $380,000 = $3,800 points + $650 appraisal + a year of insurance prepaid ($1,800) + 3 months each of insurance ($450) and taxes (3 × $733.33) in escrow.
    expect(quoteClosingCosts(q, withFees)).toBe(8899.99)
    expect(quoteClosingCosts({ ...q, pointsPct: 0 }, withFees)).toBe(5099.99)
  })
})
