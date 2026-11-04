import { describe, expect, it } from 'vitest'
import type { PipelineLoan } from '@/lib/api/types'
import { bulkAudience, mergeFirstName, withOptOut, type BulkPerson } from './filters'

const ME = 'me'
const L = (id: string, stage: string, contact: string, o: Partial<PipelineLoan> = {}): PipelineLoan =>
  ({
    id,
    purpose: 'purchase',
    stage,
    closingDate: null,
    createdAt: `2026-01-${String(id.length).padStart(2, '0')}`,
    assignedLo: { id: ME, name: 'Me' },
    borrower: { id: contact, firstName: contact.toUpperCase(), lastName: 'TEST', email: null, phone: null },
    ...o,
  }) as PipelineLoan
const P = (id: string, o: Partial<BulkPerson> = {}): [string, BulkPerson] => [
  id,
  { id, firstName: id, lastName: 'TEST', phone: '2145550100', email: `${id}@example.com`, smsConsent: true, emailConsent: true, smsOptedOutAt: null, emailOptedOutAt: null, ghlContactId: `g-${id}`, ...o },
]

describe('bulkAudience', () => {
  const people = new Map([P('a'), P('b', { smsConsent: null }), P('c', { smsOptedOutAt: '2026-01-01' }), P('d', { ghlContactId: null }), P('e', { phone: null }), P('f')])
  const loans = [
    L('1', 'closed', 'a', { closingDate: '2024-05-01' }),
    L('2', 'closed', 'b'),
    L('3', 'under_contract', 'c'),
    L('4', 'processing', 'd'),
    L('5', 'closed', 'e'),
    L('6', 'lead', 'f'),
    L('7', 'closed', 'x', { assignedLo: { id: 'someone-else', name: 'Other' } }),
  ]
  it('current and past clients by text: only consented, in GHL, with a phone; mine only; a reason for the rest', () => {
    const r = bulkAudience(loans, people, { segment: 'all_clients', channel: 'text', me: ME })
    expect(r.recipients.map((x) => x.contactId)).toEqual(['a'])
    expect(Object.fromEntries(r.excluded.map((x) => [x.name, x.reason]))).toEqual({ 'B TEST': 'no_consent', 'C TEST': 'opted_out', 'D TEST': 'no_ghl_contact', 'E TEST': 'no_phone' })
  })
  it('closed in a year', () => {
    expect(bulkAudience(loans, people, { segment: 'closed_in_year', year: 2024, channel: 'text', me: ME }).recipients.map((x) => x.contactId)).toEqual(['a'])
  })
  it('leads are their own segment', () => {
    expect(bulkAudience(loans, people, { segment: 'leads', channel: 'text', me: ME }).recipients.map((x) => x.contactId)).toEqual(['f'])
  })
  it('one message per person, on their newest file', () => {
    const twice = [L('1', 'closed', 'a'), L('22', 'under_contract', 'a')]
    expect(bulkAudience(twice, people, { segment: 'all_clients', channel: 'text', me: ME }).recipients).toEqual([{ contactId: 'a', loanId: '22', name: 'A TEST', firstName: 'A' }])
  })
  it('email needs email consent, not text consent', () => {
    const p = new Map([P('a', { smsConsent: null, emailConsent: true })])
    expect(bulkAudience([L('1', 'closed', 'a')], p, { segment: 'past_clients', channel: 'email', me: ME }).recipients.length).toBe(1)
    expect(bulkAudience([L('1', 'closed', 'a')], p, { segment: 'past_clients', channel: 'text', me: ME }).recipients.length).toBe(0)
  })
})

describe('bulk wording', () => {
  it('fills the first name', () => {
    expect(mergeFirstName('Happy New Year, {first name}!', 'Rita')).toBe('Happy New Year, Rita!')
    expect(mergeFirstName('Hi {First_Name}', '')).toBe('Hi there')
  })
  it('adds the opt-out line once', () => {
    expect(withOptOut('Happy New Year!')).toBe('Happy New Year! Reply STOP to opt out.')
    expect(withOptOut('Happy New Year! Reply STOP to opt out.')).toBe('Happy New Year! Reply STOP to opt out.')
  })
})
