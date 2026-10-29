import { describe, expect, it } from 'vitest'
import { CONTRACT_FIELDS, CONTRACT_SCHEMA, CONTRACT_USER_PROMPT, normalizeReading, parseFieldValue } from './contract'

const def = (key: string) => CONTRACT_FIELDS.find((f) => f.key === key)!
const allMissing = CONTRACT_FIELDS.map((f) => ({ key: f.key, found: false, value: '', quote: '', page: 0, confidence: 'high' }))

describe('parseFieldValue', () => {
  it('reads money', () => {
    expect(parseFieldValue(def('sales_price'), '$307,000')).toBe(307000)
    expect(parseFieldValue(def('option_fee'), '250.50')).toBe(250.5)
    expect(parseFieldValue(def('sales_price'), 'three hundred thousand')).toBeNull()
    expect(parseFieldValue(def('sales_price'), '-5')).toBeNull()
  })
  it('reads only real dates in YYYY-MM-DD', () => {
    expect(parseFieldValue(def('closing_date'), '2026-11-07')).toBe('2026-11-07')
    expect(parseFieldValue(def('closing_date'), '2026-02-30')).toBeNull()
    expect(parseFieldValue(def('closing_date'), '11/07/2026')).toBeNull()
  })
  it('reads day counts, choices and yes/no', () => {
    expect(parseFieldValue(def('option_period_days'), '7')).toBe(7)
    expect(parseFieldValue(def('option_period_days'), '7.5')).toBeNull()
    expect(parseFieldValue(def('financing_type'), 'FHA')).toBe('fha')
    expect(parseFieldValue(def('financing_type'), 'jumbo')).toBeNull()
    expect(parseFieldValue(def('hoa_addendum'), 'Yes')).toBe(true)
    expect(parseFieldValue(def('hoa_addendum'), 'no')).toBe(false)
    expect(parseFieldValue(def('hoa_addendum'), 'maybe')).toBeNull()
  })
})

describe('CONTRACT_SCHEMA', () => {
  it('asks for every field, with one shared term shape', () => {
    expect(CONTRACT_SCHEMA.properties.fields.items.properties.key.enum).toEqual(CONTRACT_FIELDS.map((f) => f.key))
    for (const f of CONTRACT_FIELDS) expect(CONTRACT_USER_PROMPT).toContain(`- ${f.key} (${f.label}): ${f.hint}`)
    expect(CONTRACT_USER_PROMPT).toContain('(one of: conventional, fha, va, usda_rural, other)')
  })
})

describe('normalizeReading', () => {
  it('keeps found terms, lists unreadable ones and checks contacts', () => {
    const r = normalizeReading({
      fields: [
        ...allMissing,
        { key: 'option_fee', found: true, value: '200', quote: '', page: 0, confidence: 'high' },
        { key: 'closing_date', found: true, value: 'Nov 7', quote: 'on or before November 7', page: 4, confidence: 'medium' },
        { key: 'sales_price', found: true, value: '307000', quote: 'Sales Price (Sum of A and B) $307,000', page: 1, confidence: 'high' },
        // Listed twice: the first found entry wins. Keys off the list are ignored.
        { key: 'sales_price', found: true, value: '1', quote: 'x', page: 2, confidence: 'low' },
        { key: 'lender_name', found: true, value: 'Sample Bank', quote: 'Sample Bank', page: 1, confidence: 'high' },
      ],
      contacts: [
        { role: 'listing_agent', name: 'Sample Agent', company: 'Sample Realty', email: '', phone: '555-555-0101', quote: 'Listing Associate: Sample Agent', page: 9 },
        { role: 'landlord', name: 'X', company: '', email: '', phone: '', quote: '', page: 1 },
        { role: 'buyer', name: '  ', company: '', email: '', phone: '', quote: '', page: 1 },
      ],
      notes: ' Handwritten change to closing date, initialed. ',
    })
    expect(r).toEqual({
      fields: [
        { key: 'sales_price', value: 307000, text: '307000', quote: 'Sales Price (Sum of A and B) $307,000', page: 1, confidence: 'high' },
        // No quote: kept, but marked low so Connor checks it.
        { key: 'option_fee', value: 200, text: '200', quote: '', page: null, confidence: 'low' },
      ],
      contacts: [{ role: 'listing_agent', name: 'Sample Agent', company: 'Sample Realty', email: null, phone: '555-555-0101', quote: 'Listing Associate: Sample Agent', page: 9 }],
      notes: 'Handwritten change to closing date, initialed.',
      unreadable: [{ key: 'closing_date', text: 'Nov 7' }],
    })
  })
  it('explains when nothing was found', () => {
    expect(normalizeReading({ fields: allMissing, contacts: [], notes: '' })).toHaveProperty('error')
    expect(normalizeReading('nope')).toHaveProperty('error')
    // The old shape (one object per term) is not accepted.
    expect(normalizeReading({ fields: { sales_price: { found: true, value: '1' } }, contacts: [], notes: '' })).toHaveProperty('error')
  })
})
