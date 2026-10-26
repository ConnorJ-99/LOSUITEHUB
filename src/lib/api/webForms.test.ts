import { describe, expect, it } from 'vitest'
import { answerLines, fieldLabel } from './webForms'

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
