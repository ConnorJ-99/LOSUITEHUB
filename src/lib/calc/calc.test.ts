import { describe, expect, it } from 'vitest'
import {
  cashToClose,
  cltv,
  dti,
  ltv,
  monthlyInterestOnly,
  monthlyPrincipalAndInterest,
  pct,
  piti,
  qualifyingValue,
  round,
} from './index'

describe('round / pct', () => {
  it('rounds to cents', () => {
    expect(round(1.005)).toBe(1.01)
    expect(round(2.675)).toBe(2.68)
  })

  it('returns null instead of dividing by zero', () => {
    expect(pct(100, 0)).toBeNull()
    expect(pct(100, Number.NaN)).toBeNull()
  })
})

describe('ltv / cltv', () => {
  it('computes LTV as a percent', () => {
    expect(ltv(400_000, 500_000)).toBe(80)
    expect(ltv(388_000, 400_000)).toBe(97)
  })

  it('computes CLTV across all liens (HELOC case)', () => {
    // 1st lien 300k + new 2nd lien 100k on a 500k home
    expect(cltv([300_000, 100_000], 500_000)).toBe(80)
  })

  it('flags a scenario just over the 80% Texas cash-out cap', () => {
    expect(cltv([405_000], 500_000)).toBe(81)
  })

  it('returns null with no value', () => {
    expect(ltv(400_000, 0)).toBeNull()
    expect(cltv([1, 2], 0)).toBeNull()
  })

  it('uses the lower of price and appraisal on a purchase', () => {
    expect(qualifyingValue(490_000, 500_000)).toBe(490_000)
    expect(qualifyingValue(510_000, 500_000)).toBe(500_000)
    expect(qualifyingValue(510_000)).toBe(510_000)
  })
})

describe('payments', () => {
  it('matches a standard 30-year amortization', () => {
    // $400,000 at 6.5% for 360 months = $2,528.27
    expect(monthlyPrincipalAndInterest(400_000, 6.5, 360)).toBe(2528.27)
    // $300,000 at 7% for 180 months = $2,696.48
    expect(monthlyPrincipalAndInterest(300_000, 7, 180)).toBe(2696.48)
  })

  it('handles a 0% rate and empty loans', () => {
    expect(monthlyPrincipalAndInterest(360_000, 0, 360)).toBe(1000)
    expect(monthlyPrincipalAndInterest(0, 6.5, 360)).toBe(0)
  })

  it('computes interest-only payments', () => {
    expect(monthlyInterestOnly(400_000, 6)).toBe(2000)
  })

  it('builds a full PITI', () => {
    const result = piti({
      principal: 400_000,
      annualRatePct: 6.5,
      termMonths: 360,
      annualTaxes: 9_600,
      annualInsurance: 2_400,
      monthlyHoa: 50,
      monthlyMortgageInsurance: 120,
    })
    expect(result).toEqual({
      principalAndInterest: 2528.27,
      taxes: 800,
      insurance: 200,
      hoa: 50,
      mortgageInsurance: 120,
      total: 3698.27,
    })
  })
})

describe('dti', () => {
  it('computes front and back ratios', () => {
    expect(dti(3_000, 1_000, 10_000)).toEqual({ front: 30, back: 40 })
  })

  it('returns nulls with no income', () => {
    expect(dti(3_000, 1_000, 0)).toEqual({ front: null, back: null })
  })
})

describe('cashToClose', () => {
  it('nets down payment, costs and credits on a purchase', () => {
    const r = cashToClose({ isPurchase: true, purchasePrice: 400_000, baseLoanAmount: 380_000, closingCosts: 12_000, earnestMoney: 5_000, sellerCredits: 6_000 })
    expect(r).toMatchObject({ downPayment: 20_000, totalCredits: 11_000, cashToClose: 21_000, label: 'Cash to close' })
  })

  it('counts the lender credit, gift of equity and debts paid at closing', () => {
    const base = { isPurchase: true, purchasePrice: 385_000, baseLoanAmount: 371_525, closingCosts: 9_586, earnestMoney: 5_000, sellerCredits: 6_000 }
    const plain = cashToClose(base).cashToClose
    expect(cashToClose({ ...base, lenderCredit: 500 }).cashToClose).toBe(plain - 500)
    expect(cashToClose({ ...base, otherCredits: 2_000 }).cashToClose).toBe(plain - 2_000)
    expect(cashToClose({ ...base, debtsPaidAtClosing: 1_240 }).cashToClose).toBe(plain + 1_240)
  })

  it('leaves a financed fee out (it is inside the total loan, not the base loan)', () => {
    // FHA: base 371,525; UFMIP 6,502 financed. Cash uses the base loan only.
    expect(cashToClose({ isPurchase: true, purchasePrice: 385_000, baseLoanAmount: 371_525, closingCosts: 0 }).downPayment).toBe(13_475)
  })

  it('cash gifts lower what comes from the borrower, not the cash to close', () => {
    const r = cashToClose({ isPurchase: true, purchasePrice: 300_000, baseLoanAmount: 290_000, closingCosts: 8_000, cashGifts: 10_000 })
    expect(r.cashToClose).toBe(18_000)
    expect(r.fromOwnFunds).toBe(8_000)
  })

  it('refinance: payoffs + costs − the new loan; negative = cash to the borrower', () => {
    const r = cashToClose({ isPurchase: false, purchasePrice: null, baseLoanAmount: 465_000, closingCosts: 24_771, mortgagePayoffs: 390_694 })
    expect(r.cashToClose).toBe(-49_535)
    expect(r.label).toBe('Cash to borrower')
    expect(cashToClose({ isPurchase: false, purchasePrice: null, baseLoanAmount: 200_000, closingCosts: 5_000, mortgagePayoffs: 200_000 }).cashToClose).toBe(5_000)
  })
})
