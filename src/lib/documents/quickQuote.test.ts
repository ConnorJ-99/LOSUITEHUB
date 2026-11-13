import { describe, expect, it } from 'vitest'
import { blankOption, blankScenario, optionFigures, type QuoteScenario } from '@/lib/quickquote/quote'
import { quickQuoteDoc, quoteFileName, scenarioChips } from './quickQuote'

const s: QuoteScenario = { ...blankScenario(), borrower: { name: 'Jordan Reyes TEST', email: '', phone: '' }, purchasePrice: 425000, downPayment: 21250, creditBucket: 700, county: 'Collin', firstTimeBuyer: true }
const a = blankOption('a', { ratePct: 6.375, lenderName: 'Lender A TEST' })
const b = blankOption('b', { mortgageType: 'fha', ratePct: 5.875, downPayment: 14875 })
const c = blankOption('c', { ratePct: 6, pointsPct: 1, recommended: true })
const off = blankOption('d', { ratePct: 7, onQuote: false })
const blank = blankOption('e')
const options = [a, b, c, off, blank]
const figures = new Map(options.map((o) => [o.id, optionFigures(s, o, [])]).filter(([, f]) => f) as [string, NonNullable<ReturnType<typeof optionFigures>>][])

describe('Loan Options Quote', () => {
  const doc = quickQuoteDoc({ scenario: s, options, figures, note: ' Jordan, here are three ways to buy. ', preparedOn: '2026-10-30', validThrough: '2026-11-06', loName: 'Connor TEST', bookingUrl: 'https://book.example.test/connor' })

  it('shows the chips for the scenario', () => {
    expect(doc.chips).toEqual(['Purchase · $425,000', 'Primary residence', 'Single family', 'Collin County, TX', 'Est. credit 700–719', 'First-time buyer'])
    expect(scenarioChips({ ...s, purpose: 'refinance_cash_out', value: 500000, county: null, creditBucket: null, firstTimeBuyer: false })).toEqual(['Cash-out refinance · value $500,000', 'Primary residence', 'Single family'])
  })

  it('has only the priced options on the quote, lettered in screen order, with no lender', () => {
    expect(doc.columns.map((c) => `${c.letter} ${c.title} · ${c.sub}`)).toEqual(['Option A Conventional · 30-yr fixed · no points', 'Option B FHA · 30-yr fixed · no points', 'Option C Conventional · 30-yr fixed · 1.000 pts'])
    expect(JSON.stringify(doc)).not.toContain('Lender A TEST')
    expect(doc.highlight).toBe(2)
  })

  it('labels the automatic badges (Recommended is the shading)', () => {
    expect(doc.columns.map((c) => c.badges)).toEqual([[], ['Least cash to close'], ['Lowest payment']])
  })

  it('has the spec rows in order', () => {
    expect(doc.rows.map((r) => r.label)).toEqual(['Interest rate', 'APR (estimated)', 'Discount points', 'Down payment', 'Loan amount', 'Principal & interest', 'Mortgage insurance', 'Est. taxes & insurance', 'Est. monthly payment', 'Est. cash to close'])
    const row = (l: string) => doc.rows.find((r) => r.label === l)!.values
    expect(row('Interest rate')).toEqual(['6.375%', '5.875%', '6%'])
    expect(row('Down payment')).toEqual(['5% · $21,250', '3.5% · $14,875', '5% · $21,250'])
    expect(row('Discount points')).toEqual(['None', 'None', '1.000 · $4,038'])
    expect(row('Loan amount')).toEqual(['$403,750', '$417,302', '$403,750'])
  })

  it('keeps the note, next steps, valid-through and booking link', () => {
    expect(doc).toMatchObject({ borrowerName: 'Jordan Reyes TEST', preparedOn: 'Oct 30, 2026', validThrough: 'Nov 6, 2026', note: 'Jordan, here are three ways to buy.', loFirstName: 'Connor', bookingUrl: 'https://book.example.test/connor' })
    expect(doc.nextSteps).toHaveLength(3)
  })

  it('a cash-out refinance shows the cash out and money back', () => {
    const refi: QuoteScenario = { ...s, purpose: 'refinance_cash_out', value: 600000, loanBalance: 200000, cashOut: 100000 }
    const f = new Map([['a', optionFigures(refi, a, [])!]])
    const d = quickQuoteDoc({ scenario: refi, options: [a], figures: f, note: '', preparedOn: '2026-10-30', validThrough: '2026-11-06', loName: '', bookingUrl: null })
    expect(d.rows.map((r) => r.label)).toContain('Cash out')
    expect(d.rows.at(-1)!.values[0]).toMatch(/ back$/)
    expect(d).toMatchObject({ note: null, highlight: -1, loFirstName: 'your loan officer' })
  })

  it('names the file', () => {
    expect(quoteFileName('Jordan Reyes TEST', '2026-10-30')).toBe('Loan Options Quote - Jordan Reyes TEST - 2026-10-30.pdf')
    expect(quoteFileName('a/b', '2026-10-30')).toBe('Loan Options Quote - a b - 2026-10-30.pdf')
  })
})
