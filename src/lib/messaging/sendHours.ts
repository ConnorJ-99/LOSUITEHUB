// The hours texts and emails may go out (Connor, 2026-10-29): Mon–Sat 9am–9pm
// and Sun noon–9pm, Central time, by default. It's a setting he can change
// while he confirms the window with compliance. Stored on
// messaging_settings.send_hours; the database checks the same rules as
// validSendHours().

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Day = (typeof DAYS)[number]

export const DAY_LABELS: Record<Day, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const SHORT: Record<Day, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

/** Each day: [start, end] as "HH:MM" (24-hour), or null when nothing goes out. */
export type SendHours = Record<Day, [string, string] | null>

export const DEFAULT_SEND_HOURS: SendHours = {
  mon: ['09:00', '21:00'],
  tue: ['09:00', '21:00'],
  wed: ['09:00', '21:00'],
  thu: ['09:00', '21:00'],
  fri: ['09:00', '21:00'],
  sat: ['09:00', '21:00'],
  sun: ['12:00', '21:00'],
}

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/** The first problem with these hours, in plain English, or null when they're fine. */
export function sendHoursProblem(hours: SendHours): string | null {
  for (const d of DAYS) {
    const v = hours[d]
    if (v === null) continue
    if (!TIME.test(v[0]) || !TIME.test(v[1])) return `${DAY_LABELS[d]}: enter a start and an end time.`
    if (v[0] >= v[1]) return `${DAY_LABELS[d]}: the end time must be after the start time.`
  }
  return null
}

/** Reads the saved value; anything missing or unreadable falls back to the default for that day. */
export function readSendHours(value: unknown): SendHours {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const out = { ...DEFAULT_SEND_HOURS }
  for (const d of DAYS) {
    if (!(d in raw)) continue
    const v = raw[d]
    if (v === null) out[d] = null
    else if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && TIME.test(v[0]) && TIME.test(v[1]) && v[0] < v[1]) out[d] = [v[0], v[1]]
  }
  return out
}

/** "9:00" → "9 AM", "21:00" → "9 PM", "12:30" → "12:30 PM". */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'AM' : 'PM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`
}

/** One line for the screen: "Mon–Sat 9 AM–9 PM · Sun 12 PM–9 PM". Days with the same hours in a row are grouped. */
export function sendHoursSummary(hours: SendHours): string {
  const parts: string[] = []
  let i = 0
  while (i < DAYS.length) {
    const v = hours[DAYS[i]]
    let j = i
    while (j + 1 < DAYS.length && JSON.stringify(hours[DAYS[j + 1]]) === JSON.stringify(v)) j++
    const days = i === j ? SHORT[DAYS[i]] : `${SHORT[DAYS[i]]}–${SHORT[DAYS[j]]}`
    parts.push(v ? `${days} ${timeLabel(v[0])}–${timeLabel(v[1])}` : `${days} none`)
    i = j + 1
  }
  return parts.join(' · ')
}
