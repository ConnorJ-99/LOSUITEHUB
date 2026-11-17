import { describe, expect, it } from 'vitest'
import { groupBySender } from './freshGroups'

const m = (id: string, who: { contactId?: string; partnerId?: string }, minute: number) => ({ id, contactId: who.contactId ?? null, partnerId: who.partnerId ?? null, sentAt: `2026-11-16T10:${String(minute).padStart(2, '0')}:00Z` })

describe('groupBySender', () => {
  it('five texts from one client are one group with the newest on top', () => {
    const g = groupBySender([1, 2, 3, 4, 5].map((i) => m(`t${i}`, { contactId: 'jane' }, i)))
    expect(g).toHaveLength(1)
    expect(g[0].count).toBe(5)
    expect(g[0].latest.id).toBe('t5')
  })
  it('keeps people apart, newest sender first, partners too', () => {
    const g = groupBySender([m('a', { contactId: 'jane' }, 1), m('b', { partnerId: 'title' }, 3), m('c', { contactId: 'bob' }, 2), m('d', { contactId: 'jane' }, 0)])
    expect(g.map((x) => [x.key, x.count])).toEqual([
      ['p:title', 1],
      ['c:bob', 1],
      ['c:jane', 2],
    ])
  })
  it('order of the list does not matter for the newest', () => {
    expect(groupBySender([m('new', { contactId: 'x' }, 9), m('old', { contactId: 'x' }, 1)])[0].latest.id).toBe('new')
  })
})
