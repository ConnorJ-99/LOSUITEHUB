// Employment-driven document requests and history checks (Stage 3a; plan
// docs/plans/employment-documents.md). Pure: from the jobs on the 1003 and
// today's date. The numbers come from employmentRules.ts.
//
// W-2 jobs with dates:
//   current  → pay stubs covering the last 30 days, and a W-2 for each
//              finished calendar year worked there inside the last 2 years
//   previous → (ended inside the last 2 years) a W-2 for each calendar year
//              worked there inside the window, and the final pay stub
// History (every job, W-2 or self-employed):
//   under 2 years covered → more employment/education history
//   a break over 30 days  → a letter of explanation with the dates
//   a current job started in the last 6 months → flag for review

import { EMPLOYMENT_RULES as R } from './employmentRules'

export interface HistoryJob {
  id: string
  employerName: string
  selfEmployed: boolean
  current: boolean
  /** YYYY-MM-DD. */
  startDate: string | null
  endDate: string | null
}

export interface EmploymentDoc {
  type: 'paystubs' | 'w2' | 'final_paystub'
  jobId: string
  employer: string
  year: number | null
  /** What the borrower is asked for: "W-2 for 2025: Excel". */
  label: string
  instructions: string
  /** Why it's suggested: "Excel, Jun 2025 – now". */
  why: string
}

export interface HistoryCheck {
  type: 'short_history' | 'gap' | 'recent_start'
  /** Stable within the person: the gap's start date, the job id, or "history". */
  ref: string
  body: string
  why: string
}

const DAY = 86_400_000
const toTime = (iso: string) => Date.parse(`${iso}T12:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const yearOf = (iso: string) => Number(iso.slice(0, 4))
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const month = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
const day = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`

/** The first day of the lookback window: today less 24 months. */
export const windowStart = (today: string) => monthsBefore(today, R.lookbackMonths)

const endOf = (j: HistoryJob, today: string) => (j.current ? today : (j.endDate ?? null))
const span = (j: HistoryJob) => `${j.startDate ? month(j.startDate) : '?'} – ${j.current ? 'now' : j.endDate ? month(j.endDate) : '?'}`

/** The documents a borrower's W-2 jobs call for. Jobs without a start date (or a past job without an end date) are left to the general rules. */
export function employmentDocs(jobs: HistoryJob[], today: string): EmploymentDoc[] {
  const from = windowStart(today)
  const out: EmploymentDoc[] = []
  for (const j of jobs) {
    const employer = j.employerName.trim()
    if (j.selfEmployed || !employer || !j.startDate) continue
    const end = endOf(j, today)
    if (!end || end < from || j.startDate > today) continue
    const why = `${employer}, ${span(j)}`
    if (j.current) out.push({ type: 'paystubs', jobId: j.id, employer, year: null, label: `Pay stubs: ${employer}`, instructions: `Your most recent pay stubs covering the last ${R.paystubDays} days (usually ${R.paystubCount}).`, why })
    // A W-2 for each finished calendar year worked there inside the window (this year's isn't out yet).
    const first = Math.max(yearOf(j.startDate), yearOf(from))
    const last = Math.min(yearOf(end), yearOf(today) - 1)
    for (let y = first; y <= last; y++) out.push({ type: 'w2', jobId: j.id, employer, year: y, label: `W-2 for ${y}: ${employer}`, instructions: `Your ${y} W-2 from ${employer}.`, why })
    if (!j.current && R.finalPaystub) out.push({ type: 'final_paystub', jobId: j.id, employer, year: null, label: `Final pay stub: ${employer}`, instructions: `Your last pay stub from ${employer}, if you have it.`, why })
  }
  return out
}

/** Gaps, short history and recent starts, from every dated job (W-2 and self-employed). */
export function historyChecks(jobs: HistoryJob[], today: string): HistoryCheck[] {
  const dated = jobs.filter((j) => j.employerName.trim() && j.startDate && (j.current || j.endDate) && j.startDate <= today)
  // Nothing to check without dates, or while any job is missing one (the gaps would be guesses).
  if (dated.length === 0 || dated.length !== jobs.filter((j) => j.employerName.trim()).length) return []
  const from = windowStart(today)
  const out: HistoryCheck[] = []

  // Covered stretches inside the window, merged.
  const pieces = dated
    .map((j) => [Math.max(toTime(j.startDate!), toTime(from)), toTime(endOf(j, today)!)] as [number, number])
    .filter(([a, b]) => b >= a)
    .sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a, b] of pieces) {
    const last = merged.at(-1)
    if (last && a <= last[1] + DAY) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }

  const earliest = Math.min(...dated.map((j) => toTime(j.startDate!)))
  if (earliest > toTime(from) + R.gapDays * DAY) {
    const months = Math.max(0, Math.round((toTime(today) - earliest) / (30.44 * DAY)))
    out.push({ type: 'short_history', ref: 'history', body: 'Provide additional employment or education history to cover 2 years', why: `The jobs on the 1003 cover ${months} month${months === 1 ? '' : 's'} (since ${month(iso(earliest))})` })
  }

  // Breaks between covered stretches, and from the last job to today when no job is current.
  const breaks: [number, number][] = []
  for (let i = 1; i < merged.length; i++) breaks.push([merged[i - 1][1] + DAY, merged[i][0] - DAY])
  const lastEnd = merged.at(-1)?.[1]
  if (lastEnd != null && lastEnd < toTime(today)) breaks.push([lastEnd + DAY, toTime(today)])
  for (const [a, b] of breaks) {
    const days = Math.round((b - a) / DAY) + 1
    if (days <= R.gapDays) continue
    const open = b >= toTime(today)
    const range = `${day(iso(a))} – ${open ? 'now' : day(iso(b))}`
    out.push({ type: 'gap', ref: iso(a), body: `Letter of explanation for the employment gap ${range}`, why: `${days} days with no job on the 1003` })
  }

  const recent = toTime(monthsBefore(today, R.recentStartMonths))
  for (const j of dated.filter((x) => x.current && toTime(x.startDate!) > recent)) {
    out.push({ type: 'recent_start', ref: j.id, body: `Review the recent job change: started at ${j.employerName.trim()} on ${day(j.startDate!)} (probation, pay structure, same line of work)`, why: `Started less than ${R.recentStartMonths} months ago` })
  }
  return out
}

/** Today less N months, as YYYY-MM-DD. */
function monthsBefore(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number)
  const total = y * 12 + (m - 1) - months
  const yy = Math.floor(total / 12)
  const mm = (total % 12) + 1
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}
