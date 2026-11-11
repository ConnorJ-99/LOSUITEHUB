// The closed loan register (build plan Phase 5): one row per closed loan with
// its production date, comp worked out from its snapshot, and flags for what
// needs cleaning up. Operational only: Arive stays the loan record of record.
// Pure, tested.

import { lenderComp, planFor, type CompPlan } from '@/lib/calc/lenderComp'
import { loanComp, type CompSnapshot } from '@/lib/calc/loanComp'
import { loanRevenue } from '@/lib/calc/revenue'
import { productionDate } from './production'

export interface RegisterLoan {
  id: string
  closingDate: string | null
  fundingDate: string | null
  stageChangedAt: string
  borrower: string
  property: string | null
  loId: string | null
  loName: string | null
  lenderId: string | null
  lender: string | null
  programId: string | null
  program: string | null
  purpose: string
  occupancy: string | null
  loanAmount: number | null
  rate: number | null
  termMonths: number | null
  ariveLoanNumber: string | null
  leadSourceType: 'company' | 'self' | null
  revenueType: 'percent' | 'amount' | null
  revenueValue: number | null
  compPlanId: string | null
  snapshot: CompSnapshot | null
}

export interface RegisterRow extends RegisterLoan {
  productionDate: string | null
  gross: number | null
  loComp: number | null
  net: number | null
  /** The lender's plan figure, when a plan applies. */
  planFigure: number | null
  flags: string[]
}

export function registerRow(l: RegisterLoan, plans: CompPlan[]): RegisterRow {
  const revenue = loanRevenue(l.loanAmount, l.revenueType, l.revenueValue).amount
  const c = loanComp({ loanAmount: l.loanAmount, revenue }, l.snapshot)
  const day = l.closingDate ?? l.fundingDate ?? l.stageChangedAt.slice(0, 10)
  const plan = (l.compPlanId ? plans.find((p) => p.id === l.compPlanId) : null) ?? planFor(plans, { lenderId: l.lenderId, programId: l.programId, day })
  const planFigure = lenderComp(l.loanAmount, plan)
  const flags: string[] = []
  if (!l.fundingDate) flags.push('No funding date')
  if (revenue == null) flags.push('Needs revenue')
  // Typos and lender-paid vs borrower-paid mix-ups.
  else if (planFigure != null && Math.abs(revenue - planFigure) >= 1) flags.push(`Revenue differs from the plan (${planFigure.toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`)
  return { ...l, productionDate: productionDate(l), gross: c.gross, loComp: c.loComp, net: c.net, planFigure, flags }
}

export interface RegisterFilters {
  from: string | null
  to: string | null
  loId: string | null
  leadSource: 'company' | 'self' | null
}

/** By production date (funding, else closing), loan officer and lead source; newest first. */
export function filterRegister(rows: RegisterRow[], f: RegisterFilters): RegisterRow[] {
  return rows
    .filter((r) => (!f.from || (r.productionDate ?? '') >= f.from) && (!f.to || (r.productionDate ?? '9999') <= f.to) && (!f.loId || r.loId === f.loId) && (!f.leadSource || r.leadSourceType === f.leadSource))
    .sort((a, b) => (b.productionDate ?? '').localeCompare(a.productionDate ?? ''))
}

/** This month in YYYY-MM-DD, first and last day. */
export function thisMonth(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}` }
}

export interface RegisterTotals {
  count: number
  volume: number
  gross: number
  loComp: number
  net: number
  /** Rows whose revenue is missing (they add nothing to the money totals). */
  missingRevenue: number
}

export function registerTotals(rows: RegisterRow[]): RegisterTotals {
  const sum = (f: (r: RegisterRow) => number | null) => Math.round(rows.reduce((s, r) => s + (f(r) ?? 0), 0) * 100) / 100
  return { count: rows.length, volume: sum((r) => r.loanAmount), gross: sum((r) => r.gross), loComp: sum((r) => r.loComp), net: sum((r) => r.net), missingRevenue: rows.filter((r) => r.gross == null).length }
}

export const REGISTER_COLUMNS = ['Production date', 'Closing date', 'Funding date', 'Borrower', 'Property', 'Loan officer', 'Lender', 'Program', 'Purpose', 'Occupancy', 'Loan amount', 'Rate', 'Term (years)', 'Arive loan #', 'Lead source', 'Gross revenue', 'LO comp', 'Net', 'Flags'] as const

/** The rows on screen as CSV cells, in REGISTER_COLUMNS order. */
export function registerCells(r: RegisterRow, labels: { purpose: (p: string) => string; occupancy: (o: string | null) => string }): (string | number | null)[] {
  return [
    r.productionDate, r.closingDate, r.fundingDate, r.borrower, r.property, r.loName, r.lender, r.program, labels.purpose(r.purpose), labels.occupancy(r.occupancy),
    r.loanAmount, r.rate, r.termMonths ? r.termMonths / 12 : null, r.ariveLoanNumber, r.leadSourceType === 'company' ? 'Company' : r.leadSourceType === 'self' ? 'Self' : null,
    r.gross, r.loComp, r.net, r.flags.join('; ') || null,
  ]
}
