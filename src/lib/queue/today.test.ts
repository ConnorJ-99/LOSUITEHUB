import { describe, expect, it } from 'vitest'
import { approvalNote, buildToday, decisionFor, groupToday, readDraft, readReviewLink, readSources, readTask, type ActionItem, type FileRef } from './today'

const item = (over: Partial<ActionItem & FileRef> = {}): ActionItem & FileRef => ({
  id: 'a1', loanId: 'l1', borrowerName: 'Jane Smith', kind: 'draft_message', title: 'Follow-up text', payload: {}, sources: [],
  confidence: null, status: 'pending', dueOn: null, aiRunId: null, createdAt: '2026-10-25T10:00:00Z', decidedAt: null, ...over,
})

describe('reading assistant output', () => {
  it('accepts a valid draft and rejects bad ones', () => {
    expect(readDraft({ channel: 'text', to: 'Jane', body: 'Hi Jane' })).toEqual({ channel: 'text', to: 'Jane', subject: null, body: 'Hi Jane' })
    expect(readDraft({ channel: 'email', to: 'Jane', subject: 'Next steps', body: 'Hi' })?.subject).toBe('Next steps')
    expect(readDraft({ channel: 'fax', body: 'Hi' })).toBeNull()
    expect(readDraft({ channel: 'text', body: '  ' })).toBeNull()
    expect(readDraft('nope')).toBeNull()
  })

  it('reads suggested tasks and only real dates', () => {
    expect(readTask({ title: 'Order appraisal', dueOn: '2026-11-03' })).toEqual({ title: 'Order appraisal', dueOn: '2026-11-03' })
    expect(readTask({ title: 'Call Jane', dueOn: 'next week' })).toEqual({ title: 'Call Jane', dueOn: null })
    expect(readTask({ dueOn: '2026-11-03' })).toBeNull()
  })

  it('links contract readings to their review screen', () => {
    expect(readReviewLink('field_update', { extractionId: 'x', section: 'contract' })).toEqual({ section: 'contract' })
    expect(readReviewLink('field_update', { readingId: 'r', section: 'prequal' })).toEqual({ section: 'prequal' })
    expect(readReviewLink('field_update', { field: 'income' })).toBeNull()
    expect(readReviewLink('draft_message', { extractionId: 'x', section: 'contract' })).toBeNull()
  })

  it('keeps only sources with a quote', () => {
    expect(readSources([{ label: 'Call notes', quote: 'call back Tuesday' }, { label: 'x' }, 'junk', { quote: 'p2', page: 2 }])).toEqual([
      { label: 'Call notes', quote: 'call back Tuesday', page: null },
      { label: 'Source', quote: 'p2', page: 2 },
    ])
    expect(readSources(null)).toEqual([])
  })
})

describe('decisions', () => {
  it('marks a changed draft as edited', () => {
    const draft = { channel: 'text', to: 'Jane', subject: null, body: 'Hi' }
    expect(decisionFor(draft, { ...draft })).toBe('approved')
    expect(decisionFor(draft, { ...draft, body: 'Hi Jane!' })).toBe('edited')
  })

  it('writes a readable note for the file', () => {
    expect(approvalNote({ channel: 'text', to: 'Jane Smith (borrower)', subject: null, body: 'Hi Jane' })).toBe('Text approved for Jane Smith (borrower) to send:\n\nHi Jane')
    expect(approvalNote({ channel: 'email', to: '', subject: 'Docs', body: 'Hi' })).toBe('Email approved to send:\nSubject: Docs\n\nHi')
  })
})

describe('Today', () => {
  const today = '2026-10-25'
  const loans = [
    { loanId: 'l1', borrowerName: 'Jane Smith', stage: 'under_contract', optionEndDate: '2026-10-28', closingDate: '2026-11-20' },
    { loanId: 'l2', borrowerName: 'Bob Lee', stage: 'closed', optionEndDate: null, closingDate: '2026-10-26' },
    { loanId: 'l3', borrowerName: 'Amy Fox', stage: 'processing', optionEndDate: '2026-10-23', closingDate: '2026-11-01' },
  ]
  const tasks = [
    { id: 't1', loanId: 'l1', borrowerName: 'Jane Smith', title: 'Order title', dueOn: '2026-10-24' },
    { id: 't2', loanId: 'l3', borrowerName: 'Amy Fox', title: 'Call Amy', dueOn: null },
  ]
  const actions = [item(), item({ id: 'a2', status: 'dismissed' }), item({ id: 'a3', dueOn: '2026-10-30', title: 'Intro email' })]
  const list = buildToday(actions, tasks, loans, today)

  it('mixes pending queue items, tasks and near deadlines in date order', () => {
    expect(list.map((e) => [e.type, e.date])).toEqual([
      ['date', '2026-10-23'], // option end 2 days ago (still shown)
      ['task', '2026-10-24'],
      ['action', '2026-10-25'], // undated queue item counts as today
      ['task', '2026-10-25'], // undated task counts as today
      ['date', '2026-10-28'],
      ['action', '2026-10-30'],
      ['date', '2026-11-01'],
    ])
  })

  it('leaves out decided items, closed files and far-off dates', () => {
    expect(list.some((e) => e.type === 'action' && e.item.id === 'a2')).toBe(false)
    expect(list.some((e) => e.loanId === 'l2')).toBe(false)
    expect(list.some((e) => e.date === '2026-11-20')).toBe(false)
  })

  it('groups into overdue, today and coming up', () => {
    const g = groupToday(list, today)
    expect([g.overdue.length, g.today.length, g.upcoming.length]).toEqual([2, 2, 3])
  })
})
