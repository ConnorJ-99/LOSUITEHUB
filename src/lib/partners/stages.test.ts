import { describe, expect, it } from 'vitest'
import { byFollowUp, fileCounts, filterByStage, followUpState, stageCounts } from './stages'

describe('partner stages', () => {
  it('counts each stage in order, zeros included', () => {
    const counts = stageCounts([{ stage: 'active' }, { stage: 'active' }, { stage: 'contacted' }])
    expect(counts.map((c) => c.count)).toEqual([0, 1, 0, 0, 2, 0])
    expect(counts[4]).toMatchObject({ stage: 'active', label: 'Active' })
  })
})

describe('referred and closed files', () => {
  it('counts each file once, even when they have two roles on it', () => {
    expect(
      fileCounts([
        { loanId: 'a', stage: 'closed' },
        { loanId: 'a', stage: 'closed' },
        { loanId: 'b', stage: 'processing' },
        { loanId: 'c', stage: 'lost' },
      ]),
    ).toEqual({ referred: 3, closed: 1 })
    expect(fileCounts([])).toEqual({ referred: 0, closed: 0 })
  })
})

describe('next follow-up', () => {
  const today = '2026-11-10'
  it('is overdue, today, soon (within a week) or later', () => {
    expect(followUpState('2026-11-08', today)).toEqual({ tone: 'overdue', days: -2 })
    expect(followUpState('2026-11-10', today)).toEqual({ tone: 'today', days: 0 })
    expect(followUpState('2026-11-17', today)).toEqual({ tone: 'soon', days: 7 })
    expect(followUpState('2026-12-01', today)).toMatchObject({ tone: 'later' })
    expect(followUpState(null, today)).toBeNull()
  })
  it('sorts soonest first, with no date last', () => {
    const list = [{ id: 1, nextFollowUpOn: null }, { id: 2, nextFollowUpOn: '2026-12-01' }, { id: 3, nextFollowUpOn: '2026-11-01' }]
    expect(byFollowUp(list).map((p) => p.id)).toEqual([3, 2, 1])
  })
})

describe('filters', () => {
  const partners = [
    { id: 1, stage: 'active' as const, assignedLoId: 'me' },
    { id: 2, stage: 'active' as const, assignedLoId: 'dave' },
    { id: 3, stage: 'nurture' as const, assignedLoId: null },
  ]
  it('My partners keeps only mine; a stage narrows it', () => {
    expect(filterByStage(partners, { stage: null, mineOf: 'me' }).map((p) => p.id)).toEqual([1])
    expect(filterByStage(partners, { stage: 'active', mineOf: null }).map((p) => p.id)).toEqual([1, 2])
    expect(filterByStage(partners, { stage: null, mineOf: null })).toHaveLength(3)
  })
})
