import { describe, expect, it } from 'vitest'
import { itemLink, itemNote, itemTitle, moveItem, priorityList, snoozeDate, sortPriority, type PriorityItem } from './priorityList'

const today = '2026-11-03'

const item = (id: string, over: Partial<PriorityItem> = {}): PriorityItem => ({
  id,
  loanId: `loan-${id}`,
  action: 'call',
  title: 'Call',
  dueOn: null,
  starred: false,
  sortOrder: null,
  snoozedUntil: null,
  createdAt: `2026-11-01T10:00:0${id.length}Z`,
  ...over,
})

describe('priority list order', () => {
  it('puts starred items first, then the order set by hand, then soonest due, then oldest', () => {
    const items = [
      item('a', { dueOn: '2026-11-10' }),
      item('b', { dueOn: '2026-11-05' }),
      item('c', { sortOrder: 1 }),
      item('d', { sortOrder: 0 }),
      item('e', { starred: true }),
      item('f', { createdAt: '2026-10-01T00:00:00Z' }),
    ]
    expect(sortPriority(items).map((i) => i.id)).toEqual(['e', 'd', 'c', 'b', 'a', 'f'])
  })

  it('hides snoozed items until their day, soonest back first', () => {
    const items = [item('a', { snoozedUntil: '2026-11-10' }), item('b', { snoozedUntil: '2026-11-04' }), item('c', { snoozedUntil: today }), item('d')]
    const { showing, snoozed } = priorityList(items, today)
    expect(showing.map((i) => i.id)).toEqual(['c', 'd'])
    expect(snoozed.map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('moving an item', () => {
  const showing = sortPriority([item('s', { starred: true }), item('a', { sortOrder: 0 }), item('b', { sortOrder: 1 }), item('c')])

  it('swaps it with its neighbour and numbers the whole group', () => {
    expect(moveItem(showing, 'c', 'up')).toEqual([
      { id: 'a', sortOrder: 0 },
      { id: 'c', sortOrder: 1 },
      { id: 'b', sortOrder: 2 },
    ])
  })

  it("doesn't move past the top or bottom of its group (starred stay on top)", () => {
    expect(moveItem(showing, 'a', 'up')).toBeNull()
    expect(moveItem(showing, 'c', 'down')).toBeNull()
    expect(moveItem(showing, 's', 'down')).toBeNull()
    expect(moveItem(showing, 'missing', 'up')).toBeNull()
  })
})

describe('titles and notes', () => {
  it('uses the note as the title, else the action name', () => {
    expect(itemTitle('lock', '  ')).toBe('Lock')
    expect(itemTitle('documents', ' Pay stubs ')).toBe('Pay stubs')
  })
  it('shows a note only when the title says more than the action', () => {
    expect(itemNote({ action: 'lock', title: 'Lock' })).toBeNull()
    expect(itemNote({ action: 'lock', title: 'Lock before Friday' })).toBe('Lock before Friday')
  })
})

describe('snooze', () => {
  it('comes back tomorrow or in a week, across a month end', () => {
    expect(snoozeDate(today, 'tomorrow')).toBe('2026-11-04')
    expect(snoozeDate('2026-11-28', 'week')).toBe('2026-12-05')
  })
})

describe('where a click goes', () => {
  it('opens Scenarios & Estimate for lock and pricing', () => {
    expect(itemLink('L', 'lock', 'pre_approved')).toBe('/loans/L?tab=estimates')
    expect(itemLink('L', 'price', 'lead')).toBe('/loans/L?tab=estimates')
  })
  it('opens Conditions once the file is in processing, Documents before that', () => {
    expect(itemLink('L', 'documents', 'processing')).toBe('/loans/L?tab=conditions')
    expect(itemLink('L', 'documents', 'under_contract')).toBe('/loans/L?tab=documents')
    expect(itemLink('L', 'documents', 'pre_qualified')).toBe('/loans/L?tab=documents')
    expect(itemLink('L', 'documents', null)).toBe('/loans/L?tab=documents')
  })
  it('opens Messages for a call and Overview for anything else', () => {
    expect(itemLink('L', 'call', 'lead')).toBe('/loans/L?tab=messages')
    expect(itemLink('L', 'other', 'lead')).toBe('/loans/L?tab=overview')
  })
})
