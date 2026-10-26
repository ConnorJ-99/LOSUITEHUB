import { describe, expect, it } from 'vitest'
import { ASSET_OPTIONS, LIABILITY_OPTIONS, OTHER_INCOME_OPTIONS } from '../../../src/lib/urla/options'
import { ASSET_TYPES, DEBT_TYPES, INCOME_TYPES, NOTES_SCHEMA, normalizeNotes, parseAmount } from './callNotes'

const NOTE = 'Marcus, landscaping biz 6 yrs, ~$9,800/mo, house worth 467, owes 282, wants 75K cash out, 652 credit, one late on truck 2024. Wife Maria 700 score.'
const none = { found: false, value: '', quote: '', confidence: 'high' }
const empty = { loan_type: none, purchase_price: none, down_payment: none, down_payment_pct: none, income_doc_type: none, timeline: none, credit_scores: [], first_time_buyers: [], jobs: [], other_incomes: [], debts: [], savings: [], homes: [], credit_events: [], notes: '' }

describe('lists match the app', () => {
  it('uses the same income, asset and debt types as the 1003', () => {
    expect([...INCOME_TYPES]).toEqual(OTHER_INCOME_OPTIONS.map((o) => o.value))
    expect([...ASSET_TYPES]).toEqual(ASSET_OPTIONS.map((o) => o.value))
    expect([...DEBT_TYPES]).toEqual(LIABILITY_OPTIONS.map((o) => o.value))
  })
  it('asks for every part', () => {
    expect(NOTES_SCHEMA.required).toContain('credit_events')
    expect(NOTES_SCHEMA.required).toHaveLength(15)
  })
})

describe('parseAmount', () => {
  it('reads digits only', () => {
    expect(parseAmount('$9,800')).toBe(9800)
    expect(parseAmount('467000')).toBe(467000)
    expect(parseAmount('about 9800')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })
})

describe('normalizeNotes', () => {
  it("reads Marcus's call", () => {
    const r = normalizeNotes(
      {
        ...empty,
        credit_scores: [
          { borrower: '', score: '652', quote: '652 credit', confidence: 'high' },
          { borrower: 'Maria', score: '700', quote: 'Wife Maria 700 score', confidence: 'high' },
        ],
        jobs: [{ borrower: '', employer: 'landscaping business', self_employed: true, monthly_income: '9800', start_date: '', years: '6', quote: 'landscaping biz 6 yrs, ~$9,800/mo', confidence: 'medium' }],
        homes: [{ address: 'current house', value: '467000', owed: '282000', plan: 'keep', monthly_rent: '', quote: 'house worth 467, owes 282', confidence: 'high' }],
        credit_events: [{ borrower: '', event_type: 'late_payment', date: '2024-01-01', days_late: '', is_mortgage: false, quote: 'one late on truck 2024', confidence: 'medium' }],
        notes: 'Wants $75,000 cash out.',
      },
      NOTE,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.items.map((i) => i.kind)).toEqual(['credit_score', 'credit_score', 'job', 'home', 'credit_event'])
    expect(r.items[1]).toMatchObject({ kind: 'credit_score', value: 700, borrower: 'Maria', quoteFound: true })
    expect(r.items[2]).toMatchObject({ kind: 'job', employer: 'landscaping business', selfEmployed: true, monthly: 9800, startDate: null, borrower: null, confidence: 'medium' })
    expect(r.items[3]).toMatchObject({ kind: 'home', value: 467000, owed: 282000, plan: 'keep', monthlyRent: null })
    // Days late weren't said: a late payment counts as 30 days until Connor changes it.
    expect(r.items[4]).toMatchObject({ kind: 'credit_event', eventType: 'late_payment', daysLate: 30, isMortgage: false, date: '2024-01-01' })
    expect(r.notes).toBe('Wants $75,000 cash out.')
  })

  it('marks items whose quote is not in the note as low confidence', () => {
    const r = normalizeNotes({ ...empty, credit_scores: [{ borrower: '', score: '720', quote: '720 credit', confidence: 'high' }] }, NOTE)
    if ('error' in r) throw new Error(r.error)
    expect(r.items[0]).toMatchObject({ value: 720, quoteFound: false, confidence: 'low' })
  })

  it('drops values that are not clean', () => {
    const r = normalizeNotes(
      {
        ...empty,
        purchase_price: { found: true, value: 'around 400', quote: 'house', confidence: 'high' },
        down_payment_pct: { found: true, value: '350', quote: 'house', confidence: 'high' },
        credit_scores: [{ borrower: '', score: '65', quote: '652 credit', confidence: 'high' }],
        debts: [{ borrower: '', debt_type: 'mortgage', creditor: 'x', monthly_payment: '100', balance: '', pay_off: false, quote: 'truck', confidence: 'high' }],
        timeline: { found: true, value: 'spring', quote: 'Marcus', confidence: 'high' },
      },
      NOTE,
    )
    if ('error' in r) throw new Error(r.error)
    expect(r.items.map((i) => i.kind)).toEqual(['timeline'])
  })

  it('says when nothing usable was found', () => {
    expect(normalizeNotes(empty, NOTE)).toEqual({ error: "The assistant didn't find anything to use in this note." })
    expect(normalizeNotes('x', NOTE)).toHaveProperty('error')
  })
})
