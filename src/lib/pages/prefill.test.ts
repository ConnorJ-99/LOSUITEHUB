import { describe, expect, it } from 'vitest'
import { prefillAnswers } from './prefill'
import type { Block } from '../../../supabase/functions/page-submit/blocks'

const blocks: Block[] = [
  { id: 'n', type: 'short_text', label: 'Full name', mapsTo: 'full_name' },
  { id: 'e', type: 'email', label: 'Email', mapsTo: 'email' },
  { id: 'p', type: 'phone', label: 'Phone', mapsTo: 'phone' },
  { id: 'price', type: 'currency', label: 'Price', mapsTo: 'purchase_price' },
  { id: 'down', type: 'currency', label: 'Down', mapsTo: 'down_payment' },
  { id: 'when', type: 'dropdown', label: 'When', options: ['ASAP', '3 months'], mapsTo: 'timeline' },
  { id: 'note', type: 'long_text', label: 'Anything else?' },
]

describe('personal link prefill', () => {
  it('fills mapped questions from the file', () => {
    expect(prefillAnswers(blocks, { first_name: 'Rita', last_name: 'TEST', email: 'rita@example.com', phone: '2145550160', purchase_price: '400000', loan_amount: '380000', timeline: '3 months' })).toEqual({
      n: 'Rita TEST',
      e: 'rita@example.com',
      p: '(214) 555-0160',
      price: '400,000',
      down: '20,000',
      when: '3 months',
    })
  })
  it('skips a dropdown value that is not one of its choices, and blanks', () => {
    expect(prefillAnswers(blocks, { timeline: 'Spring', first_name: 'Rita' })).toEqual({ n: 'Rita' })
  })
})
