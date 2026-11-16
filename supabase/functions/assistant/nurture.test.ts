import { describe, expect, it } from 'vitest'
import { buildNurtureReadPrompt, buildNurtureWordPrompt, nurtureDraftIssues, nurtureReworded, readNurtureDraft, readNurtureReading, type ReadMilestone } from './nurture'

const milestones: ReadMilestone[] = [
  { id: 'm1', title: 'Balances lowered', measure: 'Statements', targetDate: '2027-01-11', done: false, action: 'Lower card balances' },
  { id: 'm2', title: 'Savings started', measure: null, targetDate: '2026-11-30', done: true, action: 'Save' },
]
const thread = [
  { direction: 'outbound' as const, channel: 'text' as const, body: 'How is it going?', sentAt: '2026-11-10T15:00:00Z' },
  { direction: 'inbound' as const, channel: 'text' as const, body: 'Paid off my Visa!', sentAt: '2026-11-16T15:00:00Z' },
]

describe('nurture wording', () => {
  it('rewords texts only', () => {
    expect(nurtureReworded('check_in', 'text')).toBe(true)
    expect(nurtureReworded('check_in', 'email')).toBe(false)
    expect(nurtureReworded('lead', 'text')).toBe(false)
  })
  it('gives the milestone and conversation', () => {
    const p = buildNurtureWordPrompt({ kind: 'due', firstName: 'Riley', loFirstName: 'Connor', goal: 'Buy next spring', milestone: 'Balances lowered', measure: 'Statements', targetDate: '2027-01-11', today: '2026-11-16' }, 'Hey Riley…', thread)
    expect(p).toMatch(/Milestone: Balances lowered/)
    expect(p).toMatch(/Riley \(text\): Paid off my Visa!/)
  })
  it('refuses promises, amounts, links and a missing name', () => {
    expect(nurtureDraftIssues('Hey Riley, how did the card payoff go?', 'Riley')).toEqual([])
    expect(nurtureDraftIssues('Hey Riley, you will qualify soon!', 'Riley')).toHaveLength(1)
    expect(nurtureDraftIssues('Hey Riley, that should boost your score fast', 'Riley')).toHaveLength(1)
    expect(nurtureDraftIssues('Hey Riley, save $500 more', 'Riley')).toHaveLength(1)
    expect(nurtureDraftIssues('Hey, see https://x.co', 'Riley')).toHaveLength(2)
    expect(readNurtureDraft({ body: '  hi ' })).toBe('hi')
  })
})

describe('reading a reply', () => {
  it('marks the new messages and lists the milestones by number', () => {
    const p = buildNurtureReadPrompt('Riley', 'Connor', 'Buy next spring', milestones, thread, '2026-11-12T00:00:00Z')
    expect(p).toMatch(/1\. Balances lowered \(step: Lower card balances\)/)
    expect(p).toMatch(/\[NEW\] \[2026-11-16\] Riley/)
    expect(p).not.toMatch(/\[NEW\] \[2026-11-10\]/)
  })
  it('keeps the milestone only when it is on the list', () => {
    const ok = readNurtureReading({ milestoneRef: 1, kind: 'reported_done', summary: 'Says the Visa is paid off.', suggestedNext: 'Ask for the statement.', confidence: 'high' }, milestones)
    expect(ok).toMatchObject({ milestoneId: 'm1', kind: 'reported_done', confidence: 'high' })
    const off = readNurtureReading({ milestoneRef: 7, kind: 'progress', summary: 'x', suggestedNext: 'y', confidence: 'high' }, milestones)
    expect(off).toMatchObject({ milestoneId: null, confidence: 'low' })
  })
  it('never passes on an approval suggestion', () => {
    const r = readNurtureReading({ milestoneRef: null, kind: 'question', summary: 'Asks if ready.', suggestedNext: 'Tell them they are approved.', confidence: 'low' }, milestones)
    expect('error' in r ? '' : r.suggestedNext).toBe('Review their update and decide the next step.')
    expect(readNurtureReading({ summary: '' }, milestones)).toHaveProperty('error')
  })
})
