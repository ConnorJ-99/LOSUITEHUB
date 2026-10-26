// Reviewing the assistant's reading of a call note: what each item would
// change, matched to the right person, job, debt, account or home; then
// the Prequal form with the picked items applied. Pure functions.
//
// Most items fill the Prequal form (Connor still clicks Save). A few live
// outside the form and are saved when applied, like the Program and credit
// history section: documentation type, timeline, credit events and the
// first-time buyer answer.

import type { NoteItem } from '../../../supabase/functions/assistant/callNotes'
import type { CreditEvent } from '@/lib/api/creditEvents'
import type { IncomeDocType, LoanDetails } from '@/lib/api/types'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { ASSET_OPTIONS, LIABILITY_OPTIONS, OTHER_INCOME_OPTIONS } from '@/lib/urla/options'
import type { PrequalDraft, QuickBorrower } from './draft'
import { DOC_TYPE_LABEL, EVENT_LABEL } from './readiness'

/** What the file has now, besides the form. */
export interface NoteReviewFile {
  isPurchase: boolean
  details: Pick<LoanDetails, 'incomeDocType' | 'timeline'>
  creditEvents: CreditEvent[]
  /** "Owned property in the last 3 years" per borrower (null = not answered). */
  ownedPast3Years: Record<string, boolean | null>
}

/** Connor's choice for one item: use it or not, and any values he changed (field name → new value). */
export interface NoteDecision {
  use: boolean
  edited?: Record<string, unknown>
}
export type NoteDecisions = Record<string, NoteDecision>

export type Destination = 'form' | 'saved' | 'not_applied'

export interface NoteRow {
  item: NoteItem
  edited: boolean
  label: string
  /** Whose it is (first name), when it belongs to a person. */
  person: string | null
  contactId: string | null
  destination: Destination
  currentLabel: string
  proposedLabel: string
  same: boolean
  /** Why it can't be used, or a reminder about it. */
  note: string | null
  /** What it updates in the form (a job, debt, account or home), for applying. */
  matchKey: string | null
}

const loose = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const money = (n: number | null | undefined) => (n == null ? '—' : formatCurrency(n))
const labelOf = (options: readonly { value: string; label: string }[], v: string) => options.find((o) => o.value === v)?.label ?? v
const LOAN_TYPE: Record<string, string> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA', other: 'Other' }
const PLAN: Record<string, string> = { keep: 'Keep', rent: 'Rent it out', sell: 'Sell' }
/** Words that say nothing about which job, debt or account it is. */
const FILLER = new Set(['llc', 'inc', 'co', 'corp', 'company', 'business', 'biz', 'the', 'and', 'of', 'test', 'services', 'credit', 'loan', 'card', 'bank', 'auto', 'car', 'truck', 'payment', 'account', 'checking', 'savings'])
const words = (s: string) => loose(s).split(' ').filter((w) => w.length >= 3 && !FILLER.has(w))
/**
 * Two names are the same thing when one contains the other, or they share a
 * meaningful word ("landscaping business" and "Reyes Landscaping LLC",
 * "Ford truck" and "Ford Credit").
 */
export const nameMatch = (a: string, b: string) => {
  if (!loose(a) || !loose(b)) return false
  if (loose(a).includes(loose(b)) || loose(b).includes(loose(a))) return true
  const theirs = new Set(words(b))
  return words(a).some((w) => theirs.has(w))
}

function personFor(item: NoteItem, borrowers: QuickBorrower[]): { borrower: QuickBorrower | null; asked: string | null } {
  const asked = 'borrower' in item ? item.borrower : null
  if (!asked) return { borrower: borrowers.find((b) => b.role === 'primary') ?? borrowers[0] ?? null, asked: null }
  return { borrower: borrowers.find((b) => loose(b.firstName) === loose(asked)) ?? null, asked }
}

/** One row per item, in the order read, with edits applied. */
export function buildNoteReview(items: NoteItem[], draft: PrequalDraft, file: NoteReviewFile, decisions: NoteDecisions): NoteRow[] {
  return items.map((original) => {
    const edit = decisions[original.id]?.edited
    const item = (edit ? { ...original, ...edit } : original) as NoteItem
    const { borrower, asked } = personFor(item, draft.borrowers)
    const about = 'borrower' in item
    const base = { item, edited: !!edit, person: about ? (borrower?.firstName ?? asked) : null, contactId: borrower?.contactId ?? null, note: null as string | null, matchKey: null as string | null }
    const row = (r: Omit<NoteRow, keyof typeof base> & Partial<typeof base>): NoteRow => ({ ...base, ...r })
    if (about && !borrower) {
      return row({ label: kindLabel(item), destination: 'not_applied', currentLabel: '—', proposedLabel: describe(item), same: false, note: `${asked} isn't on this file. Add them as a co-borrower first, then read the note again.` })
    }

    switch (item.kind) {
      case 'loan_type':
        return row({ label: 'Loan type', destination: 'form', currentLabel: LOAN_TYPE[draft.loan.mortgageType ?? ''] ?? '—', proposedLabel: LOAN_TYPE[item.value], same: draft.loan.mortgageType === item.value })
      case 'purchase_price':
        if (!file.isPurchase) return row({ label: 'Purchase price', destination: 'not_applied', currentLabel: '—', proposedLabel: money(item.value), same: false, note: 'This file is a refinance.' })
        return row({ label: 'Purchase price', destination: 'form', currentLabel: money(draft.loan.purchasePrice), proposedLabel: money(item.value), same: draft.loan.purchasePrice === item.value })
      case 'down_payment':
        if (!file.isPurchase) return row({ label: 'Down payment', destination: 'not_applied', currentLabel: '—', proposedLabel: money(item.value), same: false, note: 'This file is a refinance.' })
        return row({ label: 'Down payment', destination: 'form', currentLabel: money(draft.loan.downPaymentAmount), proposedLabel: money(item.value), same: draft.loan.downPaymentMode === 'amount' && draft.loan.downPaymentAmount === item.value })
      case 'down_payment_pct':
        if (!file.isPurchase) return row({ label: 'Down payment', destination: 'not_applied', currentLabel: '—', proposedLabel: `${item.value}%`, same: false, note: 'This file is a refinance.' })
        return row({ label: 'Down payment', destination: 'form', currentLabel: draft.loan.downPaymentPct == null ? '—' : `${draft.loan.downPaymentPct}%`, proposedLabel: `${item.value}%`, same: draft.loan.downPaymentMode === 'percent' && draft.loan.downPaymentPct === item.value })
      case 'credit_score':
        return row({ label: 'Estimated credit score', destination: 'form', currentLabel: borrower!.creditScore?.toString() ?? '—', proposedLabel: String(item.value), same: borrower!.creditScore === item.value })
      case 'first_time_buyer': {
        const owned = file.ownedPast3Years[borrower!.contactId] ?? null
        const now = owned === null ? '—' : owned ? 'No (owned a home in 3 years)' : 'Yes'
        return row({ label: 'First-time buyer', destination: 'saved', currentLabel: now, proposedLabel: item.value ? 'Yes' : 'No (owned a home in 3 years)', same: owned !== null && owned === !item.value })
      }
      case 'job': {
        const match = borrower!.jobs.find((j) => nameMatch(j.employerName, item.employer)) ?? null
        const reminder = item.selfEmployed && !item.startDate ? (item.years ? `Notes say ${item.years} years; add the start date (pencil) so readiness can count it.` : 'Self-employed: add the start date (pencil).') : null
        const monthlyNote = item.monthly === null ? 'No monthly figure in the notes; enter it in the form.' : null
        const proposed = `${match?.employerName ?? item.employer}${item.selfEmployed ? ' (self-employed)' : ''}: ${item.monthly === null ? 'income not stated' : `${money(item.monthly)}/mo`}${item.startDate ? `, since ${formatIsoDate(item.startDate)}` : ''}`
        const same = !!match && (item.monthly === null || match.monthly === item.monthly) && (!item.startDate || match.startDate === item.startDate)
        return row({ label: match ? 'Job (update)' : 'Job (new)', destination: 'form', currentLabel: match ? `${match.employerName}: ${money(match.monthly)}/mo` : '—', proposedLabel: proposed, same, matchKey: match?.key ?? null, note: reminder ?? monthlyNote })
      }
      case 'other_income': {
        const match = borrower!.otherIncomes.find((o) => o.incomeType === item.incomeType) ?? null
        return row({ label: labelOf(OTHER_INCOME_OPTIONS, item.incomeType), destination: 'form', currentLabel: match ? `${money(match.monthly)}/mo` : '—', proposedLabel: `${money(item.monthly)}/mo`, same: match?.monthly === item.monthly, matchKey: match?.key ?? null })
      }
      case 'debt': {
        const match = item.creditor ? (draft.debts.find((d) => d.contactId === borrower!.contactId && nameMatch(d.creditorName, item.creditor)) ?? null) : null
        const proposed = `${item.creditor || labelOf(LIABILITY_OPTIONS, item.debtType)}: ${money(item.monthlyPayment)}/mo${item.balance !== null ? `, owes ${money(item.balance)}` : ''}${item.payOff ? ', paid off at closing' : ''}`
        return row({ label: match ? 'Debt (update)' : 'Debt (new)', destination: 'form', currentLabel: match ? `${match.creditorName}: ${money(match.monthlyPayment)}/mo` : '—', proposedLabel: proposed, same: !!match && match.monthlyPayment === item.monthlyPayment && (item.balance === null || match.unpaidBalance === item.balance) && match.toBePaidOff === item.payOff, matchKey: match?.key ?? null })
      }
      case 'savings': {
        const match = draft.assets.find((a) => a.contactId === borrower!.contactId && a.assetType === item.assetType && (!item.institution || !a.institutionName || nameMatch(a.institutionName, item.institution))) ?? null
        return row({ label: match ? 'Savings (update)' : 'Savings (new)', destination: 'form', currentLabel: match ? money(match.amount) : '—', proposedLabel: `${labelOf(ASSET_OPTIONS, item.assetType)}${item.institution ? ` at ${item.institution}` : ''}: ${money(item.amount)}`, same: match?.amount === item.amount, matchKey: match?.key ?? null })
      }
      case 'home': {
        const byAddress = draft.properties.find((h) => loose(h.addressLine).split(' ').slice(0, 3).join(' ') === loose(item.address).split(' ').slice(0, 3).join(' '))
        const match = byAddress ?? (draft.properties.length === 1 && !/\d/.test(item.address) ? draft.properties[0] : null)
        const proposed = [item.value !== null && `worth ${money(item.value)}`, item.plan && PLAN[item.plan], item.monthlyRent !== null && `rent ${money(item.monthlyRent)}/mo`].filter(Boolean).join(', ') || 'no changes'
        const owedNote = item.owed !== null ? `Notes say they owe ${money(item.owed)}; check the mortgage on the Properties tab.` : null
        if (!match) return row({ label: 'Home they own', destination: 'not_applied', currentLabel: '—', proposedLabel: `${item.address}: ${proposed}`, same: false, note: `Add ${item.address} on the Properties tab first${owedNote ? `. ${owedNote}` : '.'}` })
        const same = (item.value === null || match.estimatedValue === item.value) && (!item.plan || match.plan === item.plan) && (item.monthlyRent === null || match.monthlyRent === item.monthlyRent)
        return row({ label: 'Home they own', destination: 'form', currentLabel: `${match.addressLine}: worth ${money(match.estimatedValue)}, ${PLAN[match.plan]}`, proposedLabel: proposed, same, matchKey: match.key, note: owedNote })
      }
      case 'credit_event': {
        const exists = file.creditEvents.some((e) => e.contactId === borrower!.contactId && e.eventType === item.eventType && e.eventDate === item.date)
        const proposed = `${EVENT_LABEL[item.eventType]}${item.eventType === 'late_payment' ? ` (${item.daysLate} days${item.isMortgage ? ', mortgage' : ''})` : ''}, ${item.date ? formatIsoDate(item.date) : 'date unknown'}`
        return row({ label: 'Credit history', destination: 'saved', currentLabel: exists ? 'Already in credit history' : '—', proposedLabel: proposed, same: exists })
      }
      case 'doc_type':
        return row({ label: 'Income documentation', destination: 'saved', currentLabel: file.details.incomeDocType ? DOC_TYPE_LABEL[file.details.incomeDocType] : '—', proposedLabel: DOC_TYPE_LABEL[item.value as IncomeDocType], same: file.details.incomeDocType === item.value })
      case 'timeline':
        return row({ label: 'Timeline', destination: 'saved', currentLabel: file.details.timeline ?? '—', proposedLabel: item.value, same: loose(file.details.timeline) === loose(item.value) })
    }
  })
}

function kindLabel(item: NoteItem): string {
  const labels: Record<NoteItem['kind'], string> = {
    loan_type: 'Loan type', purchase_price: 'Purchase price', down_payment: 'Down payment', down_payment_pct: 'Down payment', credit_score: 'Estimated credit score',
    first_time_buyer: 'First-time buyer', job: 'Job', other_income: 'Other income', debt: 'Debt', savings: 'Savings', home: 'Home they own', credit_event: 'Credit history', doc_type: 'Income documentation', timeline: 'Timeline',
  }
  return labels[item.kind]
}

function describe(item: NoteItem): string {
  switch (item.kind) {
    case 'credit_score':
      return String(item.value)
    case 'job':
      return `${item.employer}${item.monthly !== null ? `: ${money(item.monthly)}/mo` : ''}`
    case 'debt':
      return `${item.creditor || labelOf(LIABILITY_OPTIONS, item.debtType)}: ${money(item.monthlyPayment)}/mo`
    case 'savings':
      return money(item.amount)
    case 'other_income':
      return `${money(item.monthly)}/mo`
    default:
      return 'value' in item ? String(item.value) : ''
  }
}

/** Starting choices: use what would change something, except low-confidence items. */
export function defaultNoteDecisions(items: NoteItem[], draft: PrequalDraft, file: NoteReviewFile): NoteDecisions {
  const rows = buildNoteReview(items, draft, file, {})
  return Object.fromEntries(rows.map((r) => [r.item.id, { use: r.destination !== 'not_applied' && !r.same && r.item.confidence !== 'low' }]))
}

const used = (r: NoteRow, d: NoteDecisions) => !!d[r.item.id]?.use && r.destination !== 'not_applied' && !r.same

/** The Prequal form with the picked items filled in (nothing saved yet). */
export function applyToDraft(draft: PrequalDraft, rows: NoteRow[], decisions: NoteDecisions): PrequalDraft {
  let next: PrequalDraft = structuredClone(draft)
  const borrower = (contactId: string | null, change: (b: QuickBorrower) => QuickBorrower) => {
    next = { ...next, borrowers: next.borrowers.map((b) => (b.contactId === contactId ? change(b) : b)) }
  }
  for (const r of rows.filter((x) => x.destination === 'form' && used(x, decisions))) {
    const i = r.item
    const key = `note-${i.id}`
    switch (i.kind) {
      case 'loan_type':
        next.loan = { ...next.loan, mortgageType: i.value }
        break
      case 'purchase_price':
        next.loan = { ...next.loan, purchasePrice: i.value }
        break
      case 'down_payment':
        next.loan = { ...next.loan, downPaymentMode: 'amount', downPaymentAmount: i.value }
        break
      case 'down_payment_pct':
        next.loan = { ...next.loan, downPaymentMode: 'percent', downPaymentPct: i.value }
        break
      case 'credit_score':
        borrower(r.contactId, (b) => ({ ...b, creditScore: i.value }))
        break
      case 'job':
        borrower(r.contactId, (b) => ({
          ...b,
          jobs: r.matchKey
            ? b.jobs.map((j) => (j.key === r.matchKey ? { ...j, monthly: i.monthly ?? j.monthly, startDate: i.startDate ?? j.startDate } : j))
            : [...b.jobs, { key, id: null, employerName: i.employer, selfEmployed: i.selfEmployed, monthly: i.monthly, otherPay: 0, startDate: i.startDate }],
        }))
        break
      case 'other_income':
        borrower(r.contactId, (b) => ({
          ...b,
          otherIncomes: r.matchKey ? b.otherIncomes.map((o) => (o.key === r.matchKey ? { ...o, monthly: i.monthly } : o)) : [...b.otherIncomes, { key, id: null, incomeType: i.incomeType, monthly: i.monthly }],
        }))
        break
      case 'debt':
        next.debts = r.matchKey
          ? next.debts.map((d) => (d.key === r.matchKey ? { ...d, monthlyPayment: i.monthlyPayment, unpaidBalance: i.balance ?? d.unpaidBalance, toBePaidOff: i.payOff } : d))
          : [...next.debts, { key, id: null, contactId: r.contactId!, liabilityType: i.debtType, creditorName: i.creditor, monthlyPayment: i.monthlyPayment, toBePaidOff: i.payOff, unpaidBalance: i.balance }]
        break
      case 'savings':
        next.assets = r.matchKey
          ? next.assets.map((a) => (a.key === r.matchKey ? { ...a, amount: i.amount } : a))
          : [...next.assets, { key, id: null, contactId: r.contactId!, assetType: i.assetType, institutionName: i.institution, amount: i.amount, useAs: i.assetType === 'retirement' ? 'reserves' : 'down_payment' }]
        break
      case 'home':
        next.properties = next.properties.map((h) =>
          h.key === r.matchKey ? { ...h, estimatedValue: i.value ?? h.estimatedValue, plan: i.plan ?? h.plan, monthlyRent: i.monthlyRent ?? h.monthlyRent } : h,
        )
        break
    }
  }
  return next
}

export interface SavedNow {
  incomeDocType?: IncomeDocType
  timeline?: string
  creditEvents: { contactId: string; eventType: CreditEvent['eventType']; eventDate: string | null; daysLate: number | null; isMortgage: boolean }[]
  ownedPast3Years: { contactId: string; value: boolean }[]
}

/** The picked items that live outside the form, saved when the reading is applied. */
export function savedNow(rows: NoteRow[], decisions: NoteDecisions): SavedNow {
  const out: SavedNow = { creditEvents: [], ownedPast3Years: [] }
  for (const r of rows.filter((x) => x.destination === 'saved' && used(x, decisions))) {
    const i = r.item
    if (i.kind === 'doc_type') out.incomeDocType = i.value
    if (i.kind === 'timeline') out.timeline = i.value
    if (i.kind === 'credit_event') out.creditEvents.push({ contactId: r.contactId!, eventType: i.eventType, eventDate: i.date, daysLate: i.daysLate, isMortgage: i.isMortgage })
    if (i.kind === 'first_time_buyer') out.ownedPast3Years.push({ contactId: r.contactId!, value: !i.value })
  }
  return out
}

/** The record kept on the reading, and the outcome for the run log. */
export function noteRecord(rows: NoteRow[], decisions: NoteDecisions) {
  const items = rows.map((r) => ({ ...r.item, decision: used(r, decisions) ? (r.edited ? 'edited' : 'accepted') : 'skipped' }))
  return { items, outcome: items.some((i) => i.decision === 'edited') ? ('edited' as const) : ('approved' as const) }
}
