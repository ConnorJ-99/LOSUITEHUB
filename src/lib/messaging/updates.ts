// Intro texts and loan-update texts (plan docs/plans/ghl-intros-updates.md,
// Connor 2026-11-11). Built in code from the file, no AI. Drafts only: every
// one is edited and sent with a click through the usual send checks.
// Realtors and other partners never get loan figures, credit or income: only
// the milestone and dates. Pure, tested.

import { formatIsoDate } from '@/lib/dates'

export type Milestone = 'appraisal_ordered' | 'appraisal_received' | 'submitted' | 'approved' | 'clear_to_close' | 'closing_date_changed' | 'closed' | 'other'

export const MILESTONE_LABEL: Record<Milestone, string> = {
  appraisal_ordered: 'Appraisal ordered',
  appraisal_received: 'Appraisal received',
  submitted: 'With underwriting',
  approved: 'Approved with conditions',
  clear_to_close: 'Clear to close',
  closing_date_changed: 'Closing date changed',
  closed: 'Closed',
  other: 'Update',
}

/** The stage a file moved to, as a milestone worth telling people about (null = not one). */
export function milestoneForStage(stage: string): Milestone | null {
  if (stage === 'processing') return 'submitted'
  if (stage === 'clear_to_close') return 'clear_to_close'
  if (stage === 'closed') return 'closed'
  return null
}

/** A finished workflow step or task, as a milestone (by its name or rule), or null. */
export function milestoneForStep(name: string): Milestone | null {
  const n = name.toLowerCase()
  if (/apprais/.test(n) && /(order|request)/.test(n)) return 'appraisal_ordered'
  if (/apprais/.test(n) && /(receiv|in\b|back|complete|review)/.test(n)) return 'appraisal_received'
  if (/clear to close|\bctc\b/.test(n)) return 'clear_to_close'
  if (/approv/.test(n) && !/pre-?approv/.test(n)) return 'approved'
  if (/submit/.test(n)) return 'submitted'
  return null
}

const firstOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || ''
const cellLine = (cell: string | null | undefined) => {
  const d = (cell ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : null
}

/** "Hi Pat, this is Connor with MPS Mortgage. This is my work number..." */
export function borrowerIntro(o: { borrowerFirst: string; loName: string | null; personalCell: string | null }): string {
  const lo = firstOf(o.loName) || 'your loan officer'
  const cell = cellLine(o.personalCell)
  return `Hi ${firstOf(o.borrowerFirst) || 'there'}, this is ${lo} with MPS Mortgage. This is my work number. I'll send your loan updates from here${cell ? `, but for anything else my personal cell is ${cell}` : ''}.`
}

/** "Hi Amy, this is Connor with MPS Mortgage, working with Pat on 123 Main St..." */
export function partnerIntro(o: { partnerName: string; loName: string | null; borrowerFirst: string | null; address: string | null; personalCell: string | null }): string {
  const lo = firstOf(o.loName) || 'the loan officer'
  const who = firstOf(o.borrowerFirst)
  const on = o.address ? `on ${o.address}` : who ? 'on their loan' : ''
  const cell = cellLine(o.personalCell)
  const working = who ? `, working with ${who}${on ? ` ${on}` : ''}` : ''
  return `Hi ${firstOf(o.partnerName) || 'there'}, this is ${lo} with MPS Mortgage${working}. I'll send loan updates from this number${cell ? `; my personal cell is ${cell} anytime` : ''}.`
}

export interface UpdateFacts {
  loName: string | null
  borrowerFirst: string | null
  address: string | null
  closingDate: string | null
}

/**
 * A short update for a milestone. To a partner it names the borrower and the
 * address; to the borrower it speaks to them. No figures either way.
 */
export function milestoneUpdate(m: Milestone, to: { kind: 'borrower' | 'partner'; name: string }, f: UpdateFacts): string {
  const hi = `Hi ${firstOf(to.name) || 'there'},`
  const borrower = to.kind === 'borrower'
  const whose = borrower ? 'your' : `${firstOf(f.borrowerFirst) || 'the'}${firstOf(f.borrowerFirst) ? "'s" : ''}`
  const file = borrower ? 'your loan' : `${whose} loan${f.address ? ` on ${f.address}` : ''}`
  const closing = f.closingDate ? formatIsoDate(f.closingDate) : null
  const lo = firstOf(f.loName)
  const sign = lo ? ` - ${lo}, MPS Mortgage` : ''
  const line: Record<Milestone, string> = {
    appraisal_ordered: `quick update: the appraisal has been ordered for ${file}.${borrower ? " I'll let you know when it's back." : ''}`,
    appraisal_received: `the appraisal is in for ${file}.${borrower ? " I'll reach out if anything from it needs attention." : ''}`,
    submitted: `${file} is now with underwriting.${borrower ? " I'll let you know as soon as we hear back." : ''}`,
    approved: `good news: ${file} is approved with conditions. We're working through the last items now.`,
    clear_to_close: `great news: ${file} is clear to close${closing ? `, on track for ${closing}` : ''}.`,
    closing_date_changed: closing ? `the closing date for ${file} is now ${closing}.` : `the closing date for ${file} has changed.`,
    closed: borrower ? `congratulations, ${file} is closed! Thank you for trusting us with it.` : `${file} has closed. Thank you for the partnership!`,
    other: `a quick update on ${file}: `,
  }
  return `${hi} ${line[m]}${m === 'other' ? '' : sign}`
}
