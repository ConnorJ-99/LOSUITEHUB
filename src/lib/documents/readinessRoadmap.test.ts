import { describe, expect, it } from 'vitest'
import { starterPlan } from '@/lib/nurture/plan'
import { roadmapProblems, roadmapView } from './readinessRoadmap'

const plan = starterPlan(['assets_down_payment', 'credit_utilization', 'other_lease'], { firstName: 'Sarah', target: 'Next spring' }, '2026-11-16')
plan.actions[1].milestones[0].status = 'done'
const view = roadmapView({ borrowerName: 'Sarah Lee', firstName: 'Sarah', loName: 'Connor', loPhone: '214-555-0100', loEmail: null, preparedOn: '2026-11-16', version: 2, timeframe: 'Next spring', plan, obstacles: ['assets_down_payment', 'credit_utilization', 'other_lease'] })

describe('roadmap', () => {
  it('groups the obstacles in plain English', () => {
    expect(view.readiness.map((g) => g.group)).toEqual(['Savings and assets', 'Credit', 'Timing and other'])
  })
  it('lists actions with how progress is checked', () => {
    expect(view.actions[0].title).toBe('Save for the down payment')
    expect(view.actions[0].check.join(' ')).toMatch(/Documents: Two months of statements/)
  })
  it('orders the timeline by date and leaves done items out of what’s outstanding', () => {
    const dates = view.timeline.map((t) => t.date)
    expect(view.timeline[0].title).toBe('Timing planned')
    expect(dates.length).toBe(4)
    expect(view.outstanding.some((o) => o.startsWith('Card balances lowered'))).toBe(false)
    expect(view.contact).toBe('Connor · 214-555-0100')
  })
  it('carries the disclosure and refuses promises', () => {
    expect(view.disclosure).toMatch(/not a loan approval/)
    expect(roadmapProblems(view)).toEqual([])
    expect(roadmapProblems({ ...view, intro: 'You will be approved soon.' })).toHaveLength(1)
  })
})
