import { describe, expect, it } from 'vitest'
import { complianceIssues } from '../../../supabase/functions/assistant/followUp'
import { thanksEmail, thanksFacts, thanksKey, thanksText } from './openHouseFollowUp'
import type { DataRow } from '../../../supabase/functions/page-submit/blocks'

const rows = (pre: boolean | null, agent: boolean | null): DataRow[] => [
  { blockId: 'a', label: 'Already pre-approved?', type: 'yes_no', value: pre },
  { blockId: 'b', label: 'Working with an agent?', type: 'yes_no', value: agent },
]

describe('open house thank-you drafts', () => {
  it('offers a pre-approval to someone who is not pre-approved', () => {
    const f = thanksFacts(rows(false, false), 'Vic', '4218 Fairway Bend Dr', 'Connor')
    expect(thanksText(f)).toBe("Hi Vic, this is Connor with MPS Mortgage. Thanks for stopping by the open house at 4218 Fairway Bend Dr! If it would help, I can get you pre-approved so you're ready to make an offer. Want to set up a quick call?")
  })

  it('offers a second look to someone already pre-approved, and mentions their agent', () => {
    const f = thanksFacts(rows(true, true), 'Ann', '4218 Fairway Bend Dr', 'Connor')
    expect(thanksText(f)).toContain('already pre-approved')
    expect(thanksEmail(f).body).toContain('alongside your agent')
  })

  it('works when the form skipped those questions', () => {
    const f = thanksFacts([], '', '4218 Fairway Bend Dr', null)
    expect(thanksText(f)).toMatch(/^Hi there, this is MPS Mortgage\./)
  })

  it('passes the draft compliance rules (no rates, payments or promises; short texts)', () => {
    for (const [pre, agent] of [[true, true], [false, false], [null, null]] as const) {
      const f = thanksFacts(rows(pre, agent), 'Vic', '4218 Fairway Bend Dr', 'Connor')
      expect(complianceIssues('text', { subject: null, body: thanksText(f) })).toEqual([])
      expect(complianceIssues('email', thanksEmail(f))).toEqual([])
    }
  })

  it('one key per sign-in', () => {
    expect(thanksKey('abc')).toBe('openhouse-thanks:abc')
  })
})
