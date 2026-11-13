import { describe, expect, it } from 'vitest'
import type { FeeTemplate } from '@/lib/calc'
import { estimatedApr, miMonths } from './apr'
import {
  badgesFor,
  blankOption,
  blankScenario,
  bucketFor,
  cleanBookingUrl,
  CREDIT_BUCKETS,
  creditLabel,
  downAmount,
  downPct,
  housingEstimate,
  optionFigures,
  optionTitle,
  quoteProblems,
  rateLooksRight,
  recommendOnly,
  scoreFor,
  sortOptions,
  splitName,
  validThroughFrom,
  type OptionFigures,
  type QuoteOption,
  type QuoteScenario,
} from './quote'

const t = (key: string, section: FeeTemplate['section'], amount: number, apr = false): FeeTemplate => ({
  key, section, name: key, amountType: 'fixed', amount, purposes: null, mortgageTypes: null, paidBy: 'B', apr, paidTo: null, sortOrder: 10, active: true,
})

// Connor's mockup: purchase $425,000, 5% down, 700–719, primary single family.
const jordan: QuoteScenario = { ...blankScenario(), borrower: { name: 'Jordan TEST', email: '', phone: '' }, purchasePrice: 425000, downPayment: 21250, creditBucket: 700, firstTimeBuyer: true }
const conv = blankOption('a', { mortgageType: 'conventional', ratePct: 6.375 })
const fha = blankOption('b', { mortgageType: 'fha', ratePct: 5.875, downPayment: 14875 })

describe('credit ranges', () => {
  it('runs in 20-point buckets from under 580 to 780+', () => {
    expect(CREDIT_BUCKETS.map((b) => b.label)).toEqual(['Under 580', '580–599', '600–619', '620–639', '640–659', '660–679', '680–699', '700–719', '720–739', '740–759', '760–779', '780+'])
    expect(creditLabel(700)).toBe('700–719')
    expect(creditLabel(null)).toBeNull()
  })

  it('finds the bucket for a score and saves the low end', () => {
    expect([bucketFor(712), bucketFor(579), bucketFor(580), bucketFor(799), bucketFor(null)]).toEqual([700, 0, 580, 780, null])
    expect([scoreFor(700), scoreFor(0), scoreFor(null)]).toEqual([700, 579, null])
  })
})

describe('down payment, taxes and insurance', () => {
  it('links dollars and percent', () => {
    expect(downPct(425000, 21250)).toBe(5)
    expect(downAmount(425000, 3.5)).toBe(14875)
    expect(downPct(null, 21250)).toBeNull()
  })

  it('estimates taxes at 2.2% of the price and $3,600 a year of insurance until typed over', () => {
    expect(housingEstimate(jordan)).toEqual({ taxesMonthly: 779.17, insuranceMonthly: 300, taxesEstimated: true, insuranceEstimated: true, taxRatePct: 2.2, taxRateFromCounty: false })
    expect(housingEstimate({ ...jordan, taxesMonthly: 700, insuranceMonthly: 150 })).toMatchObject({ taxesMonthly: 700, insuranceMonthly: 150, taxesEstimated: false, insuranceEstimated: false })
  })

  it('figures a refinance on the value', () => {
    expect(housingEstimate({ ...jordan, purpose: 'refinance_rate_term', value: 300000 }).taxesMonthly).toBe(550)
  })
})

describe('option figures', () => {
  it('waits for a rate and a loan amount', () => {
    expect(optionFigures(jordan, blankOption('x'), [])).toBeNull()
    expect(optionFigures({ ...jordan, downPayment: null }, conv, [])).toBeNull()
  })

  it('conventional 5% down: P&I, MI over 80% LTV, taxes and insurance', () => {
    const f = optionFigures(jordan, conv, [])!
    expect(f).toMatchObject({ baseLoanAmount: 403750, loanAmount: 403750, financedFee: 0, downPayment: 21250, downPaymentPct: 5, ltvPct: 95, principalAndInterest: 2518.87, mortgageInsurance: 168.23, taxesInsurance: 1079.17 })
    expect(f.totalMonthly).toBe(3766.27)
    expect(optionTitle(conv)).toBe('Conventional 30-yr fixed')
  })

  it('FHA finances the 1.75% upfront premium; cash to close leaves it out', () => {
    const f = optionFigures(jordan, fha, [])!
    expect(f).toMatchObject({ baseLoanAmount: 410125, financedFee: 7177.19, loanAmount: 417302.19, downPaymentPct: 3.5 })
    // Monthly MIP is 0.55% of the base loan above 95% LTV.
    expect(f.mortgageInsurance).toBe(187.97)
    // Down payment + 15 days of interest + a year of insurance + 3 months of insurance and tax escrows.
    expect(f.cashLabel).toBe('Cash to close')
    expect(f.cashAmount).toBe(14875 + f.closingCosts)
  })

  it('VA finances the funding fee and has no monthly MI', () => {
    const f = optionFigures(jordan, blankOption('v', { mortgageType: 'va', ratePct: 5.5, downPayment: 0 }), [])!
    expect(f).toMatchObject({ baseLoanAmount: 425000, financedFee: 9137.5, loanAmount: 434137.5, mortgageInsurance: 0, downPayment: 0 })
  })

  it('closing costs come from the fee list, points, prepaids and escrows', () => {
    const fees = [t('admin', 'A', 1295, true), t('appraisal', 'B', 650), t('title', 'C', 2500)]
    const f = optionFigures(jordan, { ...conv, pointsPct: 1 }, fees)!
    expect(f.pointsAmount).toBe(4037.5)
    // Points 4,037.50 + fees 4,445 + 15 days interest 1,072.46 + 12 months HOI 3,600 + 3 months HOI 900 + 3 months taxes 2,337.51.
    expect(f.closingCosts).toBe(16392.47)
    expect(f.closingCostsEstimated).toBe(true)
    expect(f.cashToClose).toBe(21250 + 16392.47)
  })

  it('a typed closing cost estimate replaces the engine figure', () => {
    const f = optionFigures(jordan, { ...conv, closingCostsOverride: 11400 }, [])!
    expect(f).toMatchObject({ closingCosts: 11400, closingCostsEstimated: false, cashToClose: 32650 })
    expect(f.closingCostsEngine).toBeGreaterThan(0)
  })

  it('a cash-out refinance can pay the borrower', () => {
    const s: QuoteScenario = { ...jordan, purpose: 'refinance_cash_out', value: 500000, loanBalance: 250000, cashOut: 100000 }
    const f = optionFigures(s, conv, [])!
    expect(f).toMatchObject({ baseLoanAmount: 350000, ltvPct: 70, mortgageInsurance: 0, downPayment: null, cashLabel: 'Cash to borrower' })
    expect(f.cashToClose).toBeLessThan(0)
  })
})

describe('estimated APR', () => {
  it('equals the rate with no fees and no MI', () => {
    expect(estimatedApr({ loanAmount: 200000, financedFee: 0, aprFees: 0, ratePct: 6, termMonths: 360, monthlyMi: 0, mortgageType: 'conventional', ltvPct: 80, value: 250000 })).toBe(6)
  })

  it('rises with prepaid finance charges (textbook: $200,000 at 6% with $4,000 in fees is about 6.19%)', () => {
    expect(estimatedApr({ loanAmount: 200000, financedFee: 0, aprFees: 4000, ratePct: 6, termMonths: 360, monthlyMi: 0, mortgageType: 'conventional', ltvPct: 80, value: 250000 })).toBeCloseTo(6.188, 2)
  })

  it('counts mortgage insurance for as long as it is likely to last', () => {
    const base = { loanAmount: 400000, ratePct: 6.375, termMonths: 360, monthlyMi: 168, value: 425000 }
    expect(miMonths({ ...base, mortgageType: 'fha', ltvPct: 96.5 })).toBe(360)
    expect(miMonths({ ...base, mortgageType: 'fha', ltvPct: 90 })).toBe(132)
    expect(miMonths({ ...base, mortgageType: 'va', ltvPct: 100 })).toBe(0)
    expect(miMonths({ ...base, mortgageType: 'usda_rural', ltvPct: 100 })).toBe(360)
    // Conventional drops off once the scheduled balance reaches 78% of the value ($331,500).
    const conventional = miMonths({ ...base, mortgageType: 'conventional', ltvPct: 95 })
    expect(conventional).toBeGreaterThan(100)
    expect(conventional).toBeLessThan(200)
    expect(miMonths({ ...base, monthlyMi: 0, mortgageType: 'conventional', ltvPct: 95 })).toBe(0)
  })

  it('comes out above the rate on a quote option with MI', () => {
    const f = optionFigures(jordan, conv, [])!
    expect(f.aprPct!).toBeGreaterThan(6.375)
    expect(f.aprPct!).toBeLessThan(7)
  })

  it('is blank when it cannot be figured', () => {
    expect(estimatedApr({ loanAmount: 1000, financedFee: 0, aprFees: 2000, ratePct: 6, termMonths: 360, monthlyMi: 0, mortgageType: 'conventional', ltvPct: 80, value: 2000 })).toBeNull()
  })
})

describe('badges and sorting', () => {
  const fig = (id: string, totalMonthly: number, cashToClose: number) => ({ id, totalMonthly, cashToClose }) as OptionFigures
  const options: QuoteOption[] = [blankOption('a', { ratePct: 6.375 }), blankOption('b', { ratePct: 5.875 }), blankOption('c', { ratePct: 6, recommended: true })]
  const figures = new Map([fig('a', 3633, 32650), fig('b', 3636, 27100), fig('c', 3535, 36690)].map((f) => [f.id, f]))

  it('finds the lowest payment and least cash to close, and keeps Connor’s recommendation', () => {
    const b = badgesFor(options, figures)
    expect([b.get('a'), b.get('b'), b.get('c')]).toEqual([[], ['least_cash'], ['recommended', 'lowest_payment']])
  })

  it('leaves options off the quote out, and gives nothing when there is only one or all tie', () => {
    expect(badgesFor(options.map((o) => ({ ...o, onQuote: o.id === 'a' })), figures).get('a')).toEqual([])
    const tie = new Map([fig('a', 3000, 20000), fig('b', 3000, 20000)].map((f) => [f.id, f]))
    expect(badgesFor(options.slice(0, 2), tie).get('a')).toEqual([])
  })

  it('recommends one option at a time', () => {
    expect(recommendOnly(options, 'a', true).map((o) => o.recommended)).toEqual([true, false, false])
    expect(recommendOnly(options, 'c', false).map((o) => o.recommended)).toEqual([false, false, false])
  })

  it('sorts by payment, cash to close or rate; unpriced options stay last', () => {
    const withBlank = [...options, blankOption('d')]
    expect(sortOptions(withBlank, figures, 'payment').map((o) => o.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(sortOptions(withBlank, figures, 'cash').map((o) => o.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(sortOptions(withBlank, figures, 'rate').map((o) => o.id)).toEqual(['b', 'c', 'a', 'd'])
  })
})

describe('quote checks and helpers', () => {
  it('needs a name and at least one priced option on the quote', () => {
    const figures = new Map([['a', optionFigures(jordan, conv, [])!]])
    expect(quoteProblems(jordan, [conv], figures)).toEqual([])
    expect(quoteProblems({ ...jordan, borrower: { name: ' ', email: '', phone: '' } }, [conv], figures)).toEqual(["Add the borrower's name."])
    expect(quoteProblems(jordan, [{ ...conv, onQuote: false }], figures)).toEqual(['Put at least one option on the quote.'])
    expect(quoteProblems(jordan, [conv, blankOption('x')], figures)).toEqual(['One option on the quote is missing its rate or loan amount.'])
    const typo = { ...conv, ratePct: 63.52 }
    expect(quoteProblems(jordan, [typo], new Map([['a', optionFigures(jordan, typo, [])!]]))).toEqual(["Option A's rate of 63.52% looks like a typo."])
    expect([rateLooksRight(6.352), rateLooksRight(0.5), rateLooksRight(15.5)]).toEqual([true, false, false])
  })

  it('splits a typed name', () => {
    expect(splitName(' Jordan  Reyes ')).toEqual({ firstName: 'Jordan', lastName: 'Reyes' })
    expect(splitName('Mary Ann TEST')).toEqual({ firstName: 'Mary Ann', lastName: 'TEST' })
    expect(splitName('Jordan')).toEqual({ firstName: 'Jordan', lastName: '' })
  })

  it('cleans a booking link', () => {
    expect(cleanBookingUrl(' calendly.com/connor-test ')).toBe('https://calendly.com/connor-test')
    expect(cleanBookingUrl('http://book.example.test/x')).toBe('https://book.example.test/x')
    expect(cleanBookingUrl('')).toBeNull()
    expect(cleanBookingUrl('call me')).toBe('invalid')
  })

  it('is valid for 7 days by default', () => {
    expect(validThroughFrom('2026-10-30')).toBe('2026-11-06')
    expect(validThroughFrom('2026-12-28', 10)).toBe('2027-01-07')
  })
})
