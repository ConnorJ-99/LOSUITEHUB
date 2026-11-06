import { describe, expect, it } from 'vitest'
import { creditScore, incomeDocType, isForbiddenLabel, loanPurpose, publishProblems, readSubmission, slugify, timeline, type Block } from './blocks'

const prequal: Block[] = [
  { id: 'h', type: 'heading', text: "Let's see what you qualify for", hero: true },
  { id: 'goal', type: 'choice', label: 'Buying or refinancing?', options: ['Buying', 'Refinancing'], mapsTo: 'purpose', required: true },
  { id: 'price', type: 'currency', label: 'Target purchase price', mapsTo: 'purchase_price', required: true },
  { id: 'credit', type: 'dropdown', label: 'Credit range', options: ['Below 620', '620–679', '680–739', '740+'], mapsTo: 'credit_score' },
  { id: 'paid', type: 'choice', label: 'How are you paid?', options: ['W-2', 'Self-employed', '1099', 'Retired'], mapsTo: 'income_doc_type' },
  { id: 'when', type: 'dropdown', label: 'When do you want to buy?', options: ['In the next 3 months', '3–6 months', 'Just looking'], mapsTo: 'timeline' },
  { id: 'name', type: 'short_text', label: 'Full name', mapsTo: 'full_name', required: true },
  { id: 'email', type: 'email', label: 'Email', mapsTo: 'email' },
  { id: 'phone', type: 'phone', label: 'Mobile phone', mapsTo: 'phone' },
  { id: 'docs', type: 'file', label: 'Pay stubs' },
]

describe('readSubmission', () => {
  it('reads a pre-qual into lead fields', () => {
    const r = readSubmission(
      prequal,
      { goal: 'Buying', price: '$425,000', credit: '680–739', paid: 'W-2', when: 'In the next 3 months', name: 'Rita Mae TEST', email: ' Rita@Example.com ', phone: '(214) 555-0100' },
      { docs: [{ path: 'org/page/sub/a.pdf', name: 'a.pdf', size: 10, type: 'application/pdf' }] },
      true,
    )
    expect(r.errors).toEqual({})
    expect(r.mapped).toEqual({
      purpose: 'purchase',
      purchase_price: '425000',
      credit_score: '680',
      income_doc_type: 'full_doc',
      timeline: '3 months',
      first_name: 'Rita',
      last_name: 'Mae TEST',
      email: 'rita@example.com',
      phone: '2145550100',
      sms_consent: 'true',
    })
    expect(r.answers['Target purchase price']).toBe('425000')
    expect(r.answers['Pay stubs']).toBe('a.pdf')
    expect(r.files).toHaveLength(1)
  })

  it('checks required fields, formats and choices', () => {
    const r = readSubmission(prequal, { goal: 'Selling', price: 'lots', email: 'nope', phone: '555' }, {}, false)
    expect(r.errors.goal).toMatch(/choices/)
    expect(r.errors.price).toMatch(/dollar/)
    expect(r.errors.name).toMatch(/required/)
    expect(r.errors.email).toMatch(/email/)
    expect(r.errors.phone).toMatch(/10-digit/)
  })

  it('needs an email or a phone', () => {
    const r = readSubmission(prequal, { goal: 'Buying', price: '400000', name: 'A TEST' }, {}, false)
    expect(r.errors._contact).toBeTruthy()
  })

  it('refuses an SSN typed into a text box, and skips forbidden questions', () => {
    const blocks: Block[] = [
      { id: 'note', type: 'long_text', label: 'Anything else?' },
      { id: 'x', type: 'short_text', label: 'Social Security Number' },
      { id: 'e', type: 'email', label: 'Email', mapsTo: 'email' },
    ]
    const r = readSubmission(blocks, { note: '123-45-6789', x: '111223333', e: 'a@b.co' }, {}, false)
    expect(r.errors.note).toMatch(/Social Security/)
    expect(r.data.find((d) => d.blockId === 'x')).toBeUndefined()
    expect(JSON.stringify(r)).not.toContain('111223333')
  })

  it('does not text without the consent box', () => {
    const r = readSubmission([{ id: 'p', type: 'phone', label: 'Phone', mapsTo: 'phone' }], { p: '2145550100' }, {}, false)
    expect(r.mapped.sms_consent).toBeUndefined()
  })
})

describe('reading answers', () => {
  it('credit ranges become their low end', () => {
    expect(creditScore('700–739')).toBe(700)
    expect(creditScore('Below 620')).toBe(619)
    expect(creditScore('740+')).toBe(740)
    expect(creditScore('not sure')).toBeNull()
  })
  it('purposes', () => {
    expect(loanPurpose('Buying')).toBe('purchase')
    expect(loanPurpose('Refinancing')).toBe('refinance_rate_term')
    expect(loanPurpose('Cash-out refinance')).toBe('refinance_cash_out')
    expect(loanPurpose('HELOC')).toBe('heloc')
  })
  it('income types (self-employed is left to Connor)', () => {
    expect(incomeDocType('W-2')).toBe('full_doc')
    expect(incomeDocType('1099')).toBe('form_1099')
    expect(incomeDocType('Self-employed')).toBeNull()
  })
  it('timelines use the pipeline words', () => {
    expect(timeline('In the next 3 months')).toBe('3 months')
    expect(timeline('3–6 months')).toBe('3–6 months')
    expect(timeline('ASAP')).toBe('ASAP')
    expect(timeline('Just looking')).toBe('Just looking')
    expect(timeline('Spring')).toBe('Spring')
  })
})

describe('builder checks', () => {
  it('slugs', () => {
    expect(slugify('Open House · 4218 Fairway Bend Dr!')).toBe('open-house-4218-fairway-bend-dr')
  })
  it('forbidden labels', () => {
    expect(isForbiddenLabel('Your SSN')).toBe(true)
    expect(isForbiddenLabel('Date of birth')).toBe(true)
    expect(isForbiddenLabel('Move-in date')).toBe(false)
  })
  it('publish problems', () => {
    expect(publishProblems('Quick Pre-Qual', 'prequal', prequal)).toEqual([])
    expect(publishProblems('', 'Bad Slug', [{ id: 'a', type: 'dropdown', label: 'Pick' }])).toHaveLength(4)
  })
})
