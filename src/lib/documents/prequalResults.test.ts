import { describe, expect, it } from 'vitest'
import { prequalFollowUpText, prequalResultsProblems, prequalResultsView, type PrequalResultsInput } from './prequalResults'

const purchase: PrequalResultsInput = {
  borrowerNames: ['Jane TEST', 'John TEST'],
  isPurchase: true,
  mortgageType: 'fha',
  termMonths: 360,
  purchasePrice: 400000,
  loanAmount: 386000,
  maxPrice: 425000,
  payment: { principalAndInterest: 2400, taxes: 733.33, insurance: 300, hoa: 0, mortgageInsurance: 176.92, total: 3610.25 },
  downPayment: 14000,
  closingCosts: 12000,
  closingCostsEstimated: true,
  cashNeeded: 26000,
  preparedOn: '2026-11-02',
}

describe('prequal results', () => {
  it('are ready with a saved purchase prequal', () => {
    expect(prequalResultsProblems(purchase)).toEqual([])
  })

  it('lead with the buying power and list the deal', () => {
    const v = prequalResultsView(purchase)
    expect(v.borrowers).toBe('Jane TEST and John TEST')
    expect(v.headline).toMatchObject({ label: 'Estimated buying power', value: 'Up to $425,000' })
    expect(v.facts).toEqual([
      { label: 'Loan type', value: 'FHA' },
      { label: 'Term', value: '30 years' },
      { label: 'Purchase price', value: '$400,000' },
      { label: 'Down payment', value: '$14,000 (3.5%)' },
      { label: 'Loan amount', value: '$386,000' },
    ])
    expect(v.payment.map((l) => l.label)).toEqual(['Principal and interest', 'Property taxes (est.)', "Homeowner's insurance (est.)", 'Mortgage insurance'])
    expect(v.paymentTotal).toBe(3610.25)
    expect(v.cash).toEqual([
      { label: 'Down payment', amount: 14000 },
      { label: 'Closing costs (est. 3% of price)', amount: 12000 },
    ])
    expect(v.cashTotal).toBe(26000)
    expect(v.nextSteps).toHaveLength(3)
    expect(v.nextSteps[2]).toContain('up to $425,000')
  })

  it('say pre-qualified and never show a rate', () => {
    const text = JSON.stringify(prequalResultsView(purchase))
    expect(text).toContain('pre-qualified')
    expect(text).not.toMatch(/\d+(\.\d+)?%\s*(rate|interest|APR)/i)
    expect(text).not.toMatch(/interest rate/i)
  })

  it('show payoffs as their own line', () => {
    const v = prequalResultsView({ ...purchase, cashNeeded: 31000 })
    expect(v.cash.at(-1)).toEqual({ label: 'Debts paid off at closing', amount: 5000 })
    expect(v.cashTotal).toBe(31000)
  })

  it('give the reasons they cannot be made yet', () => {
    expect(prequalResultsProblems({ ...purchase, purchasePrice: null, maxPrice: null, payment: null, mortgageType: null })).toEqual([
      'Pick a loan type.',
      'Enter a purchase price (or click "Use this price").',
      'There is no buying power yet: enter income, debts and an interest rate.',
      'There is no payment yet: enter an interest rate.',
    ])
  })

  it('show the loan amount, with no down payment or cash, for a refinance', () => {
    const refi = { ...purchase, isPurchase: false, purchasePrice: null, maxPrice: null, downPayment: null, closingCosts: null, cashNeeded: null }
    expect(prequalResultsProblems(refi)).toEqual([])
    const v = prequalResultsView(refi)
    expect(v.headline).toMatchObject({ label: 'Estimated loan amount', value: '$386,000' })
    expect(v.facts.map((f) => f.label)).toEqual(['Loan type', 'Term', 'Loan amount'])
    expect(v.cash).toEqual([])
    expect(v.cashTotal).toBeNull()
  })
})

describe('the follow-up text', () => {
  it("is Connor's wording with the personal cell", () => {
    expect(prequalFollowUpText('Jane', '214.555.0101')).toBe(
      "Hey Jane, thanks for the phone call today. I just sent your prequalified results to your email. This is our work number, but you're welcome to reach me on my personal cell too: (214) 555-0101.",
    )
  })
  it('leaves out the cell sentence when there is no cell', () => {
    expect(prequalFollowUpText('Jane', null)).toBe('Hey Jane, thanks for the phone call today. I just sent your prequalified results to your email.')
  })
})
