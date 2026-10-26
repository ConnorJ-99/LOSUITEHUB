import { describe, expect, it } from 'vitest'
import { creditTier, daysAtStep, groupCountLabel, groupCounts } from './display'

describe('credit tier', () => {
  it('uses FICO bands', () => {
    expect(creditTier(812)).toEqual({ label: 'Exceptional', tone: 'green' })
    expect(creditTier(745)?.label).toBe('Very good')
    expect(creditTier(681)).toEqual({ label: 'Good', tone: 'green' })
    expect(creditTier(652)).toEqual({ label: 'Fair', tone: 'amber' })
    expect(creditTier(560)).toEqual({ label: 'Poor', tone: 'red' })
    expect(creditTier(null)).toBeNull()
  })
})

describe('group progress', () => {
  it('counts done, ready and blocked, leaving out not-applicable steps', () => {
    const c = groupCounts(['done', 'done', 'done', 'ready', 'ready', 'not_started', 'na', 'not_started'])
    expect(c).toEqual({ done: 3, total: 7, ready: 2, blocked: 0 })
    expect(groupCountLabel(c)).toBe('3/7 · 2 ready')
    expect(groupCountLabel(groupCounts(['ready', 'blocked', 'na']))).toBe('0/2 · 1 ready · 1 blocked')
    expect(groupCountLabel(groupCounts([]))).toBe('0/0')
  })

  it('words days at a step', () => {
    expect([daysAtStep(0), daysAtStep(1), daysAtStep(209)]).toEqual(['today', '1 day at this step', '209 days at this step'])
  })
})
