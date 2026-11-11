import { describe, expect, it } from 'vitest'
import { conditionReady, newToken, planRequest, remindersDue, ruleKeyOf, sha256Hex, uploadMessages, uploadUrl, type PickedItem } from './uploadRequests'

const item = (key: string | null, label: string, conditionId: string | null = null): PickedItem => ({ key, label, instructions: '', kind: 'other', conditionId })

describe('a request on the checklist', () => {
  it('3 catalog items and 1 typed item are added for the borrower', () => {
    const p = planRequest([], [item('paystubs', 'Pay stubs'), item('w2s', 'W-2s'), item('bank_statements', 'Bank statements', 'c1'), item(null, 'Letter about the Chase deposit')], 'pat')
    expect(p.add.map((a) => a.ruleKey)).toEqual(['paystubs', 'w2s', 'bank_statements', 'custom_letter_about_the_chase_deposit'])
    expect(p.add[2].conditionId).toBe('c1')
  })
  it('the same document for the same person is one row: asked again, or not if it is already in', () => {
    const existing = [
      { id: 'r1', contactId: 'pat', ruleKey: 'paystubs', status: 'rejected' as const },
      { id: 'r2', contactId: 'pat', ruleKey: 'w2s', status: 'received' as const },
      { id: 'r3', contactId: 'jo', ruleKey: 'bank_statements', status: 'requested' as const },
    ]
    const p = planRequest(existing, [item('paystubs', 'Pay stubs'), item('w2s', 'W-2s'), item('bank_statements', 'Bank statements'), item('paystubs', 'Pay stubs')], 'pat')
    expect(p.reuse.map((r) => r.id)).toEqual(['r1'])
    expect(p.skip).toEqual([{ label: 'W-2s', why: 'already received, waiting for your review' }])
    expect(p.add.map((a) => a.ruleKey)).toEqual(['bank_statements'])
  })
  it('typed keys are stable', () => {
    expect(ruleKeyOf({ key: null, label: '  Letter: why the move? ' })).toBe('custom_letter_why_the_move')
  })
})

describe('the link and messages', () => {
  it('tokens are 64 hex characters and hash the same way every time', async () => {
    const t = newToken()
    expect(t).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('the text carries the link; the email lists each item with its instructions', () => {
    const m = uploadMessages({ firstName: 'Pat', loName: 'Connor Jacquart', url: uploadUrl('https://app.mps.mortgage/', 'abc'), items: [{ label: 'Pay stubs', instructions: 'Last 30 days' }], dueOn: '2026-11-18' })
    expect(m.text).toBe("Hi Pat, here's a secure link to upload the documents I need by Nov 18. https://app.mps.mortgage/u/abc You'll confirm your email to open it. Photos or PDFs are fine. - Connor")
    expect(m.email).toContain('• Pay stubs: Last 30 days')
    expect(m.subject).toBe('Documents for your loan')
  })
})

describe('reminders and conditions', () => {
  const link = { id: 'L', dueOn: '2026-11-10', expiresAt: '2026-11-25T00:00:00Z', revokedAt: null }
  const waiting = [{ linkId: 'L', status: 'requested' as const }]
  it('no reminder before the due date, or when nothing is still needed', () => {
    expect(remindersDue([link], waiting, '2026-11-10')).toEqual([])
    expect(remindersDue([link], [{ linkId: 'L', status: 'received' }], '2026-11-12')).toEqual([])
  })
  it('one reminder per 3 days past due', () => {
    const keys = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'].map((d) => remindersDue([link], waiting, d)[0]?.sourceKey)
    expect(keys).toEqual(['upload-reminder:L:0', 'upload-reminder:L:0', 'upload-reminder:L:0', 'upload-reminder:L:1'])
  })
  it('a rejected item counts as still needed; a revoked or expired link gets none', () => {
    expect(remindersDue([link], [{ linkId: 'L', status: 'rejected' }], '2026-11-12')).toHaveLength(1)
    expect(remindersDue([{ ...link, revokedAt: '2026-11-11' }], waiting, '2026-11-12')).toEqual([])
    expect(remindersDue([{ ...link, expiresAt: '2026-11-12T00:00:00Z' }], waiting, '2026-11-12')).toEqual([])
  })
  it('a condition is ready to clear once every linked item is accepted', () => {
    expect(conditionReady([{ conditionId: 'c', status: 'reviewed' }, { conditionId: 'c', status: 'received' }], 'c')).toBe(false)
    expect(conditionReady([{ conditionId: 'c', status: 'reviewed' }, { conditionId: 'c', status: 'waived' }, { conditionId: 'x', status: 'requested' }], 'c')).toBe(true)
    expect(conditionReady([], 'c')).toBe(false)
  })
})
