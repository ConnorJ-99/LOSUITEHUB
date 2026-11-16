import { describe, expect, it } from 'vitest'
import { followUpFor, milestoneCounts, planPayload, planProblems, starterPlan } from './plan'

const today = '2026-11-16'

describe('readiness plans', () => {
  it('builds a starter plan from the obstacles', () => {
    const p = starterPlan(['assets_down_payment', 'custom:Finish probation'], { firstName: 'Sarah', target: 'Next spring' }, today)
    expect(p.actions).toHaveLength(2)
    expect(p.actions[0].title).toBe('Save for the down payment')
    expect(p.actions[0].milestones[0].targetDate).toBe('2027-01-11')
    expect(p.actions[0].milestones[0].followUpDate).toBe('2027-01-08')
    expect(p.actions[1].title).toBe('Finish probation')
    expect(p.milestones[0].title).toBe('Reassess together')
    expect(p.reviewOn).toBe('2027-02-14')
    expect(p.goal).toBe('Buy a home (Next spring)')
    expect(p.intro).toMatch(/^Sarah, here is your plan/)
    expect(planProblems(p, true)).toEqual([])
  })

  it('puts the check-in 3 days before, never in the past', () => {
    expect(followUpFor('2026-12-10', today)).toBe('2026-12-07')
    expect(followUpFor('2026-11-17', today)).toBe(today)
    expect(followUpFor(null, today)).toBeNull()
  })

  it('refuses promises', () => {
    const p = starterPlan(['credit_score_low'], { firstName: 'Sarah', target: null }, today)
    p.actions[0].why = 'Do this and your score will go up 50 points.'
    expect(planProblems(p).join(' ')).toMatch(/credit score/)
    p.actions[0].why = 'You will be approved by March.'
    expect(planProblems(p).join(' ')).toMatch(/approval/)
    p.actions[0].why = 'We guarantee results.'
    expect(planProblems(p).join(' ')).toMatch(/guarantee/)
  })

  it('needs titles, and dates to approve', () => {
    const p = starterPlan(['other_lease'], { firstName: '', target: null }, today)
    p.actions[0].milestones[0].targetDate = null
    expect(planProblems(p)).toEqual([])
    expect(planProblems(p, true)).toContain('Every milestone needs a target date before approving.')
    p.actions[0].title = ' '
    expect(planProblems(p)).toContain('Action 1 needs a title.')
  })

  it('shapes the save and counts milestones', () => {
    const p = starterPlan(['other_lease'], { firstName: 'A', target: null }, today)
    p.actions[0].steps.push('  ')
    const payload = planPayload(p)
    expect(payload.actions[0].steps).not.toContain('  ')
    p.actions[0].milestones[0].status = 'done'
    p.milestones[0].targetDate = '2026-11-01'
    expect(milestoneCounts(p, today)).toEqual({ total: 2, done: 1, outstanding: 1, overdue: 1 })
  })
})
