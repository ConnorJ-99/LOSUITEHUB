// The final Closing Disclosure review (Connor, 2026-11-19): turns the
// assistant's reading into one row per figure against what the file has now.
// Pure and tested; the card only lays the rows out.
//
// Rules (same as AI Fill on the 1003): an empty place on the file fills
// (ticked unless its words weren't found in the PDF or it's low confidence), a
// different value waits for Replace or Keep, the same value is shown as
// matching, and cash to close, closing costs and broker comp are checks only.
// The AI never does math: the yearly taxes and insurance are 12 times the
// monthly escrow, worked out in targetValue().

import { CD_FIELDS, targetValue, type CdField, type CdFieldDef, type CdFieldKey, type CdTarget } from '../../../supabase/functions/assistant/closingDisclosure'
import { findQuote } from '@/lib/documents/findQuote'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'

export type QuoteStatus = 'found' | 'missing' | 'unchecked'
export type RowState = 'fill' | 'replace' | 'same' | 'check' | 'cannot'
export type Decision = 'use' | 'keep'
export type CdGroup = 'loan' | 'dates' | 'payment' | 'credits'

export const CD_GROUPS: { id: CdGroup; label: string }[] = [
  { id: 'loan', label: 'Loan' },
  { id: 'dates', label: 'Dates' },
  { id: 'payment', label: 'Payment & escrow' },
  { id: 'credits', label: 'Credits & costs' },
]

const GROUP: Record<CdFieldKey, CdGroup> = {
  loan_amount: 'loan', interest_rate: 'loan', loan_term: 'loan', lender_name: 'loan', lender_loan_number: 'loan',
  date_issued: 'dates', closing_date: 'dates', disbursement_date: 'dates', first_payment_date: 'dates',
  principal_interest: 'payment', monthly_escrow: 'payment', total_monthly_payment: 'payment', tax_monthly: 'payment', insurance_monthly: 'payment',
  discount_points: 'credits', prepaids_total: 'credits', total_closing_costs: 'credits', lender_credits: 'credits', seller_credits: 'credits', cash_to_close: 'credits', broker_compensation: 'credits',
}

/** What the file has now, by the database place each figure fills. */
export interface CdFileNow {
  /** loans.* and properties.* values, keyed by target (e.g. "loans.loan_amount"). */
  values: Partial<Record<CdTarget, number | string | null>>
  /** The file has a subject home (for taxes and insurance). */
  hasHome: boolean
  /** The lender shown on the file now, and whether the file's program sets it (then it can't change here). */
  lenderName: string | null
  lenderFromProgram: boolean
  /** The company's lenders, to match the CD's lender by name. */
  lenders: readonly { id: string; name: string }[]
  /** The file's revenue in dollars, to compare with the broker comp; null when unknown or hidden. */
  revenue: number | null
}

export interface CdRow {
  key: CdFieldKey
  label: string
  group: CdGroup
  target: CdTarget | null
  state: RowState
  /** What the CD says, formatted. */
  cdText: string
  /** What the file has now, formatted ('—' when empty). */
  fileText: string
  /** The value saved when used (12× for monthly escrow; a lender id for the lender). */
  next: number | string | null
  quote: string
  page: number | null
  confidence: CdField['confidence']
  quoteStatus: QuoteStatus
  /** Ticked when first shown (fills only). */
  defaultUse: boolean
  note: string | null
}

const isoDate = (v: unknown) => (typeof v === 'string' ? v : null)

function display(def: CdFieldDef, value: number | string | null | undefined): string {
  if (value == null || value === '') return '—'
  switch (def.kind) {
    case 'money':
      return formatCurrency(Number(value))
    case 'pct':
      return formatPercent(Number(value))
    case 'date':
      return formatIsoDate(isoDate(value))
    case 'term': {
      const m = Number(value)
      return m % 12 === 0 ? `${m / 12} years` : `${m} months`
    }
    case 'text':
      return String(value)
  }
}

/** The figure the file keeps, formatted (yearly for escrow). */
function displayTarget(def: CdFieldDef, value: number | string | null | undefined): string {
  if (def.monthlyToYearly) return value == null || value === '' ? '—' : `${formatCurrency(Number(value))} a year`
  return display(def, value)
}

const sameValue = (a: unknown, b: unknown) => {
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 0.005
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
}

/** A lender name without punctuation or company endings, for matching. */
export const lenderKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.,'’&]/g, ' ')
    .replace(/\b(inc|llc|corp|corporation|co|company|na|n a|ltd|lp|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Checks each figure's words against the PDF's own text (pages of lines). No text (a scan) = unchecked. */
export function checkQuotes(pages: string[][] | null, fields: readonly CdField[]): Partial<Record<CdFieldKey, QuoteStatus>> {
  const hasText = !!pages && pages.some((p) => p.some((l) => l.trim()))
  const out: Partial<Record<CdFieldKey, QuoteStatus>> = {}
  for (const f of fields) {
    if (!hasText || !pages) {
      out[f.key] = 'unchecked'
      continue
    }
    const where = f.page && pages[f.page - 1] ? [pages[f.page - 1], ...pages.filter((_, i) => i !== f.page! - 1)] : pages
    out[f.key] = where.some((lines) => findQuote(lines, f.quote || f.text, f.text)) ? 'found' : 'missing'
  }
  return out
}

/** One row per figure read, in the field list's order. */
export function reviewRows(fields: readonly CdField[], file: CdFileNow, quotes: Partial<Record<CdFieldKey, QuoteStatus>>): CdRow[] {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const rows: CdRow[] = []
  for (const def of CD_FIELDS as readonly CdFieldDef[]) {
    const f = byKey.get(def.key as CdFieldKey)
    if (!f) continue
    const quoteStatus = quotes[f.key] ?? 'unchecked'
    const base = { key: f.key, label: def.label, group: GROUP[f.key], target: def.target, cdText: display(def, f.value), quote: f.quote, page: f.page, confidence: f.confidence, quoteStatus }
    const notes: string[] = []
    if (quoteStatus === 'missing') notes.push("These words weren't found in the PDF. Check the page before using it.")

    let state: RowState
    let next: number | string | null = null
    let fileText = '—'

    if (!def.target) {
      state = 'check'
      if (f.key === 'broker_compensation' && file.revenue != null && !sameValue(f.value, file.revenue)) notes.push(`The file's revenue is ${formatCurrency(file.revenue)}.`)
    } else if (def.target === 'loans.lender_id') {
      const want = lenderKey(String(f.value))
      const match = file.lenders.find((l) => lenderKey(l.name) === want) ?? null
      fileText = file.lenderName ?? '—'
      if (file.lenderName && lenderKey(file.lenderName) === want) state = 'same'
      else if (file.lenderFromProgram) {
        state = 'cannot'
        notes.push(`The file's program sets the lender (${file.lenderName ?? 'unknown'}).`)
      } else if (!match) {
        state = 'cannot'
        notes.push('Not in your lender list. Add it on the Lenders page, then read the CD again.')
      } else {
        next = match.id
        state = file.values['loans.lender_id'] ? 'replace' : 'fill'
      }
    } else if (def.target.startsWith('properties.') && !file.hasHome) {
      state = 'cannot'
      notes.push('This file has no subject home for it.')
    } else {
      next = targetValue(def, f.value)
      const now = file.values[def.target]
      fileText = displayTarget(def, now)
      state = now == null || now === '' ? 'fill' : sameValue(now, next) ? 'same' : 'replace'
    }

    if (def.monthlyToYearly && next != null) notes.push(`${base.cdText} a month × 12 = ${formatCurrency(Number(next))} a year.`)
    rows.push({ ...base, state, next, fileText, defaultUse: state === 'fill' && quoteStatus !== 'missing' && f.confidence !== 'low', note: notes.join(' ') || null })
  }

  // Funded before closing: say so on the funded date.
  const closing = (byKey.get('closing_date')?.value as string | undefined) ?? (file.values['loans.closing_date'] as string | null | undefined) ?? null
  const funded = rows.find((r) => r.key === 'disbursement_date')
  if (funded && closing && typeof funded.next === 'string' && funded.next < closing) {
    funded.note = [funded.note, "This is before the closing date; it can't be saved that way."].filter(Boolean).join(' ')
    funded.defaultUse = false
  }
  return rows
}

/** Whether a row is used, given Connor's choices (fills default to their tick; differences to Keep). */
export const isUsed = (row: CdRow, decisions: Partial<Record<CdFieldKey, Decision>>) =>
  (row.state === 'fill' || row.state === 'replace') && (decisions[row.key] ?? (row.defaultUse ? 'use' : 'keep')) === 'use'

export interface CdChange {
  key: CdFieldKey
  label: string
  target: CdTarget
  after: number | string
}

/** The changes Apply sends (apply_closing_disclosure). */
export function changesFor(rows: readonly CdRow[], decisions: Partial<Record<CdFieldKey, Decision>>): CdChange[] {
  return rows.filter((r) => isUsed(r, decisions) && r.target && r.next != null).map((r) => ({ key: r.key, label: r.label, target: r.target!, after: r.next! }))
}

/** A saved value as the file shows it (yearly for the home's taxes and insurance), for the applied list. */
export function formatCdSaved(key: string, value: unknown): string {
  const def = (CD_FIELDS as readonly CdFieldDef[]).find((d) => d.key === key)
  if (!def || (value !== null && typeof value !== 'number' && typeof value !== 'string')) return '—'
  return displayTarget(def, value)
}

/** Rows still waiting for Replace or Keep. */
export const undecided = (rows: readonly CdRow[], decisions: Partial<Record<CdFieldKey, Decision>>) => rows.filter((r) => r.state === 'replace' && !decisions[r.key])
