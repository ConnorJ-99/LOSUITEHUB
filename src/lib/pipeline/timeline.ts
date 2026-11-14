// Timeline: when the borrower wants to buy or refinance (Pipeline v2 card
// dropdown). It lives in loans.timeline, which call notes and web leads also
// fill in their own words; those stay as typed and show as "Other". Pure.

export const TIMELINE_OPTIONS = ['ASAP', '1 month', '2 months', '3 months', '3–6 months', '6+ months', 'Just looking'] as const
export type TimelineOption = (typeof TIMELINE_OPTIONS)[number]

const ALIASES: Record<string, TimelineOption> = {
  asap: 'ASAP',
  now: 'ASAP',
  immediately: 'ASAP',
  'right away': 'ASAP',
  '0-30 days': 'ASAP',
  '30-60 days': '1 month',
  '1-2 months': '1 month',
  '1-3 months': '1 month',
  '60-90 days': '2 months',
  '2-3 months': '2 months',
  'in the next 3 months': '3 months',
  'next 3 months': '3 months',
  'within 3 months': '3 months',
  '90+ days': '3 months',
  '30 days': '1 month',
  '1 month': '1 month',
  'one month': '1 month',
  '60 days': '2 months',
  '2 months': '2 months',
  'two months': '2 months',
  '90 days': '3 months',
  '3 months': '3 months',
  'three months': '3 months',
  '3-6 months': '3–6 months',
  '3 to 6 months': '3–6 months',
  '6+ months': '6+ months',
  '6 months+': '6+ months',
  'over 6 months': '6+ months',
  'just looking': 'Just looking',
  browsing: 'Just looking',
}

const loose = (text: string) => text.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()

/** Which dropdown option a saved timeline is, or "other" for words typed elsewhere (e.g. "after the lease ends"). */
export function timelineChoice(saved: string | null): TimelineOption | 'other' | null {
  if (!saved || !saved.trim()) return null
  const exact = TIMELINE_OPTIONS.find((o) => loose(o) === loose(saved))
  return exact ?? ALIASES[loose(saved)] ?? 'other'
}

// ---------------------------------------------------------------------------
// Ready date (Connor, 2026-11-14): loans.ready_on, set by the database from the
// time frame on the day it's picked (20270128000000_lead_ready_on.sql).
// ---------------------------------------------------------------------------

const MONTHS_FOR: Record<TimelineOption, number | null> = {
  ASAP: 0,
  '1 month': 1,
  '2 months': 2,
  '3 months': 3,
  '3–6 months': 3,
  '6+ months': 6,
  'Just looking': null,
}

/** How many months a time frame means (the start of a window); null for "Just looking" or typed words. */
export function timelineMonths(saved: string | null): number | null {
  const c = timelineChoice(saved)
  return c && c !== 'other' ? MONTHS_FOR[c] : null
}

/** The ready date a time frame gives when picked on `today` (YYYY-MM-DD); the database does the same. */
export function readyOnFor(saved: string | null, today: string): string | null {
  const m = timelineMonths(saved)
  if (m === null) return null
  const [y, mo, d] = today.split('-').map(Number)
  const total = y * 12 + (mo - 1) + m
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Ready now" once the month has come, "Ready Dec" this year, "Ready Feb 2027" after. */
export function readyLabel(readyOn: string, today: string): string {
  if (readyOn.slice(0, 7) <= today.slice(0, 7)) return 'Ready now'
  const name = MONTH_NAMES[Number(readyOn.slice(5, 7)) - 1]
  return readyOn.slice(0, 4) === today.slice(0, 4) ? `Ready ${name}` : `Ready ${name} ${readyOn.slice(0, 4)}`
}
