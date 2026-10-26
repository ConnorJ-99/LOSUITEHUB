// After the readiness result: the next step to take, the documents to ask
// for, and the request message. Pure functions, built from the file (no
// AI). The checklist is a starter; in Phase 7 it becomes editable rules in
// Settings.

import { emailSignature, complianceIssues, MAX_TEXT_LENGTH, type Signer } from '../../../supabase/functions/assistant/followUp'
import type { IncomeDocType } from '@/lib/api/types'
import type { DraftMessage } from '@/lib/queue/today'
import type { OtherIncomeType } from '@/lib/urla/options'
import type { PrequalDraft } from './draft'
import { NURTURE_LABEL, type CreditEventType, type Readiness } from './readiness'

// ---------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------

export type NextAction = 'nurture' | 'pull_credit' | 'request_documents' | 'pre_approve'

export interface NextStep {
  action: NextAction
  title: string
  detail: string
}

const EARLY_STAGES = ['lead', 'contacted', 'pre_qualified']

/** The one thing to do next, from the readiness result. */
export function nextStep(r: Readiness, stage: string): NextStep | null {
  if (r.level === 'not_ready') {
    return { action: 'nurture', title: 'Move to Nurture', detail: `Not ready yet: ${r.nurture.map((n) => NURTURE_LABEL[n].toLowerCase()).join(', ')}. Set a check-back date.` }
  }
  if (r.level === 'manual_review') {
    return { action: 'request_documents', title: 'Review for Non-QM, then request documents', detail: 'Look at Non-QM options for the reasons above (Product Search comes in Phase 9), and ask for the documents that program needs.' }
  }
  if (r.level === 'needs_documents') {
    if (r.reasons.some((x) => x.missing === 'score' || x.missing === 'income')) {
      return { action: 'request_documents', title: 'Finish the prequal', detail: 'Get the estimated credit score and income on the next call, then request documents.' }
    }
    if (r.reasons.some((x) => x.missing === 'credit')) {
      return { action: 'pull_credit', title: 'Pull credit', detail: "Pull credit, then mark the Workflow's \"Pull credit\" step done. Request documents at the same time." }
    }
    return { action: 'request_documents', title: 'Request documents', detail: 'Ask for the documents below, then do the income worksheets as they come in.' }
  }
  return EARLY_STAGES.includes(stage)
    ? { action: 'pre_approve', title: 'Pre-approve', detail: 'Everything checks out. Move the file to Pre-Approved; pre-approval letters come in Phase 8.' }
    : null
}

// ---------------------------------------------------------------------------
// Document checklist
// ---------------------------------------------------------------------------

export interface ChecklistPerson {
  firstName: string
  jobs: { employerName: string; selfEmployed: boolean }[]
  otherIncomes: OtherIncomeType[]
  /** Kinds of savings entered (checking, retirement, gift_cash...). */
  assetTypes: string[]
  creditEvents: CreditEventType[]
}

export interface ChecklistInput {
  people: ChecklistPerson[]
  incomeDocType: IncomeDocType | null
  /** Homes they already own (not the one being bought): rented out or not. */
  homes: { addressLine: string; rented: boolean }[]
}

export interface DocItem {
  key: string
  /** Short, for a text message. */
  short: string
  /** Full wording, for an email. */
  full: string
}

export interface DocGroup {
  /** A borrower's first name, or "Homes you own". */
  title: string
  items: DocItem[]
}

const AWARD_LETTER: Partial<Record<OtherIncomeType, string>> = {
  social_security: 'Social Security',
  retirement: 'pension or retirement',
  disability: 'disability',
  va_compensation: 'VA',
}
const SUPPORT: OtherIncomeType[] = ['child_support', 'alimony', 'separate_maintenance']
const BANKABLE = ['checking', 'savings', 'money_market', 'certificate_of_deposit']
const INVESTMENT = ['mutual_fund', 'stocks', 'stock_options', 'bonds', 'retirement', 'trust_account']
const GIFT = ['gift_cash', 'gift_equity', 'grant']

/** What to ask each person for, from how they earn money, what they have and their credit history. */
export function documentChecklist(input: ChecklistInput): DocGroup[] {
  const doc = input.incomeDocType ?? 'full_doc'
  const groups: DocGroup[] = input.people.map((p) => {
    const items: DocItem[] = [{ key: 'id', short: 'a photo of your ID', full: "A photo of your driver's license or other ID" }]
    const add = (key: string, short: string, full: string) => items.push({ key, short, full })
    const wage = p.jobs.filter((j) => !j.selfEmployed)
    const selfEmployed = p.jobs.filter((j) => j.selfEmployed)

    if (doc === 'bank_statement' && p.jobs.length) {
      add('bank_statements_income', 'business bank statements (12-24 months)', '12 to 24 months of business bank statements, all pages')
      add('business_proof', 'a CPA letter or business license', 'A CPA letter or business license showing at least 2 years in business')
    } else if (doc === 'form_1099' && p.jobs.length) {
      add('forms_1099', '1099s (2 years)', '1099s for the last 2 years')
    } else if (doc === 'asset_based') {
      add('asset_statements', 'investment/retirement statements (3 months)', 'The last 3 months of statements for your investment and retirement accounts')
    } else if (doc !== 'dscr') {
      if (wage.length) {
        add('paystubs', 'pay stubs (last 30 days)', `Pay stubs covering the last 30 days${wage.length > 1 ? ' from each job' : ''}`)
        add('w2s', 'W-2s (2 years)', 'W-2s for the last 2 years')
      }
      if (selfEmployed.length) {
        add('tax_returns', 'tax returns (2 years)', 'Personal tax returns for the last 2 years, all pages and schedules')
        add('business_returns', 'business returns (2 years)', 'Business tax returns for the last 2 years (1120S or 1065 with K-1s) if you own 25% or more')
        add('pl', 'a year-to-date P&L', 'A year-to-date profit and loss statement')
      }
    }
    for (const t of p.otherIncomes) {
      if (AWARD_LETTER[t] && !items.some((i) => i.key === `award_${t}`)) add(`award_${t}`, `${AWARD_LETTER[t]} award letter`, `Your ${AWARD_LETTER[t]} award letter`)
    }
    if (p.otherIncomes.some((t) => SUPPORT.includes(t))) add('support_order', 'divorce decree or support order', 'The divorce decree or court order, and proof of the last 6 months of payments received')

    if (p.assetTypes.some((t) => BANKABLE.includes(t))) add('bank_statements', 'bank statements (2 months)', 'The last 2 months of statements for each bank account, all pages')
    if (doc !== 'asset_based' && p.assetTypes.some((t) => INVESTMENT.includes(t))) add('investment_statements', 'investment/retirement statements', 'The latest statement for each investment or retirement account')
    if (p.assetTypes.some((t) => GIFT.includes(t))) add('gift_letter', 'a gift letter', "A signed gift letter (I'll send you the form) and proof of the transfer")

    if (p.creditEvents.some((t) => t === 'bankruptcy_ch7' || t === 'bankruptcy_ch13')) add('bankruptcy', 'bankruptcy discharge papers', 'Your bankruptcy discharge papers')
    if (p.creditEvents.some((t) => t === 'foreclosure' || t === 'short_sale' || t === 'deed_in_lieu')) add('foreclosure', 'foreclosure/short sale papers', 'The closing or completion papers for the foreclosure, short sale or deed in lieu')
    if (p.creditEvents.some((t) => t === 'late_payment' || t === 'collection')) add('explanation', 'a short letter about the late payment', 'A short letter explaining the late payment or collection')
    return { title: p.firstName, items }
  })

  if (input.homes.length || doc === 'dscr') {
    const items: DocItem[] = []
    if (input.homes.length) items.push({ key: 'home_statements', short: 'mortgage statements and insurance for homes you own', full: 'For each home you own: the latest mortgage statement and the homeowners insurance declarations page' })
    if (input.homes.some((h) => h.rented) || doc === 'dscr') items.push({ key: 'leases', short: 'current leases', full: 'A copy of the current lease for each rented home' })
    groups.push({ title: HOMES, items })
  }
  return groups.filter((g) => g.items.length)
}

// ---------------------------------------------------------------------------
// The request message
// ---------------------------------------------------------------------------

const HOMES = 'Homes you own'

const joinList = (parts: string[]) => (parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`)

/**
 * The document request for the main borrower, in Connor's voice. A text
 * lists the short names if it fits in one message, otherwise says the full
 * list is coming by email. An email lists everything by person, with the
 * signature.
 */
export function documentRequest(channel: 'text' | 'email', to: { firstName: string; contact: string | null }, groups: DocGroup[], signer: Signer): DraftMessage {
  const toLine = [to.firstName, to.contact].filter(Boolean).join(' · ')
  const me = signer.loName ? signer.loName.split(/\s+/)[0] : null
  if (channel === 'text') {
    const shorts = [...new Set(groups.flatMap((g) => g.items.map((i) => i.short)))]
    const opener = `Hi ${to.firstName}, ${me ? `it's ${me}. ` : ''}To keep your pre-approval moving I'll need `
    const full = `${opener}${joinList(shorts)}. Photos or PDFs are fine. Thanks!`
    const body = full.length <= MAX_TEXT_LENGTH ? full : `Hi ${to.firstName}, ${me ? `it's ${me}. ` : ''}I'm emailing you the list of documents I need for your pre-approval. Photos or PDFs are fine. Thanks!`
    return { channel: 'text', to: toLine, subject: null, body }
  }
  const several = groups.length > 1
  const heading = (title: string) => (title === to.firstName ? 'From you' : title === HOMES ? HOMES : `From ${title}`)
  const lines = [
    `Hi ${to.firstName},`,
    '',
    'Thank you for your time today. To keep your pre-approval moving, please send me the following:',
    '',
    ...groups.flatMap((g) => [...(several ? [`${heading(g.title)}:`] : []), ...g.items.map((i) => `- ${i.full}`), '']),
    'Photos or PDFs are fine, as long as every page is readable. If anything is hard to find, just let me know and we will figure it out.',
    '',
    'Thank you,',
    '',
    emailSignature(signer),
  ]
  return { channel: 'email', to: toLine, subject: 'Documents for your pre-approval', body: lines.join('\n') }
}

/** Compliance problems in a request (same rules as every draft; the signature isn't checked). */
export function requestIssues(d: DraftMessage, signer: Signer): string[] {
  return complianceIssues(d.channel, { subject: d.subject, body: d.channel === 'email' ? d.body.replace(emailSignature(signer), '') : d.body })
}

/** The checklist input from the Prequal form (live or saved) and the credit history. */
export function checklistFrom(draft: PrequalDraft, incomeDocType: IncomeDocType | null, events: { contactId: string; eventType: CreditEventType }[]): ChecklistInput {
  return {
    people: draft.borrowers.map((b) => ({
      firstName: b.firstName,
      jobs: b.jobs.filter((j) => j.employerName.trim()).map((j) => ({ employerName: j.employerName, selfEmployed: j.selfEmployed })),
      otherIncomes: b.otherIncomes.filter((o) => o.monthly !== null).map((o) => o.incomeType),
      assetTypes: draft.assets.filter((a) => a.contactId === b.contactId && a.amount !== null).map((a) => a.assetType),
      creditEvents: events.filter((e) => e.contactId === b.contactId).map((e) => e.eventType),
    })),
    incomeDocType,
    homes: draft.properties.filter((h) => h.plan !== 'sell').map((h) => ({ addressLine: h.addressLine, rented: h.plan === 'rent' })),
  }
}
