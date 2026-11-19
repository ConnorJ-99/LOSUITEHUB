import { describe, expect, it } from 'vitest'
import { appointmentBody, endFor, isOpenSlot, pickAppointmentId, pickCalendars, pickSlots, suggestCalendar } from './calendar'

describe('GHL open times and booking', () => {
  const slotsBody = {
    '2026-11-21': { slots: ['2026-11-21T09:00:00-06:00'] },
    '2026-11-20': { slots: ['2026-11-20T14:00:00-06:00', '2026-11-20T09:30:00-06:00', 'not a date'] },
    traceId: 'abc',
  }

  it('reads open times, oldest first', () => {
    expect(pickSlots(slotsBody)).toEqual(['2026-11-20T09:30:00-06:00', '2026-11-20T14:00:00-06:00', '2026-11-21T09:00:00-06:00'])
    expect(pickSlots(null)).toEqual([])
    expect(pickSlots({ traceId: 'x' })).toEqual([])
  })

  it('matches a requested time to an open one whatever the offset', () => {
    const slots = pickSlots(slotsBody)
    expect(isOpenSlot(slots, '2026-11-20T20:00:00.000Z')).toBe(true)
    expect(isOpenSlot(slots, '2026-11-20T21:00:00.000Z')).toBe(false)
    expect(isOpenSlot(slots, 'nonsense')).toBe(false)
  })

  it('ends after the calendar length, else 30 minutes', () => {
    expect(endFor('2026-11-20T15:00:00.000Z', 60)).toBe('2026-11-20T16:00:00.000Z')
    expect(endFor('2026-11-20T15:00:00.000Z', null)).toBe('2026-11-20T15:30:00.000Z')
  })

  it('books confirmed, on the LO, with GHL notifications off', () => {
    const b = appointmentBody({ calendarId: 'c1', locationId: 'loc', ghlContactId: 'gc', ghlUserId: 'u1', start: 's', end: 'e', title: 'Call with Maria' })
    expect(b).toMatchObject({ calendarId: 'c1', contactId: 'gc', assignedUserId: 'u1', appointmentStatus: 'confirmed', toNotify: false })
  })

  it("reads GHL's appointment id flat or wrapped", () => {
    expect(pickAppointmentId({ id: 'a1' })).toBe('a1')
    expect(pickAppointmentId({ appointment: { id: 'a2' } })).toBe('a2')
    expect(pickAppointmentId({})).toBeNull()
  })
})

const body = {
  calendars: [
    { id: 'c2', name: 'Team calls', isActive: true, calendarType: 'round_robin', teamMembers: [{ userId: 'u1' }, { userId: 'u2' }], slotDuration: 30, slotDurationUnit: 'mins' },
    { id: 'c1', name: ' Connor 1:1 ', isActive: true, calendarType: 'personal', teamMembers: [{ userId: 'u1' }], slotDuration: 1, slotDurationUnit: 'hours' },
    { id: 'c3', name: 'Old', isActive: false, teamMembers: [{ userId: 'u3' }] },
    { name: 'no id' },
  ],
}

describe('GHL calendars', () => {
  it('reads the calendar list, sorted by name', () => {
    const list = pickCalendars(body)
    expect(list.map((c) => c.id)).toEqual(['c1', 'c3', 'c2'])
    expect(list[0]).toEqual({ id: 'c1', name: 'Connor 1:1', active: true, type: 'personal', userIds: ['u1'], slotMinutes: 60 })
    expect(list[2].slotMinutes).toBe(30)
    expect(list[1].active).toBe(false)
    expect(pickCalendars(null)).toEqual([])
  })

  it("suggests a loan officer's own calendar, else the only one they're on", () => {
    const list = pickCalendars(body)
    expect(suggestCalendar(list, 'u1')?.id).toBe('c1')
    expect(suggestCalendar(list, 'u2')?.id).toBe('c2')
    expect(suggestCalendar(list, 'u3')).toBeNull()
    expect(suggestCalendar(list, 'nobody')).toBeNull()
  })
})
