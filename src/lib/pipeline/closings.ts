// The closing calendar: every file with a closing date (loans.closing_date,
// from the contract on a purchase or typed on Overview for a refi), by month.
// Each loan is its own entry, so a borrower who buys two homes or refinances
// later shows once per closing. Pure.

import type { PipelineStage } from './stages'

export interface ClosingFile {
  stage: PipelineStage
  closingDate: string | null
}

/** Closed, still to come, or the date went by without the file closing (the date needs updating). */
export type ClosingStatus = 'closed' | 'upcoming' | 'date_passed'

/** Stages that should have a closing date: the contract or application is in. */
const NEEDS_DATE: PipelineStage[] = ['under_contract', 'processing', 'clear_to_close']

/** Files on the calendar, earliest first: a closing date, and not in Nurture or Lost. */
export function calendarClosings<F extends ClosingFile>(files: F[]): (F & { closingDate: string })[] {
  return files
    .filter((f): f is F & { closingDate: string } => !!f.closingDate && f.stage !== 'nurture' && f.stage !== 'lost')
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate))
}

export function closingStatus(f: ClosingFile & { closingDate: string }, today: string): ClosingStatus {
  if (f.stage === 'closed') return 'closed'
  return f.closingDate < today ? 'date_passed' : 'upcoming'
}

/** Files under contract (or application) through Clear to Close that have no closing date yet. */
export function missingClosingDate<F extends ClosingFile>(files: F[]): F[] {
  return files.filter((f) => !f.closingDate && NEEDS_DATE.includes(f.stage))
}

/** How an entry reads on the calendar, its list and the home page: grey when closed, red when the date passed. */
export const CLOSING_STYLE: Record<ClosingStatus, string> = {
  upcoming: 'bg-primary/10 text-primary',
  closed: 'bg-muted text-muted-foreground',
  date_passed: 'bg-urgent/10 text-urgent',
}

/**
 * The home page's closings box: this month's closings (closed ones too), every file whose
 * date went by without closing (it needs a new date), and the next few still to come.
 */
export function closingsGlance<F extends ClosingFile>(files: F[], today: string, upcomingCount = 5) {
  const closings = calendarClosings(files)
  return {
    thisMonth: closings.filter((c) => c.closingDate.startsWith(today.slice(0, 7))),
    datePassed: closings.filter((c) => closingStatus(c, today) === 'date_passed'),
    upcoming: closings.filter((c) => closingStatus(c, today) === 'upcoming').slice(0, upcomingCount),
    noDate: missingClosingDate(files),
  }
}

/** "2026-10" → "2026-11" (by = 1) or "2026-09" (by = -1). */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

const monthYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

/** "2026-10" → "October 2026". */
export const monthLabel = (month: string) => monthYear.format(new Date(`${month}-01T00:00:00Z`))

/** The weeks shown for a month, Sunday first, as YYYY-MM-DD; days from the months either side fill the first and last week. */
export function monthWeeks(month: string): string[][] {
  const first = new Date(`${month}-01T00:00:00Z`)
  const start = new Date(first)
  start.setUTCDate(1 - first.getUTCDay())
  const weeks: string[][] = []
  const day = new Date(start)
  do {
    const week: string[] = []
    for (let i = 0; i < 7; i++) {
      week.push(day.toISOString().slice(0, 10))
      day.setUTCDate(day.getUTCDate() + 1)
    }
    weeks.push(week)
  } while (day.toISOString().slice(0, 7) === month)
  return weeks
}
