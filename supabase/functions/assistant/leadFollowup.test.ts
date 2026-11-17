import { describe, expect, it } from 'vitest'
import { complianceIssues } from './followUp.ts'
import { LEAD_SYSTEM, buildLeadPrompt, leadDraftIssues as rawIssues, lookingFor, reachedOut, readLeadDraft, reworded } from './leadFollowup.ts'

const leadDraftIssues = (body: string, template: string, first: string) => rawIssues(body, template, first, complianceIssues('text', { subject: null, body }))

const template = 'Hey Ann, it\'s Connor. Whenever you have a few minutes, you can start your application here: {link} Any questions, just let me know.'

describe('lead follow-up wording', () => {
  it('rewords texts only, never document requests', () => {
    expect(reworded('waiting_application', 'text')).toBe(true)
    expect(reworded('waiting_documents', 'text')).toBe(false)
    expect(reworded('ready_to_shop', 'email')).toBe(false)
    expect(reworded('needs_lo_review', 'text')).toBe(false)
  })

  it('passes a good text', () => {
    expect(leadDraftIssues('Hey Ann, saw you were busy this week. When you get a minute, the application is here: {link}', template, 'Ann')).toEqual([])
  })

  it('refuses what the rules forbid', () => {
    expect(leadDraftIssues('Hey Ann, you are pre-approved! Finish here: {link}', template, 'Ann').join(' ')).toMatch(/approval/)
    expect(leadDraftIssues('Hey Ann, rates are great right now, apply here: {link}', template, 'Ann').length).toBeGreaterThan(0)
    expect(leadDraftIssues('Hey Ann, with your income of $5,000 you are set: {link}', template, 'Ann').join(' ')).toMatch(/dollar|income/)
    expect(leadDraftIssues('Hey Ann, apply here: https://evil.example', template, 'Ann').join(' ')).toMatch(/link/)
    expect(leadDraftIssues('Hey there, apply here: {link}', template, 'Ann').join(' ')).toMatch(/first name/)
    expect(leadDraftIssues('Hey Ann, how is the search going?', 'Hey Ann, how\'s the house hunt going?', 'Ann')).toEqual([])
    expect(leadDraftIssues('Hey Ann, here: {link} {link}', template, 'Ann').join(' ')).toMatch(/exactly once/)
  })

  it('reads the answer and builds the prompt', () => {
    expect(readLeadDraft({ body: '  Hi Ann  ' })).toBe('Hi Ann')
    expect(readLeadDraft({})).toBeNull()
    const p = buildLeadPrompt({ kind: 'waiting_application', firstName: 'Ann', loFirstName: 'Connor', timeline: '2 months', today: '2026-11-16' }, template, [
      { direction: 'inbound', channel: 'text', body: 'Will do this weekend', sentAt: '2026-11-14T15:00:00Z' },
    ])
    expect(p).toContain('<template>')
    expect(p).toContain('[2026-11-14] Ann (text): Will do this weekend')
    expect(p).toContain('Time frame: 2 months')
  })
})

describe('what the first text says (Connor, 2026-11-16)', () => {
  it('a DSCR purchase is buying an investment property', () => {
    expect(lookingFor({ purpose: 'purchase', occupancy: null, incomeDocType: 'dscr' })).toBe('buying an investment property')
    expect(lookingFor({ purpose: 'purchase', occupancy: 'investment', incomeDocType: 'full_doc' })).toBe('buying an investment property')
    expect(lookingFor({ purpose: 'purchase', occupancy: 'primary', incomeDocType: null })).toBe('buying a home')
    expect(lookingFor({ purpose: 'refinance_cash_out', occupancy: 'primary', incomeDocType: null })).toBe('a cash-out refinance')
    expect(lookingFor({ purpose: 'heloc', occupancy: null, incomeDocType: null })).toBe('a home equity loan')
  })
  it('two weeks or more is a while back', () => {
    expect(reachedOut('2026-10-01T15:00:00Z', '2026-11-16')).toBe('a while back')
    expect(reachedOut('2026-11-10T15:00:00Z', '2026-11-16')).toBeNull()
  })
  it('the prompt gives the full name, what they want and when; never the area', () => {
    const prompt = buildLeadPrompt({ kind: 'new_lead', firstName: 'Yazmine', loFirstName: 'Connor', loFullName: 'Connor Jacquart', lookingFor: 'buying an investment property', reachedOut: 'a while back', timeline: null, today: '2026-11-16' }, 'Hey Yazmine', [])
    expect(prompt).toContain('Loan officer: Connor Jacquart')
    expect(prompt).toContain('Looking for: buying an investment property')
    expect(prompt).toContain('Reached out: a while back')
    expect(LEAD_SYSTEM).not.toMatch(/in Dallas-Fort Worth/)
  })
  it('a draft that mentions the area is thrown out', () => {
    expect(leadDraftIssues('Hi Yazmine, this is Connor with MPS Mortgage here in Dallas-Fort Worth.', 'Hi', 'Yazmine')).toContain('The message mentions the area.')
    expect(leadDraftIssues("Hi Yazmine, this is Connor Jacquart with MPS Mortgage. You had reached out a while back about buying an investment property. Are you still interested? If so, when's a good time for us to hop on a call?", 'Hi', 'Yazmine')).toEqual([])
  })
})
