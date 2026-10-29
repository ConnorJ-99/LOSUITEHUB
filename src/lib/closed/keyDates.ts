// Key dates for a closed client (follow-up plan Phase 2 reminders): the
// thank-you after closing, the first payment check-in, the homestead
// exemption reminder, insurance renewal, the home anniversary, birthdays and
// holidays. Worked out from the dates on the file each time; a date becomes a
// task only when the loan officer clicks "Add follow-up" (tasks.source_key
// keeps it from being added twice). Rate watch needs market rates and comes later.

export type KeyDateKind = 'thank_you' | 'first_payment' | 'homestead' | 'insurance' | 'anniversary' | 'birthday' | 'holiday'

export interface KeyDate {
  date: string
  kind: KeyDateKind
  label: string
  /** tasks.source_key for the follow-up made from this date. */
  sourceKey: string
}

export interface KeyDateFacts {
  closingDate: string | null
  firstPaymentDate: string | null
  birthday: string | null
  insuranceRenewalDate: string | null
  /** True when the exemption is already filed; the reminder is skipped. */
  homesteadFiled: boolean | null
  occupancy: string | null
}

const DAY = 86_400_000
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (isoDate: string, days: number) => iso(new Date(toDate(isoDate).getTime() + days * DAY))

/** The month/day in a given year; Feb 29 falls on Feb 28 in other years. */
function onYear(isoDate: string, year: number): string {
  const [, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, m - 1, d))
  return date.getUTCMonth() === m - 1 ? iso(date) : iso(new Date(Date.UTC(year, m, 0)))
}

/** The next time a yearly date comes around, on or after today. */
function nextYearly(isoDate: string, today: string): { date: string; years: number } {
  const year = Number(today.slice(0, 4))
  const thisYear = onYear(isoDate, year)
  const date = thisYear >= today ? thisYear : onYear(isoDate, year + 1)
  return { date, years: Number(date.slice(0, 4)) - Number(isoDate.slice(0, 4)) }
}

/** Thanksgiving: the fourth Thursday of November. */
function thanksgiving(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay()
  return iso(new Date(Date.UTC(year, 10, 1 + ((4 - first + 7) % 7) + 21)))
}

const HOLIDAYS: { key: string; label: string; on: (year: number) => string }[] = [
  { key: 'new_year', label: "New Year's Day", on: (y) => `${y}-01-01` },
  { key: 'independence_day', label: 'Fourth of July', on: (y) => `${y}-07-04` },
  { key: 'thanksgiving', label: 'Thanksgiving', on: thanksgiving },
  { key: 'christmas', label: 'Christmas', on: (y) => `${y}-12-25` },
]

/** The next date of each holiday, on or after today. */
export function upcomingHolidays(today: string): KeyDate[] {
  const year = Number(today.slice(0, 4))
  return HOLIDAYS.map((h) => {
    const date = h.on(year) >= today ? h.on(year) : h.on(year + 1)
    return { date, kind: 'holiday' as const, label: h.label, sourceKey: `followup:${h.key}:${date}` }
  })
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`

/**
 * Key dates from today through `days` ahead, soonest first. One-time dates
 * (thank-you, first payment, homestead) drop off once they pass.
 */
export function keyDates(facts: KeyDateFacts, today: string, days: number, options: { holidays?: boolean } = {}): KeyDate[] {
  const until = addDays(today, days)
  const out: KeyDate[] = []
  const add = (date: string, kind: KeyDateKind, label: string) => {
    if (date >= today && date <= until) out.push({ date, kind, label, sourceKey: `followup:${kind}:${date}` })
  }

  if (facts.closingDate) {
    add(addDays(facts.closingDate, 3), 'thank_you', 'Thank-you and review request')
    const anniversary = nextYearly(facts.closingDate, today)
    if (anniversary.years > 0) add(anniversary.date, 'anniversary', `${ordinal(anniversary.years)} home anniversary`)
    // Texas homestead exemptions are filed from January 1 of the year after closing.
    if (facts.homesteadFiled !== true && (facts.occupancy ?? 'primary') === 'primary') {
      add(`${Number(facts.closingDate.slice(0, 4)) + 1}-01-02`, 'homestead', 'Homestead exemption reminder')
    }
  }
  if (facts.firstPaymentDate) add(addDays(facts.firstPaymentDate, -7), 'first_payment', 'First payment check-in')
  if (facts.insuranceRenewalDate) {
    // The reminder is 30 days ahead of the next renewal that hasn't had one yet.
    const renewal = nextYearly(facts.insuranceRenewalDate, addDays(today, 30))
    add(addDays(renewal.date, -30), 'insurance', 'Insurance renews in 30 days: rate review')
  }
  if (facts.birthday) add(nextYearly(facts.birthday, today).date, 'birthday', 'Birthday')
  if (options.holidays) for (const h of upcomingHolidays(today)) if (h.date <= until) out.push(h)

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
}
