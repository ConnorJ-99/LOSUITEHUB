import { describe, expect, it } from 'vitest'
import { documentSuggestions, type AnalyzedDoc } from './fromDocuments'

const doc = (over: Partial<AnalyzedDoc>): AnalyzedDoc => ({ documentId: 'd1234567-0000', contactId: 'pat', fileName: 'stub.pdf', kind: 'paystub', fields: {}, flags: [], ...over })

describe('suggested conditions from uploads', () => {
  it('an old pay stub asks for an updated one, naming the employer', () => {
    const s = documentSuggestions([doc({ fields: { employer_name: { value: 'Excel', quote: '' } }, flags: [{ code: 'old_paystub', text: 'The pay stub is from Sep 15, 2026, over 30 days old' }] })])
    expect(s).toEqual([
      expect.objectContaining({ key: 'doc_old_paystub:d1234567-0000', body: 'Updated pay stub covering the last 30 days: Excel', why: 'The pay stub is from Sep 15, 2026, over 30 days old', kind: 'paystub', party: 'borrower', source: { kind: 'ai', label: 'Upload: stub.pdf', citation: null } }),
    ])
  })
  it('a date conflict asks for a letter; an unknown employer goes to the LO to confirm', () => {
    const s = documentSuggestions([
      doc({ kind: 'w2', flags: [{ code: 'dates_conflict', text: 'The W-2 shows Excel earnings in 2024, but the 1003 start date is Jun 2025' }, { code: 'employer_not_on_1003', text: 'x', employer: 'Walmart' }] }),
    ])
    expect(s.map((x) => [x.body, x.party])).toEqual([
      ['Letter of explanation: The W-2 shows Excel earnings in 2024, but the 1003 start date is Jun 2025', 'borrower'],
      ['Confirm employment history: Walmart is on an upload but not on the 1003', 'processor_lo'],
    ])
  })
  it('type mismatch and low confidence are for the Documents tab, not conditions', () => {
    expect(documentSuggestions([doc({ flags: [{ code: 'type_mismatch', text: 'x' }, { code: 'low_confidence', text: 'y' }] })])).toEqual([])
  })
  it('a missing statement month for one account', () => {
    const stmt = (id: string, start: string, end: string): AnalyzedDoc =>
      doc({ documentId: id, kind: 'bank_statement', fields: { institution: { value: 'Chase', quote: '' }, account_last4: { value: '1234', quote: '' }, statement_period_start: { value: start, quote: '' }, statement_period_end: { value: end, quote: '' } } })
    const s = documentSuggestions([stmt('a', '2026-07-01', '2026-07-31'), stmt('b', '2026-09-01', '2026-09-30')])
    expect(s.map((x) => [x.key, x.body])).toEqual([['doc_statement_gap:pat:1234:2026-07-31', 'Missing statement between Jul 2026 and Sep 2026: Chase ••1234']])
  })
})
