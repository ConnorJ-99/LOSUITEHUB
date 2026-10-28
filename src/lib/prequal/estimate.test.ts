import { describe, expect, it } from 'vitest'
import { assumptionsLine, COMFORTABLE_DTI, HEADLINE_DTI, prequalEstimate, type EstimateInput } from './estimate'
import { askNext, prequalOutcome, type OutcomeInput } from './outcome'

// Connor's sample: $9,400 + $1,500 income, $755 debts, FHA 5% down, 6.75%, 30 years, $175/mo insurance, $46,000 saved.
// Taxes at 2.2% until the county table is in (Tarrant's rate replaces it then).
// LOSuite counts FHA mortgage insurance in the payment (Connor, 2026-10-27), so the max is about $467K, not the
// $511,464 the old estimate email showed without MI.
const sample: EstimateInput = { monthlyIncome: 10900, monthlyDebts: 755, mortgageType: 'fha', downPayment: { kind: 'percent', pct: 5 }, noteRatePct: 6.75, termMonths: 360, taxRatePct: 2.2, annualInsurance: 2100, monthlyHoa: 0, funds: 46000, closingCosts: null }

describe("Connor's sample scenario with LOSuite's math", () => {
  const e = prequalEstimate(sample)
  it('headline max at 45% DTI for FHA, with a 50% stretch line', () => {
    expect(HEADLINE_DTI.fha).toBe(45)
    expect(e.max?.price).toBe(467000)
    expect(e.max?.payment.total).toBe(4143.88)
    expect(e.stretch).toEqual({ dtiPct: 50, price: 531000 })
  })
  it('comfortable range at 38–42% total DTI, with its payment range', () => {
    expect(COMFORTABLE_DTI).toEqual({ low: 38, high: 42 })
    expect(e.comfortable).toEqual({ low: 377000, high: 429000, paymentLow: 3379.01, paymentHigh: 3820.93 })
  })
  it('cash to close, funds left and the ratios at the max', () => {
    expect(e.cashToClose).toBe(37360)
    expect(e.leftAfterClosing).toBe(8640)
    expect(e.housingRatioPct).toBe(38)
    expect(e.totalRatioPct).toBe(44.9)
  })
  it('the assumptions line', () => {
    expect(assumptionsLine(sample, 'Tarrant')).toBe('Assumes FHA, 5% down, 6.75% rate, 30-year term, Tarrant County taxes and $175/mo insurance. Estimate only, not a loan approval.')
    expect(assumptionsLine({ ...sample, downPayment: { kind: 'amount', amount: 20000 }, annualInsurance: null }, null)).toBe('Assumes FHA, $20,000 down, 6.75% rate, 30-year term, 2.2% property taxes and estimated insurance. Estimate only, not a loan approval.')
  })
  it('no stretch line where there is none (VA, USDA), and nothing without income', () => {
    expect(prequalEstimate({ ...sample, mortgageType: 'va' }).stretch).toBeNull()
    expect(prequalEstimate({ ...sample, monthlyIncome: 0 }).max).toBeNull()
  })
})

describe('the status chip (9 outcomes)', () => {
  const e = prequalEstimate(sample)
  const base: OutcomeInput = { estimate: e, borrowerOnly: null, input: sample, mortgageType: 'fha', creditScore: 700, incomeKind: 'w2', firstTimeBuyer: true, timeline: '3 months', targetPrice: null }
  const outcome = (over: Partial<OutcomeInput>) => prequalOutcome({ ...base, ...over })?.outcome

  it('Prequalified when it all fits', () => expect(outcome({})).toBe('Prequalified'))
  it('self-employed, 1099 and Non-QM go to Manual Review, never "not qualified"', () => {
    expect(outcome({ incomeKind: 'self_employed' })).toBe('Manual Review')
    expect(outcome({ incomeKind: 'form_1099' })).toBe('Manual Review')
    expect(outcome({ mortgageType: 'other' })).toBe('Manual Review')
  })
  it('a long timeline is a Future Buyer', () => {
    expect(outcome({ timeline: '6+ months' })).toBe('Future Buyer')
    expect(outcome({ timeline: 'Just looking' })).toBe('Future Buyer')
  })
  it('one problem names it; two or more is Multiple Issues', () => {
    expect(outcome({ creditScore: 560 })).toBe('Credit Improvement Needed')
    expect(outcome({ targetPrice: 500000 })).toBe('DTI Improvement Needed')
    expect(outcome({ input: { ...sample, funds: 10000 }, firstTimeBuyer: false })).toBe('Asset Improvement Needed')
    expect(outcome({ creditScore: 560, targetPrice: 500000 })).toBe('Multiple Issues')
  })
  it('short on cash only: a first-time buyer with the score for it is Prequalified with DPA', () => {
    expect(outcome({ input: { ...sample, funds: 10000 } })).toBe('Prequalified with DPA')
    expect(outcome({ input: { ...sample, funds: 10000 }, creditScore: 600 })).toBe('Asset Improvement Needed')
  })
  it('fits only with the co-borrower counted', () => {
    const alone = prequalEstimate({ ...sample, monthlyIncome: 6000 })
    expect(outcome({ borrowerOnly: alone })).toBe('Prequalified with Co-borrower')
    expect(outcome({ borrowerOnly: prequalEstimate({ ...sample, monthlyIncome: 9400 }) })).toBe('Prequalified')
  })
  it('no chip until there is income to work with', () => {
    expect(prequalOutcome({ ...base, input: { ...sample, monthlyIncome: 0 } })).toBeNull()
  })
})

describe('Ask next', () => {
  it("the sample's questions", () => {
    expect(askNext({ creditScore: 700, creditHistoryAsked: false, savings: 46000, giftFunds: 0, monthlyDebts: 755, incomeKind: 'w2', monthsAtJob: 36, coBorrowerIncome: 1500 })).toEqual([
      'Any late payments or collections in the last 12 months?',
      "Is the co-borrower's $1,500 income with a 2-year history?",
      'Where is the $46,000 held, and has it been there 60 days?',
    ])
  })
  it('asks for what is missing first, at most 4', () => {
    const q = askNext({ creditScore: null, creditHistoryAsked: false, savings: null, giftFunds: 5000, monthlyDebts: null, incomeKind: 'self_employed', monthsAtJob: 12, coBorrowerIncome: null })
    expect(q).toEqual(['What would you estimate your credit score is?', 'Any late payments or collections in the last 12 months?', 'How many years have you filed as self-employed (or on 1099s)?', 'How much do you have saved for the down payment and closing?'])
  })
  it('a short job history asks about the one before', () => {
    expect(askNext({ creditScore: 700, creditHistoryAsked: true, savings: 5000, giftFunds: null, monthlyDebts: 300, incomeKind: 'w2', monthsAtJob: 8, coBorrowerIncome: null })).toEqual(['Where did you work before this job? We need a 2-year history.'])
  })
})
