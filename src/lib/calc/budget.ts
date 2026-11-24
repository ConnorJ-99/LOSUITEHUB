// The income, expenses & savings planner (nurture goals Phase 3, Connor's
// spec 2026-11-24): when each income or bill comes, what the next 7 / 30 / 90
// days look like, a month's summary, and how long a savings goal takes at a
// monthly amount. Pure; money in cents through round(), dates as YYYY-MM-DD.
//
// Projected (from the schedule) and confirmed (what the borrower said they
// actually received or paid) are kept apart. A confirmed entry tied to a
// scheduled date replaces that date's projected one, so nothing counts twice.
// Projected money is never counted as saved: "cash now" is the starting cash
// plus confirmed entries only.
import { round } from './round'

export type BudgetKind = 'income' | 'expense'
export type BudgetSchedule = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual' | 'every_n_days' | 'one_time' | 'irregular'

export const BUDGET_SCHEDULES: { value: BudgetSchedule; label: string }[] = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every two weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Every month' },
  { value: 'annual', label: 'Once a year' },
  { value: 'every_n_days', label: 'Every few days…' },
  { value: 'one_time', label: 'Just once' },
  { value: 'irregular', label: 'It varies (about this much a month)' },
]

export interface BudgetItem {
  id: string
  kind: BudgetKind
  name: string
  amount: number
  schedule: BudgetSchedule
  /** For every_n_days. */
  everyDays: number | null
  /** The next date it comes (none for irregular). */
  nextOn: string | null
  category: string | null
  paused: boolean
}

export interface BudgetEntry {
  id: string
  /** The item it belongs to; null = something unplanned. */
  itemId: string | null
  kind: BudgetKind
  name: string
  amount: number
  on: string
  /** The scheduled date it stands in for (null = extra, on top of the plan). */
  plannedOn: string | null
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const toDate = (iso: string) => new Date(`${iso}T12:00:00Z`)
const toIso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (iso: string, n: number) => {
  const d = toDate(iso)
  d.setUTCDate(d.getUTCDate() + n)
  return toIso(d)
}
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
/** The same day `n` months later, or that month's last day (Jan 31 → Feb 28). */
const onDay = (y: number, m0: number, day: number) => {
  const yy = y + Math.floor(m0 / 12)
  const mm = ((m0 % 12) + 12) % 12
  return toIso(new Date(Date.UTC(yy, mm, Math.min(day, daysIn(yy, mm)), 12)))
}
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000)

/** Every date an item comes from `from` to `to` (both included). Paused and irregular items have none. */
export function occurrences(item: Pick<BudgetItem, 'schedule' | 'everyDays' | 'nextOn' | 'paused'>, from: string, to: string): string[] {
  if (item.paused || !item.nextOn || item.schedule === 'irregular' || to < from) return []
  const start = item.nextOn
  const out: string[] = []
  const keep = (d: string) => d >= from && d <= to && d >= start && out.push(d)
  if (item.schedule === 'one_time') {
    keep(start)
    return out
  }
  const step = item.schedule === 'weekly' ? 7 : item.schedule === 'biweekly' ? 14 : item.schedule === 'every_n_days' ? Math.max(1, Math.min(366, item.everyDays ?? 0)) : 0
  if (step) {
    // Jump close to `from` without walking every date.
    let d = start < from ? addDays(start, Math.floor(daysBetween(start, from) / step) * step) : start
    for (let i = 0; d <= to && i < 5000; i++, d = addDays(d, step)) keep(d)
    return out
  }
  const s = toDate(start)
  const y = s.getUTCFullYear()
  const m0 = s.getUTCMonth()
  const day = s.getUTCDate()
  const months = item.schedule === 'annual' ? 12 : 1
  // The second date of a twice-a-month item: 15 days from the first (the 1st and 15th, the 15th and 30th…).
  const day2 = day <= 15 ? day + 15 : day - 15
  for (let i = 0; i < 2400; i += months) {
    const d = onDay(y, m0 + i, day)
    if (d > to) break
    keep(d)
    if (item.schedule === 'semimonthly') {
      const d2 = onDay(y, m0 + i, day2)
      if (d2 <= to) keep(d2)
    }
  }
  return out.sort()
}

/** About how much an item comes to in an average month (paused and one-time items: 0; irregular: its amount). */
export function monthlyEquivalent(item: Pick<BudgetItem, 'schedule' | 'everyDays' | 'amount' | 'paused'>): number {
  if (item.paused) return 0
  const a = item.amount
  switch (item.schedule) {
    case 'weekly':
      return round((a * 52) / 12)
    case 'biweekly':
      return round((a * 26) / 12)
    case 'semimonthly':
      return round(a * 2)
    case 'monthly':
    case 'irregular':
      return round(a)
    case 'annual':
      return round(a / 12)
    case 'every_n_days':
      return item.everyDays ? round((a * 365.25) / item.everyDays / 12) : 0
    default:
      return 0
  }
}

/** Income less expenses in an average month (what's left to save). */
export function monthlyNet(items: BudgetItem[]): { income: number; expenses: number; net: number } {
  const sum = (k: BudgetKind) => round(items.filter((i) => i.kind === k).reduce((s, i) => s + monthlyEquivalent(i), 0))
  const income = sum('income')
  const expenses = sum('expense')
  return { income, expenses, net: round(income - expenses) }
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export interface ForecastLine {
  on: string
  itemId: string | null
  kind: BudgetKind
  name: string
  amount: number
  /** projected = from the schedule; estimate = an "it varies" item spread over the window. */
  status: 'projected' | 'estimate'
}

export interface Forecast {
  from: string
  to: string
  /** Starting cash plus confirmed entries since it (null without a starting balance). Never includes projections. */
  cashNow: number | null
  income: number
  expenses: number
  net: number
  /** cashNow + net: what they'd have if everything goes as planned (null without a starting balance). */
  endCash: number | null
  /** The lowest the balance gets along the way, and when (null without a starting balance). */
  low: { amount: number; on: string } | null
  lines: ForecastLine[]
}

const signed = (kind: BudgetKind, amount: number) => (kind === 'income' ? amount : -amount)

/** Cash now: the starting balance plus every confirmed entry on or after its date. Projected money never counts. */
export function cashNow(startingCash: number | null, startingOn: string | null, entries: BudgetEntry[], today: string): number | null {
  if (startingCash == null) return null
  const counted = entries.filter((e) => (!startingOn || e.on >= startingOn) && e.on <= today)
  return round(startingCash + counted.reduce((s, e) => s + signed(e.kind, e.amount), 0))
}

/** The next `days` days from today: each scheduled income and bill not already confirmed, and the running balance. */
export function forecast(input: { items: BudgetItem[]; entries: BudgetEntry[]; startingCash: number | null; startingOn: string | null; today: string; days: number }): Forecast {
  const { items, entries, today, days } = input
  const to = addDays(today, days - 1)
  const confirmed = new Set(entries.filter((e) => e.itemId && e.plannedOn).map((e) => `${e.itemId}:${e.plannedOn}`))
  const lines: ForecastLine[] = []
  for (const item of items) {
    if (item.schedule === 'irregular') {
      if (!item.paused && item.amount > 0) lines.push({ on: to, itemId: item.id, kind: item.kind, name: item.name, amount: round((item.amount * days) / 30.4375), status: 'estimate' })
      continue
    }
    for (const on of occurrences(item, today, to)) if (!confirmed.has(`${item.id}:${on}`)) lines.push({ on, itemId: item.id, kind: item.kind, name: item.name, amount: round(item.amount), status: 'projected' })
  }
  // Income first on a day, so a paycheck and a bill on the same day don't dip the balance.
  lines.sort((a, b) => a.on.localeCompare(b.on) || (a.kind === b.kind ? 0 : a.kind === 'income' ? -1 : 1) || a.name.localeCompare(b.name))
  const income = round(lines.filter((l) => l.kind === 'income').reduce((s, l) => s + l.amount, 0))
  const expenses = round(lines.filter((l) => l.kind === 'expense').reduce((s, l) => s + l.amount, 0))
  const now = cashNow(input.startingCash, input.startingOn, entries, today)
  let low: Forecast['low'] = null
  if (now != null) {
    let bal = now
    low = { amount: now, on: today }
    for (const l of lines) {
      bal = round(bal + signed(l.kind, l.amount))
      if (bal < low.amount) low = { amount: bal, on: l.on }
    }
  }
  return { from: today, to, cashNow: now, income, expenses, net: round(income - expenses), endCash: now == null ? null : round(now + income - expenses), low, lines }
}

// ---------------------------------------------------------------------------
// A month
// ---------------------------------------------------------------------------

export interface MonthSummary {
  month: string
  /** Everything the schedule says for the month ("it varies" items at their monthly amount). */
  projectedIncome: number
  projectedExpenses: number
  /** What they confirmed in the month. */
  confirmedIncome: number
  confirmedExpenses: number
  /** Confirmed plus what's still projected (each scheduled date once). */
  expectedIncome: number
  expectedExpenses: number
  expectedNet: number
}

/** A month ("2026-12"): projected, confirmed, and the two together without counting anything twice. */
export function monthSummary(items: BudgetItem[], entries: BudgetEntry[], month: string): MonthSummary {
  const first = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const last = onDay(y, m - 1, 31)
  const inMonth = entries.filter((e) => e.on >= first && e.on <= last)
  const confirmed = new Set(entries.filter((e) => e.itemId && e.plannedOn).map((e) => `${e.itemId}:${e.plannedOn}`))
  const sums = { projected: { income: 0, expense: 0 }, remaining: { income: 0, expense: 0 }, confirmed: { income: 0, expense: 0 } }
  for (const item of items) {
    if (item.schedule === 'irregular') {
      const a = monthlyEquivalent(item)
      sums.projected[item.kind] += a
      // An "it varies" item is still expected unless something was confirmed for it this month.
      if (!inMonth.some((e) => e.itemId === item.id)) sums.remaining[item.kind] += a
      continue
    }
    for (const on of occurrences(item, first, last)) {
      sums.projected[item.kind] += item.amount
      if (!confirmed.has(`${item.id}:${on}`)) sums.remaining[item.kind] += item.amount
    }
  }
  for (const e of inMonth) sums.confirmed[e.kind] += e.amount
  const expectedIncome = round(sums.confirmed.income + sums.remaining.income)
  const expectedExpenses = round(sums.confirmed.expense + sums.remaining.expense)
  return {
    month,
    projectedIncome: round(sums.projected.income),
    projectedExpenses: round(sums.projected.expense),
    confirmedIncome: round(sums.confirmed.income),
    confirmedExpenses: round(sums.confirmed.expense),
    expectedIncome,
    expectedExpenses,
    expectedNet: round(expectedIncome - expectedExpenses),
  }
}

/** Scheduled dates that have come and gone without being confirmed (the borrower can say what really happened). */
export function toConfirm(items: BudgetItem[], entries: BudgetEntry[], today: string, lookBackDays = 31): { itemId: string; on: string; kind: BudgetKind; name: string; amount: number }[] {
  const confirmed = new Set(entries.filter((e) => e.itemId && e.plannedOn).map((e) => `${e.itemId}:${e.plannedOn}`))
  const from = addDays(today, -lookBackDays)
  return items
    .flatMap((i) => occurrences(i, from, today).filter((on) => !confirmed.has(`${i.id}:${on}`)).map((on) => ({ itemId: i.id, on, kind: i.kind, name: i.name, amount: round(i.amount) })))
    .sort((a, b) => b.on.localeCompare(a.on))
}

// ---------------------------------------------------------------------------
// Savings plan
// ---------------------------------------------------------------------------

/** How long `remaining` takes at `perMonth` ("about 6 months at $650 a month"); null when it can't be reached that way. */
export function savingsPlan(remaining: number, perMonth: number): { months: number; line: string } | null {
  if (remaining <= 0) return { months: 0, line: "You've reached it." }
  if (!(perMonth > 0)) return null
  const months = Math.ceil(round(remaining / perMonth, 4))
  const money = `$${Math.round(perMonth).toLocaleString('en-US')}`
  return { months, line: `About ${months} month${months === 1 ? '' : 's'} at ${money} a month.` }
}
