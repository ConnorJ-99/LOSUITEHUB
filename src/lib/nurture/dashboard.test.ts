import { describe, expect, it } from 'vitest'
import { exitsFrom, nurtureDashboard, type DashInput } from './dashboard'

const base: DashInput = {
  today: '2026-11-16',
  files: [
    { loanId: 'a', borrower: 'Ann', loId: 'lo1', stage: 'working', enteredAt: '2026-09-17T15:00:00Z', obstacles: ['credit_utilization', 'credit_collections', 'assets_down_payment'], nextFollowUp: '2026-11-10' },
    { loanId: 'b', borrower: 'Ben', loId: 'lo1', stage: 'plan_needed', enteredAt: '2026-11-01T15:00:00Z', obstacles: ['debt_dti_high'], nextFollowUp: null },
    { loanId: 'c', borrower: 'Cara', loId: 'lo2', stage: 'ready_reassess', enteredAt: '2026-08-18T15:00:00Z', obstacles: ['credit_utilization'], nextFollowUp: null },
  ],
  plans: [
    { loanId: 'a', status: 'approved' },
    { loanId: 'c', status: 'approved' },
    { loanId: 'c', status: 'superseded' },
  ],
  milestones: [
    { loanId: 'a', onAction: true, done: true, targetDate: '2026-10-01' },
    { loanId: 'a', onAction: true, done: false, targetDate: '2026-11-01' },
    { loanId: 'a', onAction: false, done: false, targetDate: '2027-01-01' },
    { loanId: 'c', onAction: true, done: true, targetDate: '2026-10-01' },
  ],
  delivered: new Set(['a']),
  openUpdates: new Map([['a', 2]]),
  checkIns: [
    { loanId: 'a', kind: 'check_in', sentAt: '2026-11-01T15:00:00Z' },
    { loanId: 'a', kind: 'overdue', sentAt: '2026-11-10T15:00:00Z' },
    { loanId: 'c', kind: 'reassess', sentAt: '2026-11-12T15:00:00Z' },
    { loanId: 'c', kind: 'check_in', sentAt: '2026-01-01T15:00:00Z' },
  ],
  inbound: new Map([['a', ['2026-11-03T15:00:00Z', '2026-10-01T15:00:00Z']]]),
  exits: [
    { loanId: 'x', loId: 'lo1', enteredAt: '2026-06-01T00:00:00Z', leftAt: '2026-08-30T00:00:00Z', toStage: 'contacted', stageNow: 'closed' },
    { loanId: 'y', loId: 'lo2', enteredAt: '2026-07-01T00:00:00Z', leftAt: '2026-08-01T00:00:00Z', toStage: 'lost', stageNow: 'lost' },
  ],
  loId: null,
}

describe('nurture dashboard', () => {
  const d = nurtureDashboard(base)
  it('counts files, obstacles and plans', () => {
    expect(d.active).toBe(3)
    expect(d.byGroup[0]).toEqual(['credit', 2])
    expect(d.topObstacles[0]).toMatchObject({ key: 'credit_utilization', n: 2 })
    expect(d.plansApproved).toBe(2)
    expect(d.plansDelivered).toBe(2) // a by its log, c by its later stage
  })
  it('counts milestones on approved plans only', () => {
    expect(d.milestonesOutstanding).toBe(2)
    expect(d.milestonesOverdue).toBe(1)
  })
  it('response rate: replies within 7 days, last 90 days', () => {
    expect(d.checkInsSent).toBe(3)
    expect(d.checkInsAnswered).toBe(1)
    expect(d.responsePct).toBe(33)
    expect(d.reassessAsks).toBe(1)
  })
  it('outcomes and time in Nurture', () => {
    expect(d.leftNurture).toBe(2)
    expect(d.toActive).toBe(1)
    expect(d.funded).toBe(1)
    expect(d.avgDaysNow).toBe(Math.round((60 + 15 + 90) / 3))
    expect(d.avgDaysToLeave).toBe(Math.round((90 + 31) / 2))
  })
  it('needs attention, most urgent first; getting close', () => {
    expect(d.attention.map((a) => a.borrower)).toEqual(['Ann', 'Ben'])
    expect(d.attention[0].reasons).toEqual(['2 updates to verify', '1 milestone overdue', 'Follow-up was due 2026-11-10'])
    expect(d.attention[1].reasons[0]).toMatch(/No plan yet, 15 days/)
    expect(d.close).toEqual([{ loanId: 'c', borrower: 'Cara', why: 'Ready for reassessment', done: 1, total: 1 }])
  })
  it('filters to one loan officer', () => {
    const mine = nurtureDashboard({ ...base, loId: 'lo2' })
    expect(mine.active).toBe(1)
    expect(mine.leftNurture).toBe(1)
    expect(mine.funded).toBe(0)
  })
})

describe('exits from stage history', () => {
  it('pairs each move out with the move in before it', () => {
    const e = exitsFrom(
      [
        { loanId: 'x', from: 'contacted', to: 'nurture', at: '2026-01-01' },
        { loanId: 'x', from: 'nurture', to: 'contacted', at: '2026-03-01' },
        { loanId: 'x', from: 'contacted', to: 'nurture', at: '2026-04-01' },
        { loanId: 'x', from: 'nurture', to: 'lost', at: '2026-05-01' },
      ],
      new Map([['x', { loId: 'lo1', stageNow: 'lost' }]]),
    )
    expect(e).toEqual([
      { loanId: 'x', loId: 'lo1', enteredAt: '2026-01-01', leftAt: '2026-03-01', toStage: 'contacted', stageNow: 'lost' },
      { loanId: 'x', loId: 'lo1', enteredAt: '2026-04-01', leftAt: '2026-05-01', toStage: 'lost', stageNow: 'lost' },
    ])
  })
})
