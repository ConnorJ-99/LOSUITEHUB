// GoHighLevel calendars (Connor, 2026-11-18): appointments are booked from a
// client's text thread onto the file's loan officer's own GHL calendar, picked
// once per loan officer in Settings → GoHighLevel. This file reads GHL's
// calendar list. Pure and import-free so it can be tested and pasted with
// index.ts.
//
// GET /calendars/?locationId= (calendars.readonly, Version 2021-04-15) answers
// { calendars: [{ id, name, isActive, calendarType, teamMembers: [{ userId }],
// slotDuration, slotDurationUnit }] }.

export interface GhlCalendar {
  id: string
  name: string
  active: boolean
  /** personal, round_robin, event, collective, class_booking, service_booking… */
  type: string | null
  /** GHL user ids on the calendar's team. */
  userIds: string[]
  /** Appointment length in minutes, when GHL says. */
  slotMinutes: number | null
}

const minutes = (value: unknown, unit: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return unit === 'hours' || unit === 'hour' ? value * 60 : value
}

/** Keeps only what MPS HQ needs from GHL's calendar records, sorted by name. */
export function pickCalendars(body: unknown): GhlCalendar[] {
  const list = (body as { calendars?: unknown } | null)?.calendars
  if (!Array.isArray(list)) return []
  return list
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string')
    .map((c) => ({
      id: c.id as string,
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Unnamed calendar',
      active: c.isActive !== false,
      type: typeof c.calendarType === 'string' ? c.calendarType : null,
      userIds: Array.isArray(c.teamMembers)
        ? (c.teamMembers as unknown[]).flatMap((m) => {
            const id = (m as { userId?: unknown } | null)?.userId
            return typeof id === 'string' && id ? [id] : []
          })
        : [],
      slotMinutes: minutes(c.slotDuration, c.slotDurationUnit),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Appointments in MPS HQ are shown and booked in Central time. */
export const BOOKING_TIMEZONE = 'America/Chicago'
/** How long an appointment is when the calendar doesn't say. */
export const DEFAULT_MINUTES = 30
/** How far ahead open times can be asked for. */
export const MAX_DAYS_AHEAD = 31

/**
 * The open times from GET /calendars/{id}/free-slots (calendars.readonly,
 * Version 2021-04-15), which answers { "2026-11-20": { slots: ["2026-11-20T09:00:00-06:00", …] }, traceId }.
 * Returned as start times (ISO, as GHL gave them), oldest first, each once.
 */
export function pickSlots(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const out = new Set<string>()
  for (const [day, value] of Object.entries(body as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const slots = (value as { slots?: unknown } | null)?.slots
    if (!Array.isArray(slots)) continue
    for (const s of slots) if (typeof s === 'string' && !Number.isNaN(Date.parse(s))) out.add(s)
  }
  return [...out].sort((a, b) => Date.parse(a) - Date.parse(b))
}

/** A requested start is open when GHL lists that same moment (whatever offset it's written with). */
export function isOpenSlot(slots: string[], start: string): boolean {
  const t = Date.parse(start)
  return !Number.isNaN(t) && slots.some((s) => Date.parse(s) === t)
}

/** The end time: start + the calendar's appointment length (else 30 minutes). */
export function endFor(start: string, slotMinutes: number | null): string {
  return new Date(Date.parse(start) + (slotMinutes ?? DEFAULT_MINUTES) * 60_000).toISOString()
}

/**
 * The body for POST /calendars/events/appointments (calendars/events.write,
 * Version 2021-04-15). Booked as confirmed on the loan officer's calendar and
 * assigned to their GHL user; toNotify off, so GHL sends nothing on its own
 * (the loan officer sends the confirmation text from MPS HQ).
 */
export function appointmentBody(v: { calendarId: string; locationId: string; ghlContactId: string; ghlUserId: string; start: string; end: string; title: string }) {
  return {
    calendarId: v.calendarId,
    locationId: v.locationId,
    contactId: v.ghlContactId,
    assignedUserId: v.ghlUserId,
    startTime: v.start,
    endTime: v.end,
    title: v.title,
    appointmentStatus: 'confirmed',
    toNotify: false,
  }
}

/** GHL's id for the appointment it made (it has answered both flat and wrapped). */
export function pickAppointmentId(body: unknown): string | null {
  const b = body as { id?: unknown; appointment?: { id?: unknown }; event?: { id?: unknown } } | null
  const id = b?.id ?? b?.appointment?.id ?? b?.event?.id
  return typeof id === 'string' && id ? id : null
}

/**
 * The calendar to suggest for a loan officer's GHL user: an active calendar
 * where they're the only team member (their personal calendar), else the only
 * active calendar they're on. Null when it isn't clear; Connor picks.
 */
export function suggestCalendar(calendars: GhlCalendar[], ghlUserId: string): GhlCalendar | null {
  const theirs = calendars.filter((c) => c.active && c.userIds.includes(ghlUserId))
  const own = theirs.filter((c) => c.userIds.length === 1)
  if (own.length === 1) return own[0]
  return theirs.length === 1 ? theirs[0] : null
}
