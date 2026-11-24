import { describe, expect, it } from 'vitest'
import { goalLine, goalProgress, savingsPace } from './goals'

describe('goal progress (the spec examples)', () => {
  it('savings: $2,400 of $6,300 from $0 is 38.1%, $3,900 to go', () => {
    expect(goalProgress({ kind: 'savings', start: 0, target: 6_300, current: 2_400 })).toEqual({ pct: 38.1, moved: 2_400, remaining: 3_900, reached: false })
  })
  it('credit: 580 → 605 of 620 is +25, 15 to go', () => {
    expect(goalProgress({ kind: 'credit', start: 580, target: 620, current: 605 })).toEqual({ pct: 62.5, moved: 25, remaining: 15, reached: false })
  })
  it('debt: $3,500 → $1,800 toward $500 is 56.7%; $1,200 → $600 toward $0 is 50%', () => {
    expect(goalProgress({ kind: 'debt', start: 3_500, target: 500, current: 1_800 })).toEqual({ pct: 56.7, moved: 1_700, remaining: 1_300, reached: false })
    expect(goalProgress({ kind: 'debt', start: 1_200, target: 0, current: 600 }).pct).toBe(50)
  })
  it('nothing reported yet is 0%; past the target is 100% and reached; going backwards is 0%', () => {
    expect(goalProgress({ kind: 'savings', start: 0, target: 6_300, current: null }).pct).toBe(0)
    expect(goalProgress({ kind: 'savings', start: 0, target: 6_300, current: 7_000 })).toMatchObject({ pct: 100, remaining: 0, reached: true })
    expect(goalProgress({ kind: 'debt', start: 3_500, target: 500, current: 4_000 })).toMatchObject({ pct: 0, moved: 0 })
  })
})

describe('savings pace', () => {
  it('splits what is left over the days to the target date', () => {
    const p = savingsPace(3_900, '2027-05-24', '2026-11-24')!
    expect(p.days).toBe(181)
    expect(p.perMonth).toBe(655.84)
    expect(p.perTwoWeeks).toBe(301.66)
    expect(p.perWeek).toBe(150.83)
  })
  it('none without a future date or anything left', () => {
    expect(savingsPace(3_900, null, '2026-11-24')).toBeNull()
    expect(savingsPace(3_900, '2026-11-24', '2026-11-24')).toBeNull()
    expect(savingsPace(0, '2027-05-24', '2026-11-24')).toBeNull()
  })
})

describe('plain-language lines', () => {
  it('says it the way the spec does', () => {
    expect(goalLine('savings', 'Savings', goalProgress({ kind: 'savings', start: 0, target: 6_300, current: 5_100 }))).toBe("You're $1,200 away from your savings goal.")
    expect(goalLine('credit', 'Credit', goalProgress({ kind: 'credit', start: 580, target: 620, current: 605 }))).toBe('Your reported credit score has improved by 25 points. 15 to go.')
    expect(goalLine('debt', 'credit card', goalProgress({ kind: 'debt', start: 3_500, target: 500, current: 1_800 }))).toBe("You've paid down $1,700 toward your credit card goal. $1,300 to go.")
  })
})
