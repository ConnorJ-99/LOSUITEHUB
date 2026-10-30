// How the Messages tab shows a thread (Phase 2b, Connor 2026-10-29): day
// headings and times in Central time, consent labels, and people on the file
// who share a phone. Pure and tested; the components only lay it out.

const TZ = 'America/Chicago'
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const dayName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })
const dayNameYear = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' })
const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })

/** "9:40 AM", Central time. */
export function timeOfDay(iso: string): string {
  return clock.format(new Date(iso))
}

/** "Today", "Yesterday", "Mon, Oct 27", or "Mar 3, 2025" for another year. Central time. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const key = dayKey.format(d)
  if (key === dayKey.format(now)) return 'Today'
  if (key === dayKey.format(new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return key.slice(0, 4) === dayKey.format(now).slice(0, 4) ? dayName.format(d) : dayNameYear.format(d)
}

/** Messages (oldest first) under a heading per day. */
export function groupByDay<T extends { sentAt: string }>(messages: T[], now: Date = new Date()): { label: string; messages: T[] }[] {
  const groups: { label: string; messages: T[] }[] = []
  for (const m of messages) {
    const label = dayLabel(m.sentAt, now)
    const last = groups.at(-1)
    if (last && last.label === label) last.messages.push(m)
    else groups.push({ label, messages: [m] })
  }
  return groups
}

export type Tone = 'ok' | 'warn' | 'bad'

/** One channel's consent as a chip: opted out beats everything; blank means nobody asked yet. */
export function consentChip(channel: 'text' | 'email', consent: boolean | null, optedOutAt: string | null): { label: string; tone: Tone } {
  const what = channel === 'text' ? 'Texts' : 'Email'
  if (optedOutAt) return { label: `Opted out ${dayNameYear.format(new Date(optedOutAt))}`, tone: 'bad' }
  if (consent === true) return { label: `${what} OK`, tone: 'ok' }
  if (consent === false) return { label: `No ${channel === 'text' ? 'text' : 'email'} consent`, tone: 'warn' }
  return { label: 'Consent not recorded', tone: 'warn' }
}

const last10 = (digits: string | null) => (digits && digits.length >= 10 ? digits.slice(-10) : null)

/** People on the file who share a phone with someone else on it (a household number). */
export function sharedPhoneIds(people: { id: string; phoneDigits: string | null }[]): Set<string> {
  const byPhone = new Map<string, string[]>()
  for (const p of people) {
    const key = last10(p.phoneDigits)
    if (key) byPhone.set(key, [...(byPhone.get(key) ?? []), p.id])
  }
  return new Set([...byPhone.values()].filter((ids) => ids.length > 1).flat())
}
