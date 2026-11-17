import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '@/lib/documents/uploadRequests'
import { catalogConditionBody, catalogConditionKey, isCatalogKey, linkItemsFor, parseCatalogKey, requestsUnder, type LinkCondition, type LinkRequest } from './catalog'

const cat = (key: string, label: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ id: key, key, category: 'income', label, instructions: `Send your ${label.toLowerCase()}`, period: null, kind: 'other', sortOrder: 0, active: true, builtIn: true, ...extra })
const catalog = [cat('paystubs', 'Pay stubs', { kind: 'paystub' }), cat('photo_id', 'Photo ID'), cat('old', 'Old thing', { active: false })]
const cond = (id: string, body: string, extra: Partial<LinkCondition> = {}): LinkCondition => ({ id, body, notes: null, sourceKey: null, documentRequestId: null, ...extra })
const req = (id: string, extra: Partial<LinkRequest> = {}): LinkRequest => ({ id, conditionId: null, contactId: 'pat', ruleKey: 'paystubs', label: 'Pay stubs', instructions: null, kind: 'paystub', status: 'requested', ...extra })

describe('catalog condition keys', () => {
  it('round-trips the item and the person', () => {
    expect(catalogConditionKey('paystubs', 'pat')).toBe('cat_paystubs:pat')
    expect(parseCatalogKey('cat_paystubs:pat')).toEqual({ key: 'paystubs', contactId: 'pat' })
    expect(parseCatalogKey(catalogConditionKey('photo_id', null))).toEqual({ key: 'photo_id', contactId: null })
  })
  it('only reads its own keys', () => {
    expect(isCatalogKey('cat_paystubs:pat')).toBe(true)
    expect(isCatalogKey('cond_va_coe:pat')).toBe(false)
    expect(parseCatalogKey('paystubs:pat')).toBeNull()
    expect(parseCatalogKey(null)).toBeNull()
  })
  it('names the person only when given', () => {
    expect(catalogConditionBody(' Pay stubs ', 'Pat')).toBe('Pay stubs (Pat)')
    expect(catalogConditionBody('Pay stubs', null)).toBe('Pay stubs')
  })
})

describe('linkItemsFor', () => {
  it('asks again for the documents under a condition, on that condition', () => {
    const r = linkItemsFor([cond('c1', 'Income docs')], [req('r1', { conditionId: 'c1', instructions: 'Last 30 days' }), req('r2', { conditionId: 'c1', ruleKey: 'custom_voe', label: 'VOE', kind: 'other', contactId: 'sam' }), req('r3', { conditionId: 'c9' })], catalog)
    expect(r.items).toEqual([
      { key: 'paystubs', label: 'Pay stubs', instructions: 'Last 30 days', kind: 'paystub', conditionId: 'c1' },
      { key: null, label: 'VOE', instructions: '', kind: 'other', conditionId: 'c1' },
    ])
    expect(r.contactId).toBe('pat')
  })
  it('uses the catalog instructions when the request has none', () => {
    expect(linkItemsFor([cond('c1', 'Pay stubs')], [req('r1', { conditionId: 'c1' })], catalog).items[0].instructions).toBe('Send your pay stubs')
  })
  it('counts a request a suggestion linked', () => {
    expect(requestsUnder(cond('c1', 'x', { documentRequestId: 'r1' }), [req('r1'), req('r2')]).map((r) => r.id)).toEqual(['r1'])
  })
  it('uses the catalog item a condition was added from, and its person', () => {
    const r = linkItemsFor([cond('c1', 'Photo ID (Sam)', { sourceKey: 'cat_photo_id:sam' })], [], catalog)
    expect(r.items).toEqual([{ key: 'photo_id', label: 'Photo ID', instructions: 'Send your photo id', kind: 'other', conditionId: 'c1' }])
    expect(r.contactId).toBe('sam')
  })
  it('matches a typed condition to a catalog item by its words', () => {
    expect(linkItemsFor([cond('c1', ' pay  STUBS (Pat)')], [], catalog).items[0]).toMatchObject({ key: 'paystubs', conditionId: 'c1' })
  })
  it("otherwise asks for the condition's own words, with its notes as instructions", () => {
    expect(linkItemsFor([cond('c1', 'Letter explaining the 9/14 deposit', { notes: ' Sign and date it ' }), cond('c2', 'Old thing')], [], catalog).items).toEqual([
      { key: null, label: 'Letter explaining the 9/14 deposit', instructions: 'Sign and date it', kind: 'other', conditionId: 'c1' },
      { key: null, label: 'Old thing', instructions: '', kind: 'other', conditionId: 'c2' },
    ])
  })
})
