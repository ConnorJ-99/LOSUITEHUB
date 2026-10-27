import { describe, expect, it } from 'vitest'
import { daysSince, isStale, oldestVerified } from './stale'

describe('stale matrices', () => {
  it('days since a matrix was verified', () => {
    expect(daysSince('2026-08-30', '2026-10-26')).toBe(57)
    expect(daysSince(null, '2026-10-26')).toBeNull()
  })
  it('stale after 45 days, or never verified', () => {
    expect(isStale('2026-09-11', '2026-10-26')).toBe(false)
    expect(isStale('2026-09-10', '2026-10-26')).toBe(true)
    expect(isStale(null, '2026-10-26')).toBe(true)
  })
  it("a lender is as fresh as its oldest active program; one never verified makes it unknown", () => {
    expect(oldestVerified([{ active: true, lastVerifiedOn: '2026-10-01' }, { active: true, lastVerifiedOn: '2026-08-30' }, { active: false, lastVerifiedOn: '2025-01-01' }])).toBe('2026-08-30')
    expect(oldestVerified([{ active: true, lastVerifiedOn: null }])).toBeNull()
  })
})
