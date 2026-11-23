import { describe, expect, it } from 'vitest'
import { CD_FIELDS, CD_SCHEMA, CD_USER_PROMPT, normalizeCdReading, parseCdValue, splitCdAddress, targetValue } from './closingDisclosure'

const def = (key: string) => CD_FIELDS.find((f) => f.key === key)!
const allMissing = () => CD_FIELDS.map((f) => ({ key: f.key, found: false, value: '', quote: '', page: 0, confidence: 'high' }))
const withFound = (found: Record<string, [string, string?]>) =>
  allMissing().map((f) => (found[f.key] ? { ...f, found: true, value: found[f.key][0], quote: found[f.key][1] ?? `${f.key} ${found[f.key][0]}`, page: 1 } : f))

describe('parseCdValue', () => {
  it('reads money, keeping the amount of a credit written as a negative', () => {
    expect(parseCdValue(def('loan_amount'), '$320,000')).toBe(320000)
    expect(parseCdValue(def('lender_credits'), '-$1,250.00')).toBe(1250)
    expect(parseCdValue(def('lender_credits'), '($1,250.50)')).toBe(1250.5)
    expect(parseCdValue(def('loan_amount'), 'three hundred')).toBeNull()
  })
  it('reads a rate as a percent', () => {
    expect(parseCdValue(def('interest_rate'), '6.375%')).toBe(6.375)
    expect(parseCdValue(def('interest_rate'), '0')).toBeNull()
    expect(parseCdValue(def('interest_rate'), '63.75')).toBeNull()
  })
  it('reads only real dates in YYYY-MM-DD', () => {
    expect(parseCdValue(def('closing_date'), '2026-12-04')).toBe('2026-12-04')
    expect(parseCdValue(def('closing_date'), '2026-02-30')).toBeNull()
    expect(parseCdValue(def('closing_date'), '12/04/2026')).toBeNull()
  })
  it('turns the loan term into months', () => {
    expect(parseCdValue(def('loan_term'), '30 years')).toBe(360)
    expect(parseCdValue(def('loan_term'), '15 yrs')).toBe(180)
    expect(parseCdValue(def('loan_term'), '360 months')).toBe(360)
    expect(parseCdValue(def('loan_term'), '50 years')).toBeNull()
    expect(parseCdValue(def('loan_term'), 'thirty years')).toBeNull()
  })
  it('keeps short text and never an SSN', () => {
    expect(parseCdValue(def('lender_loan_number'), '7001234567')).toBe('7001234567')
    expect(parseCdValue(def('lender_loan_number'), '123-45-6789')).toBeNull()
    expect(parseCdValue(def('lender_name'), 'x'.repeat(61))).toBeNull()
  })
})

describe('targetValue', () => {
  it('keeps 12 times a monthly escrow amount for the home', () => {
    expect(targetValue(def('tax_monthly'), 612.5)).toBe(7350)
    expect(targetValue(def('insurance_monthly'), 175.33)).toBe(2103.96)
  })
  it('keeps every other figure as read', () => {
    expect(targetValue(def('loan_amount'), 320000)).toBe(320000)
    expect(targetValue(def('closing_date'), '2026-12-04')).toBe('2026-12-04')
  })
})

describe('the field list', () => {
  it('has unique keys, and each place on the file is filled by one figure', () => {
    expect(new Set(CD_FIELDS.map((f) => f.key)).size).toBe(CD_FIELDS.length)
    const targets = CD_FIELDS.map((f) => f.target).filter(Boolean)
    expect(new Set(targets).size).toBe(targets.length)
  })
  it('keeps cash to close, closing costs and broker comp as checks only (Connor, 2026-11-19)', () => {
    for (const k of ['cash_to_close', 'total_closing_costs', 'broker_compensation']) expect(def(k).target).toBeNull()
  })
  it('lists every figure in the prompt and the schema', () => {
    for (const f of CD_FIELDS) expect(CD_USER_PROMPT).toContain(`- ${f.key} (`)
    expect(CD_SCHEMA.properties.fields.items.properties.key.enum).toEqual(CD_FIELDS.map((f) => f.key))
  })
})

describe('normalizeCdReading', () => {
  it('keeps found figures with their quotes and pages', () => {
    const r = normalizeCdReading({ is_closing_disclosure: true, fields: withFound({ loan_amount: ['320000', 'Loan Amount $320,000'], loan_term: ['30 years'] }), notes: '' })
    if ('error' in r) throw new Error(r.error)
    expect(r.fields).toEqual([
      { key: 'loan_amount', value: 320000, text: '320000', quote: 'Loan Amount $320,000', page: 1, confidence: 'high' },
      { key: 'loan_term', value: 360, text: '30 years', quote: 'loan_term 30 years', page: 1, confidence: 'high' },
    ])
    expect(r.notes).toBeNull()
  })
  it('lists values it couldn\'t read instead of guessing', () => {
    const r = normalizeCdReading({ is_closing_disclosure: true, fields: withFound({ loan_amount: ['320000'], closing_date: ['Dec 4th'] }), notes: '' })
    if ('error' in r) throw new Error(r.error)
    expect(r.unreadable).toEqual([{ key: 'closing_date', text: 'Dec 4th' }])
  })
  it('a figure with no quote is low confidence', () => {
    const fields = withFound({ loan_amount: ['320000'] }).map((f) => (f.key === 'loan_amount' ? { ...f, quote: '' } : f))
    const r = normalizeCdReading({ is_closing_disclosure: true, fields, notes: '' })
    if ('error' in r) throw new Error(r.error)
    expect(r.fields[0].confidence).toBe('low')
  })
  it('never keeps an SSN, in a value, a quote or the notes', () => {
    const fields = withFound({ lender_loan_number: ['123-45-6789'], loan_amount: ['320000', 'Borrower 123-45-6789 Loan Amount $320,000'] })
    const r = normalizeCdReading({ is_closing_disclosure: true, fields, notes: 'SSN 123-45-6789 shown' })
    if ('error' in r) throw new Error(r.error)
    expect(JSON.stringify(r)).not.toContain('123-45-6789')
    expect(r.unreadable).toEqual([{ key: 'lender_loan_number', text: '(not kept)' }])
    expect(r.fields[0]).toMatchObject({ quote: '', confidence: 'low' })
  })
  it('the first found entry of a figure wins', () => {
    const fields = [...withFound({ loan_amount: ['320000'] }), { key: 'loan_amount', found: true, value: '999', quote: 'x', page: 1, confidence: 'high' }]
    const r = normalizeCdReading({ is_closing_disclosure: true, fields, notes: '' })
    if ('error' in r) throw new Error(r.error)
    expect(r.fields.filter((f) => f.key === 'loan_amount')).toHaveLength(1)
    expect(r.fields[0].value).toBe(320000)
  })
  it('says so when the document isn\'t a Closing Disclosure', () => {
    expect(normalizeCdReading({ is_closing_disclosure: false, fields: withFound({ loan_amount: ['320000'] }), notes: '' })).toEqual({ error: expect.stringContaining("doesn't look like a Closing Disclosure") })
  })
  it('says so when nothing was found, or the reply is unreadable', () => {
    expect(normalizeCdReading({ is_closing_disclosure: true, fields: allMissing(), notes: '' })).toHaveProperty('error')
    expect(normalizeCdReading('nonsense')).toHaveProperty('error')
  })
})

describe('the property address', () => {
  it('splits street, city, state and ZIP', () => {
    expect(splitCdAddress('1420 Oak Ridge Dr, Frisco, TX 75034')).toEqual({ line: '1420 Oak Ridge Dr', city: 'Frisco', state: 'TX', zip: '75034' })
    expect(splitCdAddress('1420 Oak Ridge Dr\nFrisco, tx 75034-1234')).toEqual({ line: '1420 Oak Ridge Dr', city: 'Frisco', state: 'TX', zip: '75034' })
    expect(splitCdAddress('88 Willow Bend Ct, Unit 4, McKinney, TX')).toEqual({ line: '88 Willow Bend Ct, Unit 4', city: 'McKinney', state: 'TX', zip: null })
    expect(splitCdAddress('Frisco, TX 75034')).toBeNull()
    expect(splitCdAddress('Oak Ridge Dr, Frisco, TX')).toBeNull()
  })
  it('reads it as one line, or not at all', () => {
    const def = CD_FIELDS.find((d) => d.key === 'property_address')!
    expect(parseCdValue(def, '1420 Oak Ridge Dr\nFrisco, TX 75034')).toBe('1420 Oak Ridge Dr, Frisco, TX 75034')
    expect(parseCdValue(def, 'See attached')).toBeNull()
  })
})
