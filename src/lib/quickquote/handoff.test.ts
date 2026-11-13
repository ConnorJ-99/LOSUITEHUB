import { describe, expect, it } from 'vitest'
import { details } from '@/lib/mismo/testFixture'
import type { LoanProfile, Property } from '@/lib/api/types'
import { describeChanges, factChanges, leadOption, loanFactsFromQuote, scenarioFromLoan } from './handoff'
import { blankOption, blankScenario, type OptionFigures, type QuoteScenario } from './quote'
import { quoteMessage, sentQuoteNote } from './send'

const s: QuoteScenario = { ...blankScenario(), borrower: { name: 'Jordan Reyes TEST', email: '', phone: '' }, purchasePrice: 425000, downPayment: 21250, creditBucket: 700 }
const a = blankOption('a', { ratePct: 6.375 })
const b = blankOption('b', { mortgageType: 'fha', ratePct: 5.875, downPayment: 14875 })
const c = blankOption('c', { ratePct: 6, pointsPct: 1, recommended: true })

describe('which option the file takes', () => {
  it('is the recommended one, else the first on the quote', () => {
    expect(leadOption([a, b, c])?.id).toBe('c')
    expect(leadOption([{ ...a, onQuote: false }, b])?.id).toBe('b')
    expect(leadOption([{ ...c, onQuote: false }, a])?.id).toBe('a')
    expect(leadOption([])).toBeNull()
  })
})

describe('loan facts from the quote', () => {
  it('a purchase writes the price, loan, option terms and the estimates', () => {
    expect(loanFactsFromQuote(s, c)).toEqual({ occupancy: 'primary', purchasePrice: 425000, loanAmount: 403750, estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: 3600, mortgageType: 'conventional', termMonths: 360, noteRate: 6, discountPointsAmount: 4037.5 })
  })

  it("uses the option's own down payment, and turns typed taxes back into a percent", () => {
    expect(loanFactsFromQuote({ ...s, taxesMonthly: 708.33, insuranceMonthly: 150 }, b)).toMatchObject({ loanAmount: 410125, mortgageType: 'fha', estimatedTaxRatePct: 2, estimatedAnnualInsurance: 1800, discountPointsAmount: 0 })
  })

  it('a refinance writes the payoff plus cash out and no price', () => {
    const refi: QuoteScenario = { ...s, purpose: 'refinance_cash_out', value: 500000, loanBalance: 250000, cashOut: 50000 }
    expect(loanFactsFromQuote(refi, a)).toMatchObject({ purchasePrice: null, loanAmount: 300000 })
  })

  it('without an option, writes only the scenario', () => {
    expect(loanFactsFromQuote(s, null)).toEqual({ occupancy: 'primary', purchasePrice: 425000, loanAmount: 403750, estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: 3600 })
  })

  it('lists only facts the file already has that would change', () => {
    expect(factChanges({ ...details, purchasePrice: null, loanAmount: 350000, noteRate: 6.375 }, { purchasePrice: 425000, loanAmount: 403750, noteRate: 6.375 })).toEqual(['loanAmount'])
  })
})

describe('a quote started from a file', () => {
  const loan = {
    id: 'l1', purpose: 'purchase', borrower: { id: 'c1', firstName: 'Jordan', lastName: 'Reyes TEST', email: 'jordan@example.test', phone: '2145550142' },
    details: { ...details, purchasePrice: 425000, loanAmount: 403750, occupancy: 'primary' },
  } as unknown as LoanProfile

  it('brings the name, contact details, price, down payment and credit range', () => {
    expect(scenarioFromLoan(loan, 712, null)).toMatchObject({ borrower: { name: 'Jordan Reyes TEST', email: 'jordan@example.test', phone: '2145550142' }, purpose: 'purchase', purchasePrice: 425000, downPayment: 21250, creditBucket: 700, taxesMonthly: null })
  })

  it("a refinance brings the home's value, first lien and taxes", () => {
    const home = { estimatedValue: 500000, county: 'Collin', state: 'TX', propertyType: 'condo', annualTaxes: 9000, annualInsurance: 2400, liens: [{ position: 'first', balance: 250000 }] } as unknown as Property
    const refi = { ...loan, purpose: 'refinance_cash_out', details: { ...loan.details, purchasePrice: null, loanAmount: 300000 } } as LoanProfile
    expect(scenarioFromLoan(refi, null, home)).toMatchObject({ purpose: 'refinance_cash_out', value: 500000, loanBalance: 250000, cashOut: 50000, propertyType: 'condo', county: 'Collin', taxesMonthly: 750, insuranceMonthly: 200, creditBucket: null })
  })
})

describe('the words around a sent quote', () => {
  it('greets by first name and says how long it is good for', () => {
    const m = quoteMessage('Jordan', 'Connor TEST', 3, '2026-11-06')
    expect(m.subject).toBe('Your loan options from MPS Mortgage')
    expect(m.body).toContain('Hi Jordan,')
    expect(m.body).toContain('3 loan options')
    expect(m.body).toContain('Nov 6, 2026')
    expect(m.body.endsWith('Connor TEST\nMPS Mortgage')).toBe(true)
    expect(m.text).toBe("Hi Jordan, it's Connor TEST. I just emailed your loan options quote. Let me know if you have any questions!")
    expect(quoteMessage(null, null, 1, '2026-11-06').body).toContain('a loan option')
  })

  it('notes the payment and cash range on the timeline', () => {
    const fig = (id: string, totalMonthly: number, cashToClose: number) => ({ id, totalMonthly, cashToClose }) as OptionFigures
    const figures = new Map([fig('a', 3633.4, 32650), fig('b', 3636, 27100), fig('c', 3535, 36690)].map((f) => [f.id, f]))
    expect(sentQuoteNote([a, b, c], figures, 'jordan@example.test', true)).toBe('Emailed a Loan Options Quote to jordan@example.test: 3 options, $3,535–$3,636/mo, $27,100–$36,690 cash to close. Texted a heads-up.')
    expect(sentQuoteNote([a], figures, 'j@x.test', false)).toBe('Emailed a Loan Options Quote to j@x.test: 1 option, $3,633/mo, $32,650 cash to close.')
  })
})

describe('the confirm before replacing figures on a file', () => {
  it('names each figure with its old and new value', () => {
    expect(describeChanges({ ...details, noteRate: 6, discountPointsAmount: 4037.5, loanAmount: 403750 }, { noteRate: 6.875, discountPointsAmount: 0, loanAmount: 403750 })).toBe('rate 6% → 6.875%, points $4,037.50 → $0')
  })
})
