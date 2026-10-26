// The readiness result: where a file stands after the prequal, and why.
// Connor's rules (approved 2026-10-26). Pure function; the Prequal tab and
// the Overview show what it returns. Nothing here is AI.

import type { IncomeDocType } from '@/lib/api/types'
import { MIN_CREDIT_SCORE, type MortgageTypeKind } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'

export type { IncomeDocType }
export type CreditEventType = 'bankruptcy_ch7' | 'bankruptcy_ch13' | 'foreclosure' | 'short_sale' | 'deed_in_lieu' | 'late_payment' | 'collection'

/** Worst first. */
export type ReadinessLevel = 'not_ready' | 'manual_review' | 'needs_documents' | 'ready'
export type NurtureReason = 'credit' | 'down_payment' | 'dti' | 'must_sell'

/** Under this estimated score, the file goes to Nurture. */
export const NURTURE_SCORE = 580
/** Over this DTI, even Non-QM usually says no. */
export const NON_QM_MAX_DTI = 55
export const SELF_EMPLOYED_MONTHS = 24
export const MORTGAGE_LATE_MONTHS = 12

/** Agency waiting periods in years after discharge or completion. */
export const WAITING_YEARS: Record<'bankruptcy_ch7' | 'bankruptcy_ch13' | 'foreclosure' | 'short_sale' | 'deed_in_lieu', Record<MortgageTypeKind, number>> = {
  bankruptcy_ch7: { conventional: 4, fha: 2, va: 2, usda_rural: 3, other: 4 },
  bankruptcy_ch13: { conventional: 2, fha: 1, va: 1, usda_rural: 1, other: 2 },
  foreclosure: { conventional: 7, fha: 3, va: 2, usda_rural: 3, other: 7 },
  short_sale: { conventional: 4, fha: 3, va: 2, usda_rural: 3, other: 4 },
  deed_in_lieu: { conventional: 4, fha: 3, va: 2, usda_rural: 3, other: 4 },
}

export const EVENT_LABEL: Record<CreditEventType, string> = {
  bankruptcy_ch7: 'Chapter 7 bankruptcy',
  bankruptcy_ch13: 'Chapter 13 bankruptcy',
  foreclosure: 'Foreclosure',
  short_sale: 'Short sale',
  deed_in_lieu: 'Deed in lieu',
  late_payment: 'Late payment',
  collection: 'Collection',
}

export const DOC_TYPE_LABEL: Record<IncomeDocType, string> = {
  full_doc: 'Full documentation',
  bank_statement: 'Bank statements',
  form_1099: '1099 only',
  asset_based: 'Asset-based',
  dscr: 'DSCR (rental income)',
}

const NON_QM_PHRASE: Record<Exclude<IncomeDocType, 'full_doc'>, string> = {
  bank_statement: 'Bank-statement income',
  form_1099: '1099-only income',
  asset_based: 'Asset-based income',
  dscr: 'Qualifying on rental income (DSCR)',
}

const TYPE_LABEL: Record<MortgageTypeKind, string> = { conventional: 'conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA', other: 'this loan type' }

export interface ReadinessJob {
  employerName: string
  borrowerName: string
  selfEmployed: boolean
  startDate: string | null
  /** Has income on the 1003 (a job with no income isn't counted). */
  hasIncome: boolean
  /** An income worksheet is tied to this job. */
  hasWorksheet: boolean
}

export interface ReadinessCreditEvent {
  type: CreditEventType
  date: string | null
  daysLate: number | null
  isMortgage: boolean
  borrowerName: string
}

export interface ReadinessInput {
  today: string
  isPurchase: boolean
  mortgageType: MortgageTypeKind | null
  incomeDocType: IncomeDocType | null
  /** The qualifying (lowest) estimated score. */
  creditScore: number | null
  backDtiPct: number | null
  maxDtiPct: number
  totalIncome: number
  /** The prequal's down payment check failed (LTV over the loan type's max). */
  ltvTooHigh: boolean
  cashNeeded: number | null
  /** All funds counted, including money from selling a home. */
  funds: number | null
  saleProceeds: number
  jobs: ReadinessJob[]
  creditEvents: ReadinessCreditEvent[]
  creditPulled: boolean
  hasAssets: boolean
  /** Documents asked for and not received yet, e.g. "pay stubs (Dana)". */
  outstandingDocs?: string[]
}

/** What's missing, for picking the next step (needs-documents reasons only). */
export type MissingCode = 'score' | 'income' | 'start_date' | 'event_date' | 'credit' | 'income_docs' | 'assets' | 'documents'

export interface ReadinessReason {
  level: Exclude<ReadinessLevel, 'ready'>
  text: string
  nurture?: NurtureReason
  missing?: MissingCode
}

export interface Readiness {
  level: ReadinessLevel
  /** Every reason found, worst first. */
  reasons: ReadinessReason[]
  /** Why it would go to Nurture (when not ready). */
  nurture: NurtureReason[]
}

export const LEVEL_LABEL: Record<ReadinessLevel, string> = {
  not_ready: 'Not ready yet',
  manual_review: 'Needs manual review (likely Non-QM)',
  needs_documents: 'Needs documents',
  ready: 'Ready to pre-approve',
}

export const NURTURE_LABEL: Record<NurtureReason, string> = {
  credit: 'Credit',
  down_payment: 'Down payment',
  dti: 'DTI',
  must_sell: 'Must sell first',
}

/** Whole months from one date to a later one. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0)
}

const monthYear = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const span = (months: number) => {
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(' ') || 'under a month'
}
const pct = (v: number) => formatPercent(v, 2)
/** Estimates read better in whole dollars. */
const about = (v: number) => formatCurrency(Math.round(v))
const LEVEL_ORDER: ReadinessLevel[] = ['not_ready', 'manual_review', 'needs_documents', 'ready']

/** The readiness result with every reason. */
export function readiness(i: ReadinessInput): Readiness {
  const reasons: ReadinessReason[] = []
  const add = (level: ReadinessReason['level'], text: string, nurture?: NurtureReason) => reasons.push({ level, text, ...(nurture ? { nurture } : {}) })
  const need = (missing: MissingCode, text: string) => reasons.push({ level: 'needs_documents', text, missing })
  const type = i.mortgageType ?? 'conventional'

  // Not ready → Nurture
  if (i.creditScore !== null && i.creditScore < NURTURE_SCORE) add('not_ready', `Estimated score ${i.creditScore} is under ${NURTURE_SCORE}.`, 'credit')
  if (i.isPurchase && i.ltvTooHigh) add('not_ready', `Down payment is under the ${TYPE_LABEL[type]} minimum.`, 'down_payment')
  if (i.isPurchase && i.cashNeeded !== null && i.funds !== null) {
    if (i.funds < i.cashNeeded) add('not_ready', `Short about ${about(i.cashNeeded - i.funds)} to close (needs about ${about(i.cashNeeded)}).`, 'down_payment')
    else if (i.saleProceeds > 0 && i.funds - i.saleProceeds < i.cashNeeded) add('not_ready', `Needs about ${about(i.cashNeeded - (i.funds - i.saleProceeds))} from selling their home to close.`, 'must_sell')
  }
  if (i.backDtiPct !== null && i.backDtiPct > NON_QM_MAX_DTI) add('not_ready', `DTI ${pct(i.backDtiPct)} is over ${NON_QM_MAX_DTI}%, past even Non-QM's usual limit.`, 'dti')

  // Manual review (likely Non-QM)
  const minScore = MIN_CREDIT_SCORE[type]
  if (i.creditScore !== null && i.creditScore >= NURTURE_SCORE && minScore !== null && i.creditScore < minScore) {
    add('manual_review', `Score ${i.creditScore} is under the usual ${minScore} ${TYPE_LABEL[type]} minimum; look at FHA or Non-QM.`)
  }
  if (i.backDtiPct !== null && i.backDtiPct > i.maxDtiPct && i.backDtiPct <= NON_QM_MAX_DTI) {
    add('manual_review', `DTI ${pct(i.backDtiPct)} is over the ${i.maxDtiPct}% ${TYPE_LABEL[type]} max; Non-QM may allow up to ${NON_QM_MAX_DTI}%.`)
  }
  if (i.incomeDocType && i.incomeDocType !== 'full_doc') add('manual_review', `${NON_QM_PHRASE[i.incomeDocType]} is a Non-QM program.`)
  for (const j of i.jobs.filter((x) => x.selfEmployed && x.hasIncome && x.startDate)) {
    const months = monthsBetween(j.startDate!, i.today)
    if (months < SELF_EMPLOYED_MONTHS) add('manual_review', `${j.borrowerName} has been self-employed ${span(months)} at ${j.employerName}; agency loans want 2 years.`)
  }
  for (const e of i.creditEvents) {
    if (!e.date) continue
    if (e.type === 'late_payment') {
      if (e.isMortgage && monthsBetween(e.date, i.today) < MORTGAGE_LATE_MONTHS) add('manual_review', `${e.daysLate}-day late mortgage payment in ${monthYear(e.date)} (${e.borrowerName}), within 12 months.`)
      continue
    }
    if (e.type === 'collection') continue
    const years = WAITING_YEARS[e.type][type]
    if (monthsBetween(e.date, i.today) < years * 12) {
      add('manual_review', `${EVENT_LABEL[e.type]} in ${monthYear(e.date)} (${e.borrowerName}): ${TYPE_LABEL[type]} waits ${years} year${years === 1 ? '' : 's'}.`)
    }
  }

  // Needs documents (or information)
  if (i.creditScore === null) need('score', 'Ask for an estimated credit score.')
  if (i.totalIncome <= 0) need('income', 'No income entered yet.')
  for (const j of i.jobs.filter((x) => x.selfEmployed && x.hasIncome && !x.startDate)) need('start_date', `When did ${j.borrowerName} start self-employment at ${j.employerName}?`)
  for (const e of i.creditEvents.filter((x) => !x.date && x.type !== 'collection')) need('event_date', `Date of the ${EVENT_LABEL[e.type].toLowerCase()} (${e.borrowerName}).`)
  if (!i.creditPulled) need('credit', 'Credit not pulled yet.')
  for (const j of i.jobs.filter((x) => x.hasIncome && !x.hasWorksheet)) need('income_docs', `Income not documented for ${j.employerName} (${j.borrowerName}): pay stubs, W-2s or returns, then an income worksheet.`)
  if (!i.hasAssets) need('assets', 'No savings or assets entered.')
  const waiting = i.outstandingDocs ?? []
  if (waiting.length) need('documents', `Still waiting on: ${waiting.slice(0, 6).join(', ')}${waiting.length > 6 ? ` and ${waiting.length - 6} more` : ''}.`)

  reasons.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level))
  const level = reasons[0]?.level ?? 'ready'
  const nurture = [...new Set(reasons.flatMap((r) => (r.nurture ? [r.nurture] : [])))]
  return { level, reasons, nurture }
}
