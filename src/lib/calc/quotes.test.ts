import { describe, expect, it } from 'vitest'
import { breakEven, categoryWinners, quoteFigures, sortQuotes, type QuoteDeal } from './quotes'

// Mockup 07: TBD purchase, $400,000, 5% down, $380,000, 30-year fixed, taxes 2.2% and HOI $150/mo.
const deal: QuoteDeal = { loanAmount: 380000, termMonths: 360, purchasePrice: 400000, payoffs: 0, monthlyTaxesInsurance: 883.33, monthlyHoa: 0, earnestMoney: 0, sellerCredits: 0 }
const uwm = quoteFigures({ id: 'UWM', rate: 7.5, closingCosts: 20000, lenderCredit: 0, monthlyMi: 120 }, deal)
const pennymac = quoteFigures({ id: 'PennyMac', rate: 7.3, closingCosts: 30000, lenderCredit: 0, monthlyMi: 118 }, deal)
const ad = quoteFigures({ id: 'A&D', rate: 7.875, closingCosts: 10000, lenderCredit: 0, monthlyMi: 125 }, deal)
const all = [uwm, pennymac, ad]
const ids = (fs: { id: string }[]) => fs.map((f) => f.id)

describe('mockup 07: three quotes on a TBD purchase', () => {
  it('payment, cash to close and 5-year cost per quote', () => {
    expect([uwm, pennymac, ad].map((f) => [f.principalAndInterest, f.cashToClose, f.totalPayment, Math.round(f.horizonCost)])).toEqual([
      [2657.02, 40000, 3660.35, 206621],
      [2605.17, 50000, 3606.5, 213390],
      [2755.26, 30000, 3763.59, 202816],
    ])
    expect(uwm.downPayment).toBe(20000)
  })
  it('sorts by each metric', () => {
    expect(ids(sortQuotes(all, 'rate'))).toEqual(['PennyMac', 'UWM', 'A&D'])
    expect(ids(sortQuotes(all, 'cash'))).toEqual(['A&D', 'UWM', 'PennyMac'])
    expect(ids(sortQuotes(all, 'payment'))).toEqual(['PennyMac', 'UWM', 'A&D'])
    expect(ids(sortQuotes(all, 'cost'))).toEqual(['A&D', 'UWM', 'PennyMac'])
    expect(categoryWinners(all)).toEqual({ rate: 'PennyMac', cash: 'A&D', payment: 'PennyMac', cost: 'A&D' })
  })
  it('break-even: 15.5, 8.1 and 10.6 years', () => {
    expect(breakEven(pennymac, uwm)).toEqual({ kind: 'breaks_even', payMoreUpFront: 'PennyMac', payLessUpFront: 'UWM', upFrontDifference: 10000, monthlyDifference: 53.85, months: 185.7, years: 15.5 })
    expect(breakEven(ad, uwm)).toMatchObject({ payMoreUpFront: 'UWM', payLessUpFront: 'A&D', upFrontDifference: 10000, monthlyDifference: 103.24, years: 8.1 })
    expect(breakEven(pennymac, ad)).toMatchObject({ payMoreUpFront: 'PennyMac', upFrontDifference: 20000, monthlyDifference: 157.09, years: 10.6 })
  })
  it('"never" when one option is cheaper both up front and monthly; "same" when equal', () => {
    const cheaper = quoteFigures({ id: 'Cheaper', rate: 7.25, closingCosts: 15000, lenderCredit: 0, monthlyMi: 110 }, deal)
    expect(breakEven(cheaper, uwm)).toEqual({ kind: 'never', better: 'Cheaper' })
    expect(breakEven(uwm, cheaper)).toEqual({ kind: 'never', better: 'Cheaper' })
    expect(breakEven(uwm, { ...uwm, id: 'Twin' })).toEqual({ kind: 'same' })
  })
  it('ties break by the next metric: rate → cash to close → payment', () => {
    const sameRate = quoteFigures({ id: 'Same rate, less cash', rate: 7.5, closingCosts: 18000, lenderCredit: 0, monthlyMi: 120 }, deal)
    expect(ids(sortQuotes([uwm, sameRate], 'rate'))).toEqual(['Same rate, less cash', 'UWM'])
  })
  it('credits lower cash to close; a refinance can give cash back', () => {
    expect(quoteFigures({ id: 'x', rate: 7.5, closingCosts: 20000, lenderCredit: 2000, monthlyMi: 0 }, { ...deal, earnestMoney: 5000, sellerCredits: 3000 }).cashToClose).toBe(30000)
    const refi = quoteFigures({ id: 'r', rate: 7.625, closingCosts: 24770.94, lenderCredit: 0, monthlyMi: 0 }, { ...deal, loanAmount: 465000, purchasePrice: null, payoffs: 390694 })
    expect(refi.cashToClose).toBe(-49535.06)
    expect(refi.principalAndInterest).toBe(3291.24)
  })
  it('the horizon can be 3 or 7 years', () => {
    expect(Math.round(quoteFigures({ id: 'u', rate: 7.5, closingCosts: 20000, lenderCredit: 0, monthlyMi: 120 }, deal, 3).horizonCost)).toBe(Math.round(40000 + 36 * 2777.02))
  })
})
