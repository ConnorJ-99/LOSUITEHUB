// Date display helpers. Calendar dates are stored as YYYY-MM-DD strings.

const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const monthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** Today's local calendar date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const toUtc = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`)
const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)

/** "Oct 25, 2026" for a YYYY-MM-DD date. */
export function formatIsoDate(isoDate: string | null | undefined): string {
  return isoDate ? monthDayYear.format(toUtc(isoDate)) : '—'
}

export interface DueLabel {
  text: string
  overdue: boolean
}

/** "Today", "Tomorrow", "Overdue · Oct 20", or "Oct 30" for a task due date. */
export function dueLabel(dueOn: string, today: string): DueLabel {
  const days = daysBetween(today, dueOn)
  if (days < 0) return { text: `Overdue · ${monthDay.format(toUtc(dueOn))}`, overdue: true }
  if (days === 0) return { text: 'Today', overdue: false }
  if (days === 1) return { text: 'Tomorrow', overdue: false }
  return { text: monthDay.format(toUtc(dueOn)), overdue: false }
}

/** "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", then a date. */
export function relativeTime(isoTimestamp: string, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(isoTimestamp).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = daysBetween(todayIso(new Date(isoTimestamp)), todayIso(now))
  if (days <= 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return monthDayYear.format(new Date(isoTimestamp))
}
