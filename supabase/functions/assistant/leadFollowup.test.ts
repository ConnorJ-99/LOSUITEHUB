import { describe, expect, it } from 'vitest'
import { complianceIssues } from './followUp.ts'
import { buildLeadPrompt, leadDraftIssues as rawIssues, readLeadDraft, reworded } from './leadFollowup.ts'

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
