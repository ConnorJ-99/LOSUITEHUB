import { describe, expect, it } from 'vitest'
import type { DocumentRequest } from '@/lib/api/documentRules'
import type { LoanDocument } from '@/lib/api/documents'
import { matchingDocument, requestProgress, untrackedItems } from './requests'

const req = (over: Partial<DocumentRequest>): DocumentRequest => ({ id: 'r1', contactId: 'dana', ruleKey: 'paystubs', label: 'Pay stubs', kind: 'paystub', status: 'requested', requestedAt: '2026-10-20T00:00:00Z', receivedAt: null, reviewedAt: null, documentId: null, ...over })
const doc = (over: Partial<LoanDocument>): LoanDocument => ({ id: 'd1', kind: 'paystub', contactId: 'dana', propertyId: null, fileName: 'stub.pdf', storagePath: 'x', contentType: 'application/pdf', sizeBytes: 1, createdAt: '2026-10-21T00:00:00Z', ...over })

describe('matchingDocument', () => {
  it('finds the newest upload of the same type for the same person', () => {
    const docs = [doc({ id: 'old' }), doc({ id: 'new', createdAt: '2026-10-22T00:00:00Z' }), doc({ id: 'chris', contactId: 'chris', createdAt: '2026-10-23T00:00:00Z' })]
    expect(matchingDocument(req({}), docs, [])?.id).toBe('new')
  })
  it('skips documents already used for another request, and other types', () => {
    const docs = [doc({ id: 'a' }), doc({ id: 'w2', kind: 'w2' })]
    expect(matchingDocument(req({}), docs, [req({ id: 'r2', documentId: 'a' })])).toBeNull()
  })
  it('file-wide items accept anyone; "other" never auto-matches', () => {
    expect(matchingDocument(req({ contactId: null, kind: 'mortgage_statement' }), [doc({ kind: 'mortgage_statement', contactId: null })], [])).not.toBeNull()
    expect(matchingDocument(req({ kind: 'other' }), [doc({ kind: 'other' })], [])).toBeNull()
  })
})

describe('requestProgress', () => {
  it('counts received and reviewed out of everything not waived', () => {
    expect(requestProgress([req({ status: 'received' }), req({ status: 'reviewed' }), req({}), req({ status: 'waived' })])).toEqual({ done: 2, reviewed: 1, total: 3 })
  })
})

describe('untrackedItems', () => {
  it('lists checklist items not being tracked yet', () => {
    const checklist = [
      { title: 'Dana', contactId: 'dana', items: [{ key: 'paystubs', short: 'p', full: 'Pay stubs', kind: 'paystub' as const }, { key: 'w2s', short: 'w', full: 'W-2s', kind: 'w2' as const }] },
      { title: 'Homes you own', contactId: null, items: [{ key: 'home_statements', short: 'h', full: 'Mortgage statements', kind: 'mortgage_statement' as const }] },
    ]
    expect(untrackedItems(checklist, [req({})])).toEqual([
      { contactId: 'dana', who: 'Dana', key: 'w2s', label: 'W-2s', kind: 'w2' },
      { contactId: null, who: 'Homes you own', key: 'home_statements', label: 'Mortgage statements', kind: 'mortgage_statement' },
    ])
  })
})
