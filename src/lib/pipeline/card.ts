// What a pipeline card says (Pipeline redesign, Connor 2026-11-13), worked
// out from the file's existing facts and dates; nothing new is stored except
// the step (loans.current_step). Sorting, the quick filters and search are
// here too. Pure, tested.

import { formatCompactCurrency } from '@/lib/format'
import { leadTypeFor, type LeadTypeFacts, type LeadTypeId } from './leadType'
import { columnFor, pipelineFor, type PipelineColumn } from './pipelines'
import type { LoanPurpose, PipelineStage } from './stages'

export interface CardFile extends LeadTypeFacts {
  id: string
  purpose: LoanPurpose
  stage: PipelineStage
  stageChangedAt: string
  createdAt: string
  /** loans.current_step (1 when the script hasn't run). */
  currentStep: number
  priority: boolean
  onHoldAt: string | null
  occupancy: string | null
  loanAmount: number | null
  purchasePrice: number | null
  /** The subject property's estimated value. */
  homeValue: number | null
  /** The approved maximum price (pre-approved files). */
  maxPrice: number | null
  timeline: string | null
  contractDate: string | null
  closingDate: string | null
  preapprovalExpiresOn: string | null
}

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const short = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
const centralDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })
const dayOf = (ts: string) => centralDay.format(new Date(ts))

export const OCCUPANCY_LABEL: Record<string, string> = { primary: 'Primary', second_home: 'Second home', investment: 'Investment' }

/** Whole days since the file entered its stage. */
export function daysInStage(stageChangedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(stageChangedAt).getTime()) / DAY))
}

export interface StepInfo {
  n: number
  total: number
  name: string
}

/** "Step 2 of 3 · Discovery call" (null for a stage with no steps). */
export function stepInfo(f: Pick<CardFile, 'stage' | 'purpose' | 'currentStep'>, column?: PipelineColumn | null): StepInfo | null {
  const c = column ?? columnFor(f, pipelineFor(f))
  if (!c || c.steps.length === 0) return null
  const n = Math.min(Math.max(1, f.currentStep || 1), c.steps.length)
  return { n, total: c.steps.length, name: c.steps[n - 1] }
}

const LATE: PipelineStage[] = ['under_contract', 'processing', 'underwriting', 'clear_to_close', 'closed']
const APPROVED: PipelineStage[] = ['pre_approved', 'home_search']

/** "$380K · 95% LTV" once under contract, "Max $450K" when pre-approved, "$380K est." before. */
export function amountLine(f: CardFile): string | null {
  const amount = f.loanAmount ?? f.purchasePrice
  if (LATE.includes(f.stage) && f.loanAmount) {
    const value = f.purchasePrice && f.homeValue ? Math.min(f.purchasePrice, f.homeValue) : (f.purchasePrice ?? f.homeValue)
    return value ? `${formatCompactCurrency(f.loanAmount)} · ${Math.round((f.loanAmount / value) * 100)}% LTV` : formatCompactCurrency(f.loanAmount)
  }
  if (APPROVED.includes(f.stage) && f.maxPrice) return `Max ${formatCompactCurrency(f.maxPrice)}`
  return amount ? `${formatCompactCurrency(amount)} est.` : null
}

/** "Lead Oct 3 · target 1–3 months", "Approved Oct 20 · exp Jan 18", "Contract Oct 28 · close Nov 30". */
export function timelineLine(f: CardFile): string | null {
  if (LATE.includes(f.stage)) {
    const parts = [f.contractDate ? `Contract ${short(f.contractDate)}` : null, f.closingDate ? `close ${short(f.closingDate)}` : null].filter(Boolean)
    return parts.length ? parts.join(' · ') : null
  }
  if (APPROVED.includes(f.stage)) return [`Approved ${short(dayOf(f.stageChangedAt))}`, f.preapprovalExpiresOn ? `exp ${short(f.preapprovalExpiresOn)}` : null].filter(Boolean).join(' · ')
  return [`Lead ${short(dayOf(f.createdAt))}`, f.timeline ? `target ${f.timeline}` : null].filter(Boolean).join(' · ')
}

export const cardType = (f: CardFile): LeadTypeId => leadTypeFor(f)

/** Inside a column: priority first, then the longest in stage. */
export function sortCards<F extends Pick<CardFile, 'priority' | 'stageChangedAt'>>(files: F[]): F[] {
  return [...files].sort((a, b) => Number(b.priority) - Number(a.priority) || a.stageChangedAt.localeCompare(b.stageChangedAt))
}

// ---------------------------------------------------------------------------
// Quick filters and search
// ---------------------------------------------------------------------------

export const STUCK_DAYS = 14
export const EXPIRES_SOON_DAYS = 14

export type QuickFilter = 'stuck' | 'closing_month' | 'expiring'

export const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: 'stuck', label: `Stuck > ${STUCK_DAYS} days` },
  { id: 'closing_month', label: 'Closing this month' },
  { id: 'expiring', label: `Pre-approval expires in ${EXPIRES_SOON_DAYS} days` },
]

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY)

export function matchesQuick(f: CardFile, q: QuickFilter, now: Date, today: string): boolean {
  if (q === 'stuck') return daysInStage(f.stageChangedAt, now) > STUCK_DAYS
  if (q === 'closing_month') return !!f.closingDate && f.closingDate.slice(0, 7) === today.slice(0, 7)
  return !!f.preapprovalExpiresOn && daysBetween(today, f.preapprovalExpiresOn) >= 0 && daysBetween(today, f.preapprovalExpiresOn) <= EXPIRES_SOON_DAYS
}

/** Name, address or Arive loan number, ignoring case and spaces. */
export function matchesSearch(text: string, fields: (string | null | undefined)[]): boolean {
  const q = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return true
  return fields.some((v) => !!v && v.toLowerCase().replace(/\s+/g, ' ').includes(q))
}

/** Files closing in the same month as today (for the totals). */
export const closingThisMonth = (f: Pick<CardFile, 'closingDate'>, today: string) => !!f.closingDate && f.closingDate.slice(0, 7) === today.slice(0, 7)

/** A group of files' totals: active count, volume (loan amount, else price), closing this month, average days in stage. */
export function boardStats(files: CardFile[], now: Date, today: string): { count: number; volume: number; closingThisMonth: number; avgDays: number | null } {
  const volume = files.reduce((s, f) => s + (f.loanAmount ?? f.purchasePrice ?? 0), 0)
  const days = files.map((f) => daysInStage(f.stageChangedAt, now))
  return { count: files.length, volume, closingThisMonth: files.filter((f) => closingThisMonth(f, today)).length, avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null }
}
