import { describe, expect, it } from 'vitest'
import { dueLabel, formatIsoDate, joinMonths, relativeTime, splitMonths, todayIso } from './dates'

describe('dates', () => {
  it('formats calendar dates without timezone drift', () => {
    expect(formatIsoDate('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatIsoDate(null)).toBe('—')
  })

  it('gives today as a local YYYY-MM-DD', () => {
    expect(todayIso(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05')
  })

  it('labels due dates', () => {
    expect(dueLabel('2026-10-25', '2026-10-25')).toEqual({ text: 'Today', overdue: false })
    expect(dueLabel('2026-10-26', '2026-10-25')).toEqual({ text: 'Tomorrow', overdue: false })
    expect(dueLabel('2026-10-30', '2026-10-25')).toEqual({ text: 'Oct 30', overdue: false })
    expect(dueLabel('2026-10-20', '2026-10-25')).toEqual({ text: 'Overdue · Oct 20', overdue: true })
  })

  it('describes how long ago something happened', () => {
    const now = new Date(2026, 9, 25, 15, 0)
    expect(relativeTime(new Date(2026, 9, 25, 14, 59, 30).toISOString(), now)).toBe('just now')
    expect(relativeTime(new Date(2026, 9, 25, 14, 55).toISOString(), now)).toBe('5 min ago')
    expect(relativeTime(new Date(2026, 9, 25, 12, 0).toISOString(), now)).toBe('3 hours ago')
    expect(relativeTime(new Date(2026, 9, 24, 9, 0).toISOString(), now)).toBe('yesterday')
    expect(relativeTime(new Date(2026, 9, 21, 9, 0).toISOString(), now)).toBe('4 days ago')
    expect(relativeTime(new Date(2026, 8, 1, 9, 0).toISOString(), now)).toBe('Sep 1, 2026')
  })
})

describe('years and months', () => {
  it('splits and joins month counts', () => {
    expect(splitMonths(30)).toEqual({ years: '2', months: '6' })
    expect(splitMonths(null)).toEqual({ years: '', months: '' })
    expect(joinMonths('2', '6')).toBe(30)
    expect(joinMonths('', '')).toBeNull()
    expect(joinMonths('1', '')).toBe(12)
    expect(joinMonths('-3', 'x')).toBe(0)
  })
})
