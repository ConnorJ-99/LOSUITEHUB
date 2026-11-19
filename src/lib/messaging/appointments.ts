// Booking from a client's text thread (Connor, 2026-11-18): GHL's open times
// for the file's loan officer, grouped by day in Central time, and the
// confirmation text put in the message box after a booking (sent only on the
// usual click). Pure and tested.

export const BOOKING_TZ = 'America/Chicago'

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: BOOKING_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const dayLabelFmt = new Intl.DateTimeFormat('en-US', { timeZone: BOOKING_TZ, weekday: 'short', month: 'short', day: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: BOOKING_TZ, hour: 'numeric', minute: '2-digit' })
const longFmt = new Intl.DateTimeFormat('en-US', { timeZone: BOOKING_TZ, weekday: 'long', month: 'long', day: 'numeric' })

/** "2:30 PM" in Central time. */
export const slotTime = (iso: string) => timeFmt.format(new Date(iso))

/** "Thursday, November 20 at 2:30 PM" in Central time. */
export const slotLong = (iso: string) => `${longFmt.format(new Date(iso))} at ${slotTime(iso)}`

export interface SlotDay {
  /** YYYY-MM-DD in Central time. */
  key: string
  /** "Thu, Nov 20", or "Today" / "Tomorrow". */
  label: string
  slots: string[]
}

/** Open times grouped by Central day, in order. `now` decides Today / Tomorrow. */
export function slotsByDay(slots: string[], now = new Date()): SlotDay[] {
  const today = dayKey.format(now)
  const tomorrow = dayKey.format(new Date(now.getTime() + 86_400_000))
  const days = new Map<string, SlotDay>()
  for (const s of [...slots].sort((a, b) => Date.parse(a) - Date.parse(b))) {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) continue
    const key = dayKey.format(d)
    const label = key === today ? 'Today' : key === tomorrow ? 'Tomorrow' : dayLabelFmt.format(d)
    const day = days.get(key) ?? { key, label, slots: [] }
    day.slots.push(s)
    days.set(key, day)
  }
  return [...days.values()]
}

/** "Today 2:30 PM", "Tomorrow 9:00 AM", "Fri, Nov 21 2:30 PM" in Central time. */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const key = dayKey.format(d)
  const day = key === dayKey.format(now) ? 'Today' : key === dayKey.format(new Date(now.getTime() + 86_400_000)) ? 'Tomorrow' : dayLabelFmt.format(d)
  return `${day} ${slotTime(iso)}`
}

/** True when the appointment is on today's date in Central time. */
export const isToday = (iso: string, now = new Date()) => dayKey.format(new Date(iso)) === dayKey.format(now)

/**
 * A file's appointments split for the Overview: coming up (not cancelled, not
 * ended yet; soonest first) and past (ended or cancelled; newest first, the
 * last 3).
 */
export function splitAppointments<T extends { startsAt: string; endsAt: string; status: string }>(rows: T[], now = new Date()): { upcoming: T[]; past: T[] } {
  const t = now.getTime()
  const upcoming = rows.filter((r) => r.status !== 'cancelled' && Date.parse(r.endsAt) > t).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  const past = rows
    .filter((r) => !upcoming.includes(r))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))
    .slice(0, 3)
  return { upcoming, past }
}

/** The text put in the message box after booking. Plain words, no link; edited and sent by the loan officer. */
export function confirmationText(v: { borrowerFirst: string; loFirst: string; start: string; minutes: number; bookedByLo: boolean }): string {
  const first = v.borrowerFirst.trim() || 'there'
  const with_ = v.bookedByLo ? 'with me' : `with ${v.loFirst}`
  return `Hi ${first}, you're all set ${with_} on ${slotLong(v.start)} Central (about ${v.minutes} minutes). If that time stops working, just reply here and we'll find another.`
}
