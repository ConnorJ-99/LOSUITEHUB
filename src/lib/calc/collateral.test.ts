import { describe, expect, it } from 'vitest'
import { collateralHomes, collateralSummary, otherCollateral } from './collateral'
import { computeScenario, type ScenarioInput } from './scenario'

const rental = (value: number | null, rent: number | null, balance: number | null, toBePaidOff = false) => ({
  estimatedValue: value,
  annualTaxes: 4_800,
  annualInsurance: 1_200,
  monthlyHoa: null,
  monthlyRent: rent,
  liens: balance === null ? [] : [{ position: 'first' as const, balance, monthlyPayment: 900, noteRate: 4, toBePaidOff }],
})

describe('otherCollateral', () => {
  it('adds the other homes together', () => {
    const o = otherCollateral([rental(300_000, 2_200, 120_000), rental(250_000, 1_900, 80_000, true)])
    expect(o).toEqual({
      count: 2,
      estimatedValue: 550_000,
      missingValues: 0,
      annualTaxes: 9_600,
      annualInsurance: 2_400,
      monthlyHoa: 0,
      monthlyRent: 4_100,
      // The 80k mortgage is paid off at closing, so only the 120k stays.
      remainingLienBalance: 120_000,
    })
  })

  it('counts a home with no value instead of guessing one', () => {
    const o = otherCollateral([rental(300_000, null, null), rental(null, 1_500, null)])
    expect(o).toMatchObject({ count: 2, estimatedValue: 300_000, missingValues: 1, monthlyRent: 1_500 })
  })

  it('is null with no other homes', () => {
    expect(otherCollateral([])).toBeNull()
  })
})

describe('collateralHomes', () => {
  const homes = [
    { id: 'subject', isCollateral: true },
    { id: 'a', isCollateral: true },
    { id: 'b', isCollateral: false },
  ]
  it('is the marked homes other than the subject', () => {
    expect(collateralHomes(true, 'subject', homes).map((h) => h.id)).toEqual(['a'])
  })
  it('is empty while the loan is not cross-collateralized, or has no subject', () => {
    expect(collateralHomes(false, 'subject', homes)).toEqual([])
    expect(collateralHomes(true, null, homes)).toEqual([])
  })
})

describe('computeScenario with cross-collateral', () => {
  const subject = { estimatedValue: 400_000, annualTaxes: 7_200, annualInsurance: 1_800, monthlyHoa: null, monthlyRent: 2_800 }
  const base: ScenarioInput = {
    purpose: 'investment_dscr',
    purchasePrice: null,
    loanAmount: 600_000,
    noteRatePct: 7.5,
    termMonths: 360,
    property: subject,
    liens: [{ position: 'first', balance: 250_000, monthlyPayment: 1_500, noteRate: 3.5 }],
  }

  it('without other homes, the subject alone', () => {
    const r = computeScenario(base)
    expect(r.value).toBe(400_000)
    expect(r.ltv).toBe(150)
    expect(r.rent).toBe(2_800)
    expect(r.otherCollateralCount).toBe(0)
  })

  it('refinance: full value of every home, combined costs and rent', () => {
    const other = otherCollateral([rental(300_000, 2_200, 120_000, true), rental(300_000, 2_000, 100_000, true)])
    const r = computeScenario({ ...base, otherCollateral: other })
    expect(r.value).toBe(1_000_000)
    expect(r.ltv).toBe(60)
    // Every old mortgage is paid off by the new loan, so CLTV = LTV.
    expect(r.cltv).toBe(60)
    // Taxes 7,200 + 9,600 and insurance 1,800 + 2,400 a year.
    expect(r.payment).toMatchObject({ taxes: 1_400, insurance: 350, hoa: 0 })
    expect(r.rent).toBe(7_000)
    // 600k @ 7.5% / 30yr = 4,195.29 P&I + 1,400 + 350 = 5,945.29
    expect(r.payment?.total).toBe(5_945.29)
    expect(r.dscr).toBe(1.18)
    expect(r.otherCollateralCount).toBe(2)
  })

  it('a mortgage on another home that stays counts toward CLTV', () => {
    const other = otherCollateral([rental(300_000, 2_200, 120_000), rental(300_000, 2_000, 100_000, true)])
    const r = computeScenario({ ...base, otherCollateral: other })
    expect(r.ltv).toBe(60)
    expect(r.cltv).toBe(72)
  })

  it('purchase: lower of price and value for the new home, plus the full value of the others', () => {
    const other = otherCollateral([rental(300_000, 2_200, null)])
    const r = computeScenario({ ...base, purchasePrice: 380_000, loanAmount: 500_000, liens: [], otherCollateral: other })
    expect(r.value).toBe(680_000)
    expect(r.ltv).toBe(73.529)
  })

  it('needs the subject value: no value means no LTV', () => {
    const other = otherCollateral([rental(300_000, 2_200, null)])
    const r = computeScenario({ ...base, property: { ...subject, estimatedValue: null }, otherCollateral: other })
    expect(r.value).toBeNull()
    expect(r.ltv).toBeNull()
  })

  it('a blanket refinance has no one-loan savings comparison', () => {
    const other = otherCollateral([rental(300_000, 2_200, 120_000, true)])
    const r = computeScenario({ ...base, purpose: 'refinance_rate_term', otherCollateral: other })
    expect(r.refinance).toBeNull()
  })
})

describe('collateralSummary', () => {
  it('adds the subject and the other homes, every mortgage before payoff', () => {
    expect(collateralSummary(rental(400_000, 2_800, 250_000), [rental(300_000, 2_200, 120_000, true), rental(null, null, null)])).toEqual({
      count: 3,
      value: 700_000,
      missingValues: 1,
      existingMortgages: 370_000,
      monthlyRent: 5_000,
    })
  })
})
