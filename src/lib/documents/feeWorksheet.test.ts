import { describe, expect, it } from 'vitest'
import type { FeeOverride, FeeTemplate } from '@/lib/calc'
import { details as baseDetails } from '@/lib/mismo/testFixture'
import type { Property } from '@/lib/api/types'
import { compareQuotes, quoteClosingCosts, type CompareContext, type SavedQuote } from '@/lib/pricing/compare'
import { cashFigure, payoffsFor, priceScenario, scenarioFrom } from '@/lib/pricing/scenario'
import { feeWorksheet, joinNames, missingForBorrowerPdf, OFFICIAL_LE_CALLOUT, productLabel, worksheetFileName, worksheetNumber, type WorksheetInput } from './feeWorksheet'
import { loanComparison, MAX_COMPARISON_OPTIONS } from './loanComparison'

const t = (key: string, section: FeeTemplate['section'], amount: number, paidBy: FeeTemplate['paidBy'] = 'B'): FeeTemplate => ({
  key, section, name: key, amountType: 'fixed', amount, purposes: null, mortgageTypes: null, paidBy, apr: false, paidTo: null, sortOrder: 10, active: true,
})
const templates = [t('admin', 'A', 1505.75), t('appraisal', 'B', 650), t('credit', 'B', 65), t('flood', 'B', 150), t('title', 'C', 2086.25), t('settlement', 'C', 750), t('recording', 'E', 223), t('misc', 'H', 150)]
const home = (over: Partial<Property> = {}): Property => ({
  id: 'p1', loanId: 'l1', addressLine: '1 Test St', city: 'Frisco', state: 'TX', zip: '75034', county: null, propertyType: 'single_family', status: 'current_home',
  listPrice: null, estimatedValue: 620000, annualTaxes: 6300, annualInsurance: 1109.64, monthlyHoa: null, monthlyRent: null, isHomestead: true, listingUrl: null,
  unitCount: null, reoDisposition: null, reoOccupancy: null, rentalIncomeMethod: 'lease', scheduleEMonthlyIncome: null, createdAt: '', liens: [], ...over,
})
const at = '2026-10-27T20:05:00Z' // 3:05 PM in Dallas

function input(over: Partial<WorksheetInput> & { overrides?: FeeOverride[]; property?: Property } = {}): WorksheetInput {
  // Connor's cash-out test case: value $620,000, loan $465,000, 7.625%, 4 points, impounds waived.
  const property = over.property ?? home({ liens: [{ id: 'x', propertyId: 'p1', position: 'first', lender: null, balance: 300000, noteRate: 3, monthlyPayment: 1800, isHeloc: false, originatedOn: null, isTexasCashOut: false, toBePaidOff: false, creditLimit: null, mortgageType: null }] })
  const loan = { id: 'l1', purpose: 'refinance_cash_out' as const, details: { ...baseDetails, loanAmount: 465000, noteRate: 7.625, termMonths: 360, mortgageType: 'conventional' as const, hasInterestOnly: false, purchasePrice: null, estimatedFundingDate: '2026-10-26', impoundWaiver: 'all' as const, discountPointsAmount: 18600, lenderCredits: null, subjectPropertyId: 'p1' } }
  const scenario = { ...scenarioFrom(loan, property, 'Cash-out'), lockDays: 30 }
  const priced = priceScenario(scenario, loan.purpose, templates, over.overrides ?? [])
  const payoffs = payoffsFor(loan.purpose, property)
  return {
    scenarioId: '3f9a1c2e-0000-4000-8000-000000000000',
    purpose: loan.purpose,
    occupancy: 'primary',
    scenario,
    lines: priced.lines,
    totals: priced.totals,
    figures: priced.figures,
    cash: cashFigure({ purpose: loan.purpose, purchasePrice: null, totalLoanAmount: priced.figures.totalLoanAmount, closingCosts: priced.closingCosts, payoffs, earnestMoney: 0, sellerCredits: 0 }),
    payoffs,
    remainingLiens: 0,
    earnestMoney: 0,
    sellerCredits: 0,
    property,
    borrowerNames: ['Marcus Reed', 'Dana Reed'],
    preparedAt: at,
    ...over,
  }
}

describe('Fee Worksheet contents', () => {
  it("Connor's cash-out case: sections, D/I/J and cash to you match the Fees tab", () => {
    const w = feeWorksheet(input())
    expect(w.loanCosts.map((s) => [s.letter, s.total])).toEqual([['A', 20105.75], ['B', 865], ['C', 2836.25]])
    expect(w.otherCosts.map((s) => [s.letter, s.total])).toEqual([['E', 223], ['F', 590.94], ['G', 0], ['H', 150]])
    expect(w.totals).toEqual({ D: 23807, I: 963.94, J: 24770.94, lenderCredits: 0 })
    // Impounds waived: G has no rows, and zero lines are left off.
    expect(w.otherCosts.find((s) => s.letter === 'G')!.rows).toEqual([])
    expect(w.payment.total).toBe(3908.71)
    // $465,000 − $24,770.94 − $300,000 payoff.
    expect(w.cash).toEqual({
      title: 'Estimated cash to you',
      lines: [{ label: 'Loan amount', amount: 465000 }, { label: 'Closing costs after lender credits', amount: 24770.94, negative: true }, { label: 'Mortgages paid off', amount: 300000, negative: true }],
      total: 140229.06,
    })
  })

  it('the cash lines always add up to the total', () => {
    for (const w of [feeWorksheet(input()), feeWorksheet(input({ property: home() }))]) {
      const sum = w.cash.lines.reduce((s, l) => s + (l.negative ? -l.amount : l.amount), 0)
      expect(Math.round(sum * 100) / 100).toBe(w.cash.title === 'Estimated cash to you' ? w.cash.total : -w.cash.total)
    }
  })

  it('the facts at the top', () => {
    const w = feeWorksheet(input())
    expect(w.facts).toEqual([
      { label: 'Loan purpose', value: 'Cash-Out Refi' },
      { label: 'Estimated value', value: '$620,000' },
      { label: 'Loan amount', value: '$465,000' },
      { label: 'Product', value: 'Conventional 30-year fixed' },
      { label: 'Rate / points', value: '7.625% / 4.000%' },
      { label: 'LTV / CLTV', value: '75% / 75%' },
      { label: 'Property', value: 'Single family · Primary residence' },
      { label: 'Location', value: 'Frisco, TX 75034' },
      { label: 'Escrows / lock', value: 'None (waived) · 30-day lock' },
    ])
    expect(w.borrowers).toBe('Marcus Reed and Dana Reed')
    expect(w.number).toBe('20261027-3F9A')
    expect(w.preparedAt).toBe('Oct 27, 2026, 3:05 PM CT')
  })

  it('a fee paid by the seller shows with a note but is not in the total', () => {
    const seller: FeeOverride = { key: 'owner_title', section: 'C', name: "Owner's title policy", atClosing: 1800, beforeClosing: null, paidBy: 'S', apr: false, paidTo: null, custom: true }
    const w = feeWorksheet(input({ overrides: [seller] }))
    const c = w.loanCosts.find((s) => s.letter === 'C')!
    expect(c.rows.at(-1)).toEqual({ label: "Owner's title policy", note: 'paid by seller', amount: 1800 })
    expect(c.total).toBe(2836.25)
  })

  it('CLTV counts mortgages that stay on the home', () => {
    expect(feeWorksheet(input({ remainingLiens: 31000 })).facts.find((f) => f.label === 'LTV / CLTV')!.value).toBe('75% / 80%')
  })

  it('the required Loan Estimate line is word for word', () => {
    expect(OFFICIAL_LE_CALLOUT).toBe('Your actual rate, payment and costs could be higher. Get an official Loan Estimate before choosing a loan.')
  })
})

describe('labels and names', () => {
  it('joins borrower names', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['Marcus Reed'])).toBe('Marcus Reed')
    expect(joinNames(['A', ' ', 'B', 'C'])).toBe('A, B and C')
  })
  it('product names', () => {
    expect(productLabel({ mortgageType: 'fha', termMonths: 180, amortizationType: 'fixed', interestOnly: false })).toBe('FHA 15-year fixed')
    expect(productLabel({ mortgageType: null, termMonths: 84, amortizationType: 'arm', interestOnly: true })).toBe('7-year ARM, interest only')
  })
  it('the worksheet number and file name use the Dallas date', () => {
    // 11:30 PM in Dallas is already the 28th in UTC.
    expect(worksheetNumber('abcd-ef', '2026-10-28T04:30:00Z')).toBe('20261027-ABCD')
    expect(worksheetFileName('Fee Worksheet', 'Marcus Reed and Dana Reed', '2026-10-28T04:30:00Z')).toBe('Fee Worksheet - Marcus Reed and Dana Reed - 2026-10-27.pdf')
    expect(worksheetFileName('Fee Worksheet', 'O’Neil / Smith', at)).toBe('Fee Worksheet - ONeil  Smith - 2026-10-27.pdf')
  })
})

describe('loan comparison contents', () => {
  // Mockup 07: TBD purchase, $400,000, $380,000, taxes 2.2%, HOI $150/mo.
  const tbd = {
    ...scenarioFrom({ id: 'l1', purpose: 'purchase', details: { ...baseDetails, purchasePrice: 400000, loanAmount: 380000, termMonths: 360, mortgageType: 'conventional', estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: null, subjectPropertyId: null } }, null, 'TBD purchase'),
    insuranceValue: 150,
    insuranceFactor: 'monthly' as const,
  }
  const ctx: CompareContext = { purpose: 'purchase', scenario: tbd, property: null, templates: [], overrides: [], earnestMoney: 0, sellerCredits: 0 }
  const quote = (id: string, rate: number, closingCosts: number, mi: number, pointsPct = 0): SavedQuote => ({ id, optionId: id, pricingScenarioId: 's', rate, lockDays: 30, pointsPct, lenderCredit: 0, closingCosts, closingCostsFromFeeSheet: false, monthlyMi: mi, quoteDate: '2026-10-26', notes: null })
  const quotes = [quote('UWM', 7.5, 20000, 120), quote('PennyMac', 7.3, 30000, 118, 1), quote('A&D', 7.875, 10000, 125)]
  const figures = compareQuotes(quotes, ctx)
  const options = quotes.map((q, i) => ({ programName: `Program ${q.id}`, quote: q, figures: figures[i], closingCosts: quoteClosingCosts(q, ctx) }))
  const build = (opts = options) => loanComparison({ scenarioId: 'abcd', purpose: 'purchase', scenarioName: 'TBD purchase', hasProperty: false, purchasePrice: 400000, propertyValue: null, loanAmount: 380000, product: 'Conventional 30-year fixed', options: opts, borrowerNames: ['Marcus Reed'], preparedAt: at })

  it('lowest rate first, named by option and program, never the lender', () => {
    const c = build()
    expect(c.columns.map((x) => [x.name, x.program])).toEqual([['Option 1', 'Program PennyMac'], ['Option 2', 'Program UWM'], ['Option 3', 'Program A&D']])
    expect(c.columns.map((x) => x.best)).toEqual([['Lowest rate', 'Lowest payment'], [], ['Lowest cash to close', 'Lowest cost over time']])
  })
  it('the rows match the Loan · Pricing cards', () => {
    const c = build()
    const row = (label: string) => c.rows.find((r) => r.label === label)!.values
    expect(row('Interest rate')).toEqual(['7.3%', '7.5%', '7.875%'])
    expect(row('Points or credit')).toEqual(['1.000 pts', 'None', 'None'])
    expect(row('Estimated cash to close')).toEqual(['$50,000', '$40,000', '$30,000'])
    expect(row('Estimated monthly payment')).toEqual(['$3,606.50', '$3,660.35', '$3,763.59'])
    expect(row('Cost over 5 years')).toEqual(['$213,390', '$206,621', '$202,816'])
    expect(c.facts.find((f) => f.label === 'Property')!.value).toBe('To be determined')
  })
  it(`fits at most ${MAX_COMPARISON_OPTIONS} options on the page`, () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...options[0], quote: { ...options[0].quote, id: `q${i}`, rate: 7 + i / 8 }, figures: { ...options[0].figures, id: `q${i}`, rate: 7 + i / 8 } }))
    expect(build(many).columns).toHaveLength(MAX_COMPARISON_OPTIONS)
  })
})

describe('what a borrower PDF needs', () => {
  const s = { mortgageType: 'conventional' as const, termMonths: 360, noteRate: 6.875, loanAmount: 380000, purchasePrice: 400000, propertyValue: null }
  it('nothing missing on a complete purchase', () => {
    expect(missingForBorrowerPdf(s, 'purchase')).toEqual([])
  })
  it('lists what would print as $0 or blank', () => {
    expect(missingForBorrowerPdf({ ...s, mortgageType: null, termMonths: null }, 'purchase')).toEqual(['loan type', 'term'])
    expect(missingForBorrowerPdf({ ...s, noteRate: null, propertyValue: null }, 'refinance_rate_term')).toEqual(['rate', 'value'])
  })
  it('the comparison takes the rate from each quote', () => {
    expect(missingForBorrowerPdf({ ...s, noteRate: null }, 'purchase', false)).toEqual([])
  })
})
