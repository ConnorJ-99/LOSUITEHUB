import { describe, expect, it } from 'vitest'
import { contactIsStale, daysSinceContact, isLeadStage, lastContactLabel, NEXT_ACTIONS, nextActionInfo } from './nextAction'

const now = new Date('2026-11-16T18:00:00Z')

describe('next action', () => {
  it('has the seven tags from the spec', () => {
    expect(NEXT_ACTIONS.map((a) => a.label)).toEqual([
      'Waiting on Application',
      'Application In Progress',
      'Waiting on Documents',
      'Needs LO Review',
      'Ready to Shop',
      'Property Found',
      'Waiting on Borrower',
    ])
    expect(nextActionInfo('waiting_documents')?.label).toBe('Waiting on Documents')
    expect(nextActionInfo(null)).toBeNull()
    expect(nextActionInfo('nonsense')).toBeNull()
  })

  it('covers lead stages only', () => {
    expect(isLeadStage('pre_qualified')).toBe(true)
    expect(isLeadStage('home_search')).toBe(true)
    expect(isLeadStage('under_contract')).toBe(false)
    expect(isLeadStage('nurture')).toBe(false)
  })

  it('words the last contact', () => {
    expect(lastContactLabel(null, now)).toBe('No contact yet')
    expect(lastContactLabel('2026-11-16T09:00:00Z', now)).toBe('Contacted today')
    expect(lastContactLabel('2026-11-13T17:00:00Z', now)).toBe('Last contact 3d ago')
    expect(daysSinceContact('2026-11-20T00:00:00Z', now)).toBe(0)
  })

  it('flags a week or more without contact', () => {
    expect(contactIsStale(null, now)).toBe(true)
    expect(contactIsStale('2026-11-09T18:00:00Z', now)).toBe(true)
    expect(contactIsStale('2026-11-12T18:00:00Z', now)).toBe(false)
  })
})
