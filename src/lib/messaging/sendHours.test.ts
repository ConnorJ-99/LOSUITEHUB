import { describe, expect, it } from 'vitest'
import { DEFAULT_SEND_HOURS, readSendHours, sendHoursProblem, sendHoursSummary, timeLabel } from './sendHours'

describe('sending hours', () => {
  it('defaults to Mon–Sat 9 AM–9 PM and Sun noon–9 PM', () => {
    expect(sendHoursSummary(DEFAULT_SEND_HOURS)).toBe('Mon–Sat 9 AM–9 PM · Sun 12 PM–9 PM')
    expect(sendHoursProblem(DEFAULT_SEND_HOURS)).toBeNull()
  })

  it('shows a day with no sending', () => {
    expect(sendHoursSummary({ ...DEFAULT_SEND_HOURS, sun: null })).toBe('Mon–Sat 9 AM–9 PM · Sun none')
    expect(sendHoursSummary({ ...DEFAULT_SEND_HOURS, wed: ['10:00', '18:30'] })).toBe('Mon–Tue 9 AM–9 PM · Wed 10 AM–6:30 PM · Thu–Sat 9 AM–9 PM · Sun 12 PM–9 PM')
  })

  it('refuses an end before the start, or a missing time', () => {
    expect(sendHoursProblem({ ...DEFAULT_SEND_HOURS, tue: ['21:00', '09:00'] })).toBe('Tuesday: the end time must be after the start time.')
    expect(sendHoursProblem({ ...DEFAULT_SEND_HOURS, fri: ['', '21:00'] })).toBe('Friday: enter a start and an end time.')
  })

  it('reads what was saved, falling back to the default for anything unreadable', () => {
    expect(readSendHours({ ...DEFAULT_SEND_HOURS, sun: null })).toEqual({ ...DEFAULT_SEND_HOURS, sun: null })
    expect(readSendHours({ mon: ['8:00', '21:00'], tue: ['21:00', '09:00'] })).toEqual(DEFAULT_SEND_HOURS)
    expect(readSendHours(null)).toEqual(DEFAULT_SEND_HOURS)
  })

  it('labels times the way people say them', () => {
    expect(timeLabel('09:00')).toBe('9 AM')
    expect(timeLabel('12:00')).toBe('12 PM')
    expect(timeLabel('00:30')).toBe('12:30 AM')
    expect(timeLabel('21:00')).toBe('9 PM')
  })
})
