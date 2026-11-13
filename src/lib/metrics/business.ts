// Business metrics for owners and admins (Connor, 2026-11-13): leads,
// active clients, closed loans, volume, conversion and revenue for a period,
// by loan officer and by month. Worked out from the files every time; nothing
// is stored. Closed loans use the register's rows (production date = funding,
// else closing), so the money matches the Closed loan register. Pure, tested.

import type { RegisterRow } from '@/lib/closed/register'

/** One file, for counting leads and active clients. */
export interface PipelineLoan {
  id: string
  /** When the file was made (a timestamp). */
  createdAt: string
  stage: string
  /** Made by a bulk import (old closed clients), not a lead that came in. */
  imported: boolean
  loId: string | null
  leadSource: 'company' | 'self' | null
  /** The primary borrower (a person counts once). */
  contactId: string | null
}

export interface MetricsFilters {
  /** YYYY-MM-DD, inclusive. */
  from: string
  to: string
  loId: string | null
  leadSource: 'company' | 'self' | null
}

/** Working toward a loan: Pre-Qualified through Approved / Clear to Close. */
export const ACTIVE_STAGES = ['pre_qualified', 'pre_approved', 'home_search', 'under_contract', 'processing', 'clear_to_close'] as const

export interface BusinessMetrics {
  /** Unique people with a new file made in the period (imports left out). */
  newLeads: number
  /** Unique people on a file in an active stage today (not by period). */
  activeClients: number
  /** Closed loans with a production date in the period. */
  closedLoans: number
  fundedVolume: number
  averageLoan: number | null
  /** Of the period's new leads (people), the share with a file now closed (null with no leads). */
  conversionPct: number | null
  /** How many of the period's new leads have a file now closed. */
  convertedLeads: number
  grossRevenue: number
  loComp: number
  /** Gross revenue less LO comp (direct costs aren't tracked yet). */
  companyRevenue: number
  /** Closed loans with no revenue entered (they add nothing to the money). */
  missingRevenue: number
}

const cents = (n: number) => Math.round(n * 100) / 100
const centralDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
/** The day a file was made, in Central time. */
export const createdDay = (createdAt: string) => centralDate.format(new Date(createdAt))

const fits = (f: Pick<MetricsFilters, 'loId' | 'leadSource'>, x: { loId: string | null; leadSource?: 'company' | 'self' | null; leadSourceType?: 'company' | 'self' | null }) =>
  (!f.loId || x.loId === f.loId) && (!f.leadSource || (x.leadSource ?? x.leadSourceType) === f.leadSource)

export function businessMetrics(files: PipelineLoan[], closed: RegisterRow[], f: MetricsFilters): BusinessMetrics {
  const mine = files.filter((l) => fits(f, l))
  const leads = mine.filter((l) => !l.imported && createdDay(l.createdAt) >= f.from && createdDay(l.createdAt) <= f.to)
  const people = (xs: PipelineLoan[]) => new Set(xs.map((l) => l.contactId ?? l.id)).size
  const active = mine.filter((l) => (ACTIVE_STAGES as readonly string[]).includes(l.stage))
  const funded = closed.filter((r) => fits(f, r) && r.productionDate != null && r.productionDate >= f.from && r.productionDate <= f.to)
  const sum = (g: (r: RegisterRow) => number | null) => cents(funded.reduce((s, r) => s + (g(r) ?? 0), 0))
  const volume = sum((r) => r.loanAmount)
  const gross = sum((r) => r.gross)
  const loComp = sum((r) => r.loComp)
  // By person, like new leads: someone with any of the period's files closed.
  const converted = people(leads.filter((l) => l.stage === 'closed'))
  const leadPeople = people(leads)
  return {
    newLeads: leadPeople,
    activeClients: people(active),
    closedLoans: funded.length,
    fundedVolume: volume,
    averageLoan: funded.length ? cents(volume / funded.length) : null,
    conversionPct: leadPeople ? Math.round((converted / leadPeople) * 1000) / 10 : null,
    convertedLeads: converted,
    grossRevenue: gross,
    loComp,
    companyRevenue: cents(gross - loComp),
    missingRevenue: funded.filter((r) => r.gross == null).length,
  }
}

/** The same metrics for each loan officer who has a lead, an active client or a closed loan (busiest first). */
export function metricsByLo(files: PipelineLoan[], closed: RegisterRow[], f: MetricsFilters, names: Map<string, string>): { loId: string | null; name: string; m: BusinessMetrics }[] {
  const ids = new Set<string | null>([...files.map((l) => l.loId), ...closed.map((r) => r.loId)])
  return [...ids]
    .map((loId) => ({ loId, name: loId ? (names.get(loId) ?? 'Unknown') : 'Unassigned', m: businessMetrics(files.filter((l) => l.loId === loId), closed.filter((r) => r.loId === loId), { ...f, loId: null }) }))
    .filter((x) => x.m.newLeads || x.m.closedLoans || x.m.activeClients)
    .sort((a, b) => b.m.fundedVolume - a.m.fundedVolume || b.m.newLeads - a.m.newLeads || a.name.localeCompare(b.name))
}

/** The last `count` calendar months ending with `today`'s, oldest first, as from/to. */
export function lastMonths(today: string, count: number): { label: string; from: string; to: string }[] {
  const [y, m] = today.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1))
    const yy = d.getUTCFullYear()
    const mm = d.getUTCMonth() + 1
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
    const ym = `${yy}-${String(mm).padStart(2, '0')}`
    return { label: d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` }
  })
}

export type PeriodId = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'last_12' | 'custom'

export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_12', label: 'Last 12 months' },
  { id: 'custom', label: 'Custom' },
]

/** A period's first and last day (custom keeps what was typed). */
export function periodRange(id: Exclude<PeriodId, 'custom'>, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number)
  const months = lastMonths(today, 12)
  if (id === 'this_month') return { from: months[11].from, to: months[11].to }
  if (id === 'last_month') return { from: months[10].from, to: months[10].to }
  if (id === 'last_12') return { from: months[0].from, to: months[11].to }
  if (id === 'ytd') return { from: `${y}-01-01`, to: today }
  const q = Math.floor((m - 1) / 3) * 3 + 1
  const end = new Date(Date.UTC(y, q + 2, 0))
  return { from: `${y}-${String(q).padStart(2, '0')}-01`, to: end.toISOString().slice(0, 10) }
}
