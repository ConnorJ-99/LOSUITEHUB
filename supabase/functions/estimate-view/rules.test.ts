import { describe, expect, it } from 'vitest'
import { disclaimer, emailMatches, isLocked, sessionValid, shareState } from './rules'

describe('email matching', () => {
  const borrowers = ['Pat.Smith@Example.com', 'jo@example.com', null]
  it('ignores case and spaces', () => {
    expect(emailMatches('  pat.smith@example.COM ', borrowers)).toBe(true)
  })
  it("a co-borrower's email works", () => {
    expect(emailMatches('jo@example.com', borrowers)).toBe(true)
  })
  it("someone else's email, or nothing, doesn't", () => {
    expect(emailMatches('realtor@example.com', borrowers)).toBe(false)
    expect(emailMatches('   ', borrowers)).toBe(false)
  })
})

describe('link state', () => {
  const now = new Date('2026-11-11T15:00:00Z')
  it('open until it expires; revoked or expired shows nothing', () => {
    expect(shareState({ expiresAt: '2026-11-18T15:00:00Z', revokedAt: null }, now)).toBe('open')
    expect(shareState({ expiresAt: '2026-11-11T15:00:00Z', revokedAt: null }, now)).toBe('expired')
    expect(shareState({ expiresAt: '2026-11-18T15:00:00Z', revokedAt: '2026-11-10T00:00:00Z' }, now)).toBe('revoked')
  })
  it('locks after 5 wrong emails in an hour', () => {
    expect(isLocked(4)).toBe(false)
    expect(isLocked(5)).toBe(true)
  })
  it('a session works for its device until it ends', () => {
    const s = { sessionHash: 'abc', sessionExpiresAt: '2026-11-12T15:00:00Z' }
    expect(sessionValid(s, 'abc', now)).toBe(true)
    expect(sessionValid(s, 'xyz', now)).toBe(false)
    expect(sessionValid(s, 'abc', new Date('2026-11-12T15:00:01Z'))).toBe(false)
    expect(sessionValid({ sessionHash: null, sessionExpiresAt: null }, null, now)).toBe(false)
  })
})

describe('disclaimer', () => {
  it('has the time in Central, NMLS and Equal Housing', () => {
    expect(disclaimer('2026-11-11T15:05:00Z')).toBe(
      'Rates as of Nov 11, 2026 at 9:05 AM. Estimates only, not a commitment to lend or a rate lock; rates and fees change daily and depend on final approval. MPS Mortgage LLC, NMLS #2501110. Equal Housing Opportunity.',
    )
  })
})
