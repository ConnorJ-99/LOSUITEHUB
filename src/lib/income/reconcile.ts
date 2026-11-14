// Catching documents that disagree (Stage 4d-3): for one W-2 job, its pay
// stubs and W-2s are compared and each problem is a warning with the numbers
// in it. Warnings never block Accept; they're what an underwriter will ask
// about. Pure, tested.

import { PERIODS_PER_YEAR } from '@/lib/calc/income/wages'
import { employerKey } from '../../../supabase/functions/assistant/documentRead'
import { monthsThrough, type IncomeDoc } from './fromDocuments'

/** Connor's thresholds, in one place. */
export const RECONCILE = {
  /** This year's pace more than this far below the latest W-2 box 1. */
  paceBelowW2Pct: 5,
  /** The stated base, annualized, this far or more above the latest W-2 (a raise or new rate). */
  baseAboveW2Pct: 20,
  /** A pay stub older than this many days on the day of the calculation. */
  stubMaxAgeDays: 30,
  /** W-2 box 1 more than this far below box 5 (pre-tax deductions explain small gaps). */
  box1BelowBox5Pct: 10,
} as const

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const DAY = 86_400_000
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY)
const sameEmployer = (a: string, b: string) => {
  const x = employerKey(a)
  const y = employerKey(b)
  return !x || !y || x === y || x.includes(y) || y.includes(x)
}

export function reconcileJob(input: { docs: IncomeDoc[]; job: { employerName: string; startDate: string | null }; today: string }): string[] {
  const { docs, job, today } = input
  const payDate = (d: IncomeDoc) => str(d.fields.pay_date?.value) ?? str(d.fields.pay_period_end?.value)
  const stubs = docs.filter((d) => d.kind === 'paystub' && payDate(d)).sort((a, b) => payDate(b)!.localeCompare(payDate(a)!))
  const w2s = docs.filter((d) => d.kind === 'w2' && num(d.fields.tax_year?.value)).sort((a, b) => num(b.fields.tax_year?.value)! - num(a.fields.tax_year?.value)!)
  const out: string[] = []
  const stub = stubs[0]
  const w2 = w2s[0]
  const w2Wages = w2 ? num(w2.fields.w2_wages?.value) : null
  const w2Year = w2 ? num(w2.fields.tax_year?.value) : null

  if (stub) {
    const paid = payDate(stub)!
    const f = stub.fields
    // Pace vs the latest W-2.
    const ytdGross = num(f.ytd_gross?.value)
    const months = monthsThrough(paid)
    if (w2Wages && ytdGross != null && months > 0) {
      const pace = (ytdGross / months) * 12
      const below = ((w2Wages - pace) / w2Wages) * 100
      if (below > RECONCILE.paceBelowW2Pct) out.push(`This year's pace ${money(pace)} (YTD ${money(ytdGross)} over ${months} months) is ${Math.round(below)}% below the ${w2Year} W-2 ${money(w2Wages)}: income may be falling; the underwriter will ask why.`)
    }
    // Stated base vs the latest W-2: a raise or a new rate.
    const frequency = str(f.pay_frequency?.value) as keyof typeof PERIODS_PER_YEAR | null
    const perPeriod = num(f.base_pay_current?.value) ?? (num(f.hourly_rate?.value) != null && num(f.hours_current?.value) != null ? num(f.hourly_rate?.value)! * num(f.hours_current?.value)! : null)
    if (w2Wages && perPeriod != null && frequency && PERIODS_PER_YEAR[frequency]) {
      const annual = perPeriod * PERIODS_PER_YEAR[frequency]
      const above = ((annual - w2Wages) / w2Wages) * 100
      if (above >= RECONCILE.baseAboveW2Pct) out.push(`The stated base, ${money(annual)} a year, is ${Math.round(above)}% above the ${w2Year} W-2 ${money(w2Wages)}: likely a raise or a new pay rate. Get a WVOE or the offer letter.`)
    }
    // The stub's employer vs the W-2's.
    const stubEmployer = str(f.employer_name?.value)
    const w2Employer = w2 ? str(w2.fields.employer_name?.value) : null
    if (stubEmployer && w2Employer && !sameEmployer(stubEmployer, w2Employer)) out.push(`The pay stub's employer (${stubEmployer}) doesn't match the W-2's (${w2Employer}).`)
    // An old stub.
    const age = days(paid, today)
    if (age > RECONCILE.stubMaxAgeDays) out.push(`The latest pay stub is ${age} days old (paid ${paid}): get one from the last ${RECONCILE.stubMaxAgeDays} days.`)
  }

  // A W-2 year missing: the job started before last year but only one W-2 is analyzed.
  const lastYear = Number(today.slice(0, 4)) - 1
  if (job.startDate && job.startDate < `${lastYear}-01-01` && w2s.length === 1) out.push(`${job.employerName} started before ${lastYear}, but only the ${w2Year} W-2 has been analyzed: add the other year's W-2.`)

  // W-2 box 1 well below box 5.
  for (const d of w2s) {
    const box1 = num(d.fields.w2_wages?.value)
    const box5 = num(d.fields.w2_medicare_wages?.value)
    if (box1 != null && box5 && ((box5 - box1) / box5) * 100 > RECONCILE.box1BelowBox5Pct) {
      out.push(`${num(d.fields.tax_year?.value)} W-2 box 1 ${money(box1)} is ${Math.round(((box5 - box1) / box5) * 100)}% below box 5 ${money(box5)}: large pre-tax deductions; look before using box 1.`)
    }
  }
  return out
}
