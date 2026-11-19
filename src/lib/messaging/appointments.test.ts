import { describe, expect, it } from 'vitest'
import { confirmationText, isToday, slotLong, slotsByDay, slotTime, splitAppointments, whenLabel } from './appointments'

describe('appointments on the file and Today', () => {
  const now = new Date('2026-11-19T16:00:00Z') // Wed 10:00 AM Central

  it('labels when, in Central time', () => {
    expect(whenLabel('2026-11-19T20:30:00Z', now)).toBe('Today 2:30 PM')
    expect(whenLabel('2026-11-20T15:00:00Z', now)).toBe('Tomorrow 9:00 AM')
    expect(whenLabel('2026-11-21T20:30:00Z', now)).toBe('Sat, Nov 21 2:30 PM')
    expect(isToday('2026-11-20T05:00:00Z', now)).toBe(true) // 11 PM Central on the 19th
  })

  it('splits coming up from past, keeping one still going as coming up', () => {
    const a = (id: string, start: string, end: string, status = 'booked') => ({ id, startsAt: start, endsAt: end, status })
    const rows = [
      a('later', '2026-11-21T15:00:00Z', '2026-11-21T15:30:00Z'),
      a('now', '2026-11-19T15:45:00Z', '2026-11-19T16:15:00Z'),
      a('done', '2026-11-18T15:00:00Z', '2026-11-18T15:30:00Z'),
      a('cancelled', '2026-11-22T15:00:00Z', '2026-11-22T15:30:00Z', 'cancelled'),
    ]
    const s = splitAppointments(rows, now)
    expect(s.upcoming.map((r) => r.id)).toEqual(['now', 'later'])
    expect(s.past.map((r) => r.id)).toEqual(['cancelled', 'done'])
  })
})

describe('booking open times', () => {
  // Wed Nov 19 2026, 10:00 AM Central.
  const now = new Date('2026-11-19T16:00:00Z')

  it('groups open times by Central day with Today and Tomorrow', () => {
    const days = slotsByDay(['2026-11-21T15:00:00Z', '2026-11-19T20:00:00Z', '2026-11-20T15:30:00Z', '2026-11-20T15:00:00Z', 'bad'], now)
    expect(days.map((d) => d.label)).toEqual(['Today', 'Tomorrow', 'Sat, Nov 21'])
    expect(days[1].slots).toEqual(['2026-11-20T15:00:00Z', '2026-11-20T15:30:00Z'])
  })

  it('puts a late-evening UTC time on the right Central day', () => {
    // 11:30 PM Central on Nov 20 is Nov 21 in UTC.
    const days = slotsByDay(['2026-11-21T05:30:00Z'], now)
    expect(days[0].key).toBe('2026-11-20')
    expect(slotTime('2026-11-21T05:30:00Z')).toBe('11:30 PM')
  })

  it('writes the time in full', () => {
    expect(slotLong('2026-11-20T20:30:00Z')).toBe('Friday, November 20 at 2:30 PM')
  })

  it('writes a confirmation text from the LO or from someone booking for them', () => {
    expect(confirmationText({ borrowerFirst: 'Maria', loFirst: 'Connor', start: '2026-11-20T20:30:00Z', minutes: 30, bookedByLo: true })).toBe(
      "Hi Maria, you're all set with me on Friday, November 20 at 2:30 PM Central (about 30 minutes). If that time stops working, just reply here and we'll find another.",
    )
    expect(confirmationText({ borrowerFirst: '', loFirst: 'Connor', start: '2026-11-20T20:30:00Z', minutes: 60, bookedByLo: false })).toContain('Hi there, you\'re all set with Connor')
  })
})
