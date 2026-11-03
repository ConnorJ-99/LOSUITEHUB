import { describe, expect, it } from 'vitest'
import { calculatedLines, feeSheet, matchingRules, sectionTotals, taxReserveMonths, tieredAmount, type FeeContext, type FeeTemplate } from './fees'
import { mortgageInsurance } from './mortgageInsurance'
import { texasBasicPremium, texasLenderPolicy, texasOwnerPolicy } from './texasTitle'
import { vaFundingFeePct } from './govFees'

const ctx: FeeContext = {
  purpose: 'purchase',
  mortgageType: 'fha',
  loanAmount: 378_026.69,
  baseLoanAmount: 371_525,
  propertyValue: 385_000,
  purchasePrice: 385_000,
  ratePct: 6.25,
  pointsPct: 0,
  lenderCredit: 0,
  prepaidInterestDays: 11,
  monthlyHoi: 150,
  monthlyTaxes: 588,
  monthlyMi: 173,
  hoiPrepaidMonths: 12,
  taxPrepaidMonths: 0,
  hoiReserveMonths: 3,
  taxReserveMonths: 3,
  miReserveMonths: 0,
  aggregateAdjustment: 0,
  impoundWaiver: 'none',
  state: 'TX',
  county: 'Dallas',
  lenderId: 'uwm',
  occupancy: 'primary',
}

const rule = (over: Partial<FeeTemplate>): FeeTemplate => ({ key: 'underwriting', section: 'A', name: 'Underwriting fee', amountType: 'fixed', amount: 995, purposes: null, mortgageTypes: null, paidBy: 'B', apr: true, paidTo: null, sortOrder: 1, active: true, ...over })

describe('Smart Fees rule precedence', () => {
  it('lender + county > lender > county > state > default', () => {
    const rules = [
      rule({ amount: 995 }),
      rule({ amount: 1_000, states: ['TX'] }),
      rule({ amount: 1_050, counties: ['Dallas County'] }),
      rule({ amount: 1_195, lenderId: 'uwm' }),
      rule({ amount: 1_295, lenderId: 'uwm', counties: ['Dallas'] }),
    ]
    const pick = (rs: FeeTemplate[], c: Partial<FeeContext> = {}) => matchingRules(rs, { ...ctx, ...c })[0].amount
    expect(pick(rules)).toBe(1_295)
    expect(pick(rules.slice(0, 4))).toBe(1_195)
    expect(pick(rules.slice(0, 3))).toBe(1_050)
    expect(pick(rules.slice(0, 2))).toBe(1_000)
    expect(pick(rules.slice(0, 1))).toBe(995)
    // Another lender's charge never applies; another county's rule doesn't either.
    expect(pick(rules, { lenderId: 'rocket', county: 'Tarrant' })).toBe(1_000)
  })

  it('loan-amount ranges and occupancy limit a rule', () => {
    const rules = [rule({ amount: 500 }), rule({ amount: 700, minLoanAmount: 400_000 }), rule({ amount: 900, occupancies: ['investment'] })]
    expect(matchingRules(rules, ctx)[0].amount).toBe(500)
    expect(matchingRules(rules, { ...ctx, baseLoanAmount: 450_000 })[0].amount).toBe(700)
  })
})

describe('tiered and formula amounts', () => {
  it('a bracket table by loan amount', () => {
    const tiers = { basis: 'loan' as const, brackets: [{ upTo: 250_000, amount: 150 }, { upTo: 500_000, amount: 186 }, { upTo: null, amount: 250 }] }
    expect(tieredAmount(tiers, 200_000)).toBe(150)
    expect(tieredAmount(tiers, 371_525)).toBe(186)
    expect(tieredAmount(tiers, 900_000)).toBe(250)
    const line = calculatedLines([rule({ key: 'recording', section: 'E', name: 'Recording', amountType: 'tiered', amount: 0, tiers })], ctx).find((l) => l.key === 'recording')
    expect(line?.atClosing).toBe(186)
  })

  it('Texas title: owner’s policy on the price, simultaneous lender’s policy $100', () => {
    const rules = [
      rule({ key: 'title_owner', section: 'C', name: "Title – Owner's policy", amountType: 'formula', formula: 'title_owner_tx', paidBy: 'S', apr: false }),
      rule({ key: 'title_lender', section: 'C', name: "Title – Lender's policy", amountType: 'formula', formula: 'title_lender_tx', apr: false }),
    ]
    const lines = calculatedLines(rules, ctx)
    expect(lines.find((l) => l.key === 'title_owner')).toMatchObject({ atClosing: 2_188, paidBy: 'S', source: 'TDI rate · $385,000' })
    expect(lines.find((l) => l.key === 'title_lender')).toMatchObject({ atClosing: 100, source: 'TDI rate · simultaneous issue' })
    // A refinance has no owner's policy: the lender's policy is the full basic rate.
    expect(calculatedLines(rules, { ...ctx, purpose: 'refinance_rate_term', loanAmount: 310_000 }).find((l) => l.key === 'title_lender')?.atClosing).toBe(1_817)
  })
})

describe('TDI basic premium (rates effective March 1, 2026)', () => {
  it('matches TDI’s own table and examples', () => {
    expect(texasBasicPremium(25_000)).toBe(308)
    expect(texasBasicPremium(62_250)).toBe(545)
    expect(texasBasicPremium(100_000)).toBe(780)
    expect(texasBasicPremium(268_500)).toBe(1_612) // TDI example 1
    expect(texasBasicPremium(4_826_600)).toBe(20_762) // TDI example 2
    expect(texasBasicPremium(10_902_800)).toBe(41_240) // TDI example 3
  })

  it('owner’s vs lender’s policy', () => {
    expect(texasOwnerPolicy(385_000)).toBe(2_188)
    expect(texasLenderPolicy(371_525, 385_000)).toBe(100)
    // Loan above the price (R-5.2): basic on the loan − basic on the price + $100.
    expect(texasLenderPolicy(400_000, 385_000)).toBe(texasBasicPremium(400_000) - texasBasicPremium(385_000) + 100)
    expect(texasLenderPolicy(310_000, null)).toBe(1_817)
  })
})

describe('government fees', () => {
  it('FHA upfront MIP is financed: a line paid by the loan, not the borrower', () => {
    const mi = mortgageInsurance({ mortgageType: 'fha', baseLoanAmount: 371_525, ltvPct: 96.5 })
    expect(mi.upfrontFeePct).toBe(1.75)
    expect(mi.totalLoanAmount).toBe(371_525 + mi.financedFee)
    const lines = feeSheet([], [], { ...ctx, financedFee: mi.financedFee, financedFeeName: 'FHA upfront MIP (1.75%) · financed' })
    const ufmip = lines.find((l) => l.key === 'financed_fee')!
    expect(ufmip).toMatchObject({ atClosing: mi.financedFee, paidBy: 'O' })
    expect(sectionTotals(lines).B).toBe(0)
  })

  it('VA funding fee by down payment and use; exempt = 0', () => {
    expect(vaFundingFeePct({ kind: 'purchase', downPct: 0 })).toBe(2.15)
    expect(vaFundingFeePct({ kind: 'purchase', downPct: 0, subsequentUse: true })).toBe(3.3)
    expect(vaFundingFeePct({ kind: 'purchase', downPct: 5 })).toBe(1.5)
    expect(vaFundingFeePct({ kind: 'purchase', downPct: 10 })).toBe(1.25)
    expect(vaFundingFeePct({ kind: 'irrrl', downPct: 0 })).toBe(0.5)
    expect(vaFundingFeePct({ kind: 'purchase', downPct: 0, exempt: true })).toBe(0)
    expect(mortgageInsurance({ mortgageType: 'va', baseLoanAmount: 300_000, ltvPct: 100, upfrontFeePct: 0 }).financedFee).toBe(0)
  })

  it('USDA: 1% upfront, 0.35% a year', () => {
    const mi = mortgageInsurance({ mortgageType: 'usda_rural', baseLoanAmount: 200_000, ltvPct: 100 })
    expect(mi.financedFee).toBe(2_000)
    expect(mi.monthly).toBeCloseTo(58.33, 2)
  })
})

describe('tax reserve months (Texas taxes due Jan 31)', () => {
  it('depends on the first payment month, not a fixed 3', () => {
    // Closing Nov 20 → first payment Jan 1: this year's bill is prorated at closing; escrow pays next January.
    expect(taxReserveMonths('2027-01-01')).toBe(2)
    // First payment July 1: 7 deposits before January.
    expect(taxReserveMonths('2027-07-01')).toBe(7)
    // First payment October 1: 4 deposits.
    expect(taxReserveMonths('2027-10-01')).toBe(10)
  })
})
