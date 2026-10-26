import { describe, expect, it } from 'vitest'
import { answerLines, fieldLabel, personFromAnswers } from './webForms'

describe('web form answers', () => {
  it('turns field names into labels', () => {
    expect(fieldLabel('purchase_price')).toBe('Purchase price')
    expect(fieldLabel('homeValue')).toBe('Home value')
    expect(fieldLabel('utm-source')).toBe('Utm source')
  })
  it('lists answers, skipping empty ones and contact details already on the file', () => {
    expect(answerLines({ first_name: 'Jane', email: 'j@example.com', purchase_price: 500000, timeline: '', notes: null, utm_source: 'google', external_id: 'w-1', extras: { a: 1 } })).toEqual([
      { label: 'Purchase price', value: '500000' },
      { label: 'Extras', value: '{"a":1}' },
    ])
  })
})

describe('personFromAnswers', () => {
  it('reads a partner inquiry', () => {
    expect(personFromAnswers({ first_name: 'Rita', last_name: 'Realtor', email: 'rita@example.com', phone: '2145550100', brokerage: 'Sample Realty' })).toEqual({ name: 'Rita Realtor', contactLine: 'rita@example.com · 2145550100 · Sample Realty' })
    expect(personFromAnswers({ name: 'Bob Builder', company: 'Homes Inc' })).toEqual({ name: 'Bob Builder', contactLine: 'Homes Inc' })
    expect(personFromAnswers({})).toEqual({ name: 'Someone', contactLine: null })
  })
})
