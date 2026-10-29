import { describe, expect, it } from 'vitest'
import { calendarClosings, closingStatus, missingClosingDate, monthLabel, monthWeeks, shiftMonth } from './closings'
import type { PipelineStage } from './stages'

const file = (id: string, stage: PipelineStage, closingDate: string | null) => ({ id, stage, closingDate })

describe('closing calendar', () => {
  it('every file with a closing date, earliest first, leaving out Nurture and Lost', () => {
    const files = [
      file('a', 'under_contract', '2026-11-20'),
      file('b', 'closed', '2026-10-02'),
      file('c', 'lost', '2026-11-05'),
      file('d', 'nurture', '2026-11-06'),
      file('e', 'processing', null),
      file('f', 'clear_to_close', '2026-11-01'),
    ]
    expect(calendarClosings(files).map((f) => f.id)).toEqual(['b', 'f', 'a'])
  })
  it('a borrower with two closings shows twice (one entry per loan)', () => {
    const purchase = { ...file('p1', 'closed', '2025-06-10'), borrower: 'Ana' }
    const refi = { ...file('r1', 'processing', '2026-11-12'), borrower: 'Ana' }
    expect(calendarClosings([refi, purchase]).map((f) => f.id)).toEqual(['p1', 'r1'])
  })
  it('closed, upcoming, or the date went by without closing', () => {
    const today = '2026-10-29'
    expect(closingStatus({ stage: 'closed', closingDate: '2026-10-02' }, today)).toBe('closed')
    expect(closingStatus({ stage: 'clear_to_close', closingDate: '2026-10-29' }, today)).toBe('upcoming')
    expect(closingStatus({ stage: 'processing', closingDate: '2026-10-28' }, today)).toBe('date_passed')
  })
  it('files past the contract with no closing date yet', () => {
    const files = [file('a', 'under_contract', null), file('b', 'pre_approved', null), file('c', 'processing', '2026-11-01'), file('d', 'clear_to_close', null)]
    expect(missingClosingDate(files).map((f) => f.id)).toEqual(['a', 'd'])
  })
})

describe('months', () => {
  it('moves across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(monthLabel('2026-10')).toBe('October 2026')
  })
  it('weeks start on Sunday and cover the whole month', () => {
    const weeks = monthWeeks('2026-10')
    expect(weeks[0][0]).toBe('2026-09-27')
    expect(weeks.at(-1)!.at(-1)).toBe('2026-10-31')
    expect(weeks).toHaveLength(5)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(monthWeeks('2026-11').at(-1)![0]).toBe('2026-11-29')
  })
})
