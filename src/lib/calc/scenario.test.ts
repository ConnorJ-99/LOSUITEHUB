import { describe, expect, it } from 'vitest'
import { computeScenario, proposedHousingPayment, type ScenarioInput } from './scenario'

const home = { estimatedValue: 500_000, annualTaxes: 9_600, annualInsurance: 2_400, monthlyHoa: 50, monthlyRent: null }

describe('computeScenario', () => {
  it('purchase: lower of price and value, down payment, full PITI', () => {
    const r = computeScenario({
      purpose: 'purchase',
      purchasePrice: 400_000,
      loanAmount: 380_000,
      noteRatePct: 6.5,
      termMonths: 360,
      property: { ...home, estimatedValue: 410_000 },
      liens: [],
    })
    expect(r.value).toBe(400_000)
    expect(r.ltv).toBe(95)
    expect(r.cltv).toBe(95)
    expect(r.downPayment).toEqual({ amount: 20_000, percent: 5 })
    // 380k @ 6.5% / 30yr = 2,401.86 + 800 taxes + 200 insurance + 50 HOA
    // + 158.33 PMI (conventional over 80% LTV, 0.5% a year)
    expect(r.payment?.mortgageInsurance).toBe(158.33)
    expect(r.payment?.total).toBe(3610.19)
  })

  it('FHA finances the upfront premium and adds monthly MIP', () => {
    const r = computeScenario({ purpose: 'purchase', purchasePrice: 400_000, loanAmount: 386_000, noteRatePct: 6.5, termMonths: 360, property: null, liens: [], mortgageType: 'fha' })
    expect(r.ltv).toBe(96.5)
    expect(r.mi).toMatchObject({ upfrontFeePct: 1.75, financedFee: 6755, totalLoanAmount: 392_755, annualRatePct: 0.55, monthly: 176.92 })
    // P&I on 392,755 @ 6.5% / 30yr
    expect(r.payment?.principalAndInterest).toBe(2482.48)
  })

  it('uses tax, insurance and HOA estimates until the home has its own figures', () => {
    const estimates = { taxRatePct: 2.2, annualInsurance: 3_000, monthlyHoa: 40 }
    const noHome = computeScenario({ purpose: 'purchase', purchasePrice: 400_000, loanAmount: 320_000, noteRatePct: 6.5, termMonths: 360, property: null, liens: [], estimates })
    expect(noHome.payment).toMatchObject({ taxes: 733.33, insurance: 250, hoa: 40, mortgageInsurance: 0 })
    const withHome = computeScenario({ purpose: 'purchase', purchasePrice: 400_000, loanAmount: 320_000, noteRatePct: 6.5, termMonths: 360, property: { ...home, monthlyHoa: null }, liens: [], estimates })
    // The home's own taxes and insurance win; it has no HOA figure, so the estimate fills in.
    expect(withHome.payment).toMatchObject({ taxes: 800, insurance: 200, hoa: 40 })
  })

  it('respects mortgage insurance overrides', () => {
    const base = { purpose: 'purchase' as const, purchasePrice: 400_000, loanAmount: 400_000, noteRatePct: 6, termMonths: 360, property: null, liens: [] }
    expect(computeScenario({ ...base, mortgageType: 'va' }).mi).toMatchObject({ upfrontFeePct: 2.15, monthly: 0 })
    expect(computeScenario({ ...base, mortgageType: 'va', upfrontFeePct: 0 }).mi).toMatchObject({ financedFee: 0, totalLoanAmount: 400_000 })
    expect(computeScenario({ ...base, loanAmount: 360_000, miRatePct: 0.3 }).mi?.monthly).toBe(90)
  })

  it('purchase without a property yet uses the price', () => {
    const r = computeScenario({ purpose: 'purchase', purchasePrice: 400_000, loanAmount: 360_000, noteRatePct: null, termMonths: 360, property: null, liens: [] })
    expect(r.value).toBe(400_000)
    expect(r.ltv).toBe(90)
    expect(r.payment).toBeNull()
  })

  it('cash-out refinance: home value, existing 2nd counts toward CLTV, savings vs current 1st', () => {
    const r = computeScenario({
      purpose: 'refinance_cash_out',
      purchasePrice: null,
      loanAmount: 350_000,
      noteRatePct: 6.5,
      termMonths: 360,
      property: home,
      liens: [
        { position: 'first', balance: 280_000, monthlyPayment: 2_400, noteRate: 7.5 },
        { position: 'second', balance: 30_000, monthlyPayment: 300, noteRate: 9 },
      ],
    })
    expect(r.value).toBe(500_000)
    expect(r.ltv).toBe(70)
    expect(r.cltv).toBe(76)
    expect(r.firstLienBalance).toBe(280_000)
    expect(r.payment?.principalAndInterest).toBe(2212.24)
    expect(r.refinance).toEqual({ monthlySavings: 187.76, rateReduction: 1, breakevenMonths: null })
  })

  it('HELOC: CLTV includes the 1st lien and payment is interest-only', () => {
    const r = computeScenario({
      purpose: 'heloc',
      purchasePrice: null,
      loanAmount: 100_000,
      noteRatePct: 8.4,
      termMonths: null,
      property: home,
      liens: [{ position: 'first', balance: 300_000, monthlyPayment: 2_000, noteRate: 3 }],
    })
    expect(r.ltv).toBe(20)
    expect(r.cltv).toBe(80)
    expect(r.payment?.total).toBe(700)
    expect(r.refinance).toBeNull()
  })

  it('HELOAN amortizes the 2nd lien only', () => {
    const r = computeScenario({
      purpose: 'heloan',
      purchasePrice: null,
      loanAmount: 60_000,
      noteRatePct: 9,
      termMonths: 180,
      property: home,
      liens: [{ position: 'first', balance: 250_000, monthlyPayment: null, noteRate: null }],
    })
    expect(r.cltv).toBe(62)
    expect(r.payment?.total).toBe(608.56)
    expect(r.payment?.taxes).toBe(0)
  })

  it('DSCR: rent over PITIA', () => {
    const input: ScenarioInput = {
      purpose: 'investment_dscr',
      purchasePrice: 300_000,
      loanAmount: 225_000,
      noteRatePct: 7.5,
      termMonths: 360,
      property: { estimatedValue: 300_000, annualTaxes: 6_000, annualInsurance: 1_800, monthlyHoa: null, monthlyRent: 2_400 },
      liens: [],
    }
    const r = computeScenario(input)
    // 225k @ 7.5% / 30yr = 1,573.23 + 500 + 150 = 2,223.23 PITIA
    expect(r.payment?.total).toBe(2223.23)
    expect(r.dscr).toBe(1.08)
    expect(r.ltv).toBe(75)
  })

  it('returns nulls instead of guessing when data is missing', () => {
    const r = computeScenario({ purpose: 'refinance_rate_term', purchasePrice: null, loanAmount: 200_000, noteRatePct: 6, termMonths: 360, property: null, liens: [] })
    expect(r.value).toBeNull()
    expect(r.ltv).toBeNull()
    expect(r.cltv).toBeNull()
    expect(r.refinance).toBeNull()
    expect(r.payment?.total).toBe(1199.1)
  })
})

describe('proposedHousingPayment', () => {
  it('is the new PITI on a purchase or refinance', () => {
    const input: ScenarioInput = { purpose: 'purchase', purchasePrice: 400_000, loanAmount: 380_000, noteRatePct: 6.5, termMonths: 360, property: home, liens: [] }
    expect(proposedHousingPayment(input, computeScenario(input))).toBe(3610.19)
  })

  it('adds the kept 1st lien, taxes and insurance on a HELOC', () => {
    const input: ScenarioInput = {
      purpose: 'heloc',
      purchasePrice: null,
      loanAmount: 100_000,
      noteRatePct: 8.4,
      termMonths: null,
      property: home,
      liens: [{ position: 'first', balance: 300_000, monthlyPayment: 2_000, noteRate: 3 }],
    }
    // 700 interest-only + 2,000 1st lien + 800 taxes + 200 insurance + 50 HOA
    expect(proposedHousingPayment(input, computeScenario(input))).toBe(3750)
  })

  it('is null without a payment', () => {
    const input: ScenarioInput = { purpose: 'purchase', purchasePrice: 400_000, loanAmount: null, noteRatePct: null, termMonths: null, property: null, liens: [] }
    expect(proposedHousingPayment(input, computeScenario(input))).toBeNull()
  })
})
