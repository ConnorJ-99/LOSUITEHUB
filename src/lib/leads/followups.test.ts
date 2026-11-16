import { describe, expect, it } from 'vitest'
import { fillLink, isSnoozed, missingLink, readLeadContext, readLinkToken } from './followups'

const token = 'a'.repeat(64)

describe('lead follow-up drafts', () => {
  it('reads the lead context', () => {
    const c = readLeadContext({ lead: { nextAction: 'waiting_documents', stage: 'pre_qualified', timeline: '2 months', readyOn: '2027-01-16', lastContactAt: null, reason: 'Waiting on Documents: no contact on record yet' } })
    expect(c?.nextAction).toBe('waiting_documents')
    expect(c?.reason).toMatch(/no contact/)
    expect(readLeadContext({ lead: { nextAction: 'bogus' } })).toBeNull()
    expect(readLeadContext({ channel: 'text' })).toBeNull()
  })

  it('fills in the portal link', () => {
    expect(readLinkToken({ linkToken: token })).toBe(token)
    expect(readLinkToken({ linkToken: 'nope' })).toBeNull()
    const body = fillLink('Upload them here: {link}', token, 'https://app.mps.mortgage/')
    expect(body).toBe(`Upload them here: https://app.mps.mortgage/u/${token}`)
    expect(missingLink(body)).toBe(false)
    expect(missingLink(fillLink('Here: {link}', null, 'https://x'))).toBe(true)
    expect(fillLink('No link', null, 'https://x')).toBe('No link')
  })

  it('snoozes until the day picked', () => {
    expect(isSnoozed('2026-11-20', '2026-11-16')).toBe(true)
    expect(isSnoozed('2026-11-16', '2026-11-16')).toBe(false)
    expect(isSnoozed(null, '2026-11-16')).toBe(false)
  })
})
