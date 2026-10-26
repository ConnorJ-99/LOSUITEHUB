// After the readiness result: the next step to take, the documents to ask
// for, and the request message. Pure functions, built from the file (no
// AI). The checklist is a starter; in Phase 7 it becomes editable rules in
// Settings.

import { emailSignature, complianceIssues, MAX_TEXT_LENGTH, type Signer } from '../../../supabase/functions/assistant/followUp'
import type { DocumentKind } from '@/lib/api/documents'
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
    if (r.reasons.every((x) => x.missing === 'documents')) {
      return { action: 'request_documents', title: 'Follow up on documents', detail: 'The documents above were asked for and haven\'t come in yet. Mark them received on the Documents tab as they arrive.' }
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
  /** The borrower's contact, so requests can be tracked per person. */
  contactId?: string | null
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
  /** The document type that satisfies it. */
  kind: DocumentKind
}

export interface DocGroup {
  /** A borrower's first name, or "Homes you own". */
  title: string
  /** Whose items they are; null for the whole file (homes). */
  contactId: string | null
  items: DocItem[]
}

export type DocumentCondition =
  | 'everyone'
  | 'wage_earner'
  | 'self_employed'
  | 'bank_statement_income'
  | 'form_1099_income'
  | 'asset_based_income'
  | 'award_income'
  | 'support_income'
  | 'bank_accounts'
  | 'investment_accounts'
  | 'gift'
  | 'bankruptcy'
  | 'foreclosure'
  | 'late_or_collection'
  | 'owns_home'
  | 'rental_or_dscr'

/** One checklist rule (Settings). {income} and {each_job} are filled in per person. */
export interface DocRule {
  key: string
  condition: DocumentCondition
  shortText: string
  fullText: string
  kind: DocumentKind
  sortOrder: number
  active: boolean
}

/** LOSuite's starter checklist. The database seeds the same list (a test keeps them identical). */
export const DEFAULT_DOCUMENT_RULES: DocRule[] = [
  ['id', 'everyone', 'a photo of your ID', "A photo of your driver's license or other ID", 'photo_id', 10],
  ['bank_statements_income', 'bank_statement_income', 'business bank statements (12-24 months)', '12 to 24 months of business bank statements, all pages', 'bank_statement', 20],
  ['business_proof', 'bank_statement_income', 'a CPA letter or business license', 'A CPA letter or business license showing at least 2 years in business', 'other', 30],
  ['forms_1099', 'form_1099_income', '1099s (2 years)', '1099s for the last 2 years', 'form_1099', 40],
  ['asset_statements', 'asset_based_income', 'investment/retirement statements (3 months)', 'The last 3 months of statements for your investment and retirement accounts', 'investment_statement', 50],
  ['paystubs', 'wage_earner', 'pay stubs (last 30 days)', 'Pay stubs covering the last 30 days{each_job}', 'paystub', 60],
  ['w2s', 'wage_earner', 'W-2s (2 years)', 'W-2s for the last 2 years', 'w2', 70],
  ['tax_returns', 'self_employed', 'tax returns (2 years)', 'Personal tax returns for the last 2 years, all pages and schedules', 'tax_return', 80],
  ['business_returns', 'self_employed', 'business returns (2 years)', 'Business tax returns for the last 2 years (1120S or 1065 with K-1s) if you own 25% or more', 'business_return', 90],
  ['pl', 'self_employed', 'a year-to-date P&L', 'A year-to-date profit and loss statement', 'profit_loss', 100],
  ['award', 'award_income', '{income} award letter', 'Your {income} award letter', 'award_letter', 110],
  ['support_order', 'support_income', 'divorce decree or support order', 'The divorce decree or court order, and proof of the last 6 months of payments received', 'divorce_decree', 120],
  ['bank_statements', 'bank_accounts', 'bank statements (2 months)', 'The last 2 months of statements for each bank account, all pages', 'bank_statement', 130],
  ['investment_statements', 'investment_accounts', 'investment/retirement statements', 'The latest statement for each investment or retirement account', 'investment_statement', 140],
  ['gift_letter', 'gift', 'a gift letter', "A signed gift letter (I'll send you the form) and proof of the transfer", 'gift_letter', 150],
  ['bankruptcy', 'bankruptcy', 'bankruptcy discharge papers', 'Your bankruptcy discharge papers', 'bankruptcy_papers', 160],
  ['foreclosure', 'foreclosure', 'foreclosure/short sale papers', 'The closing or completion papers for the foreclosure, short sale or deed in lieu', 'other', 170],
  ['explanation', 'late_or_collection', 'a short letter about the late payment', 'A short letter explaining the late payment or collection', 'explanation_letter', 180],
  ['home_statements', 'owns_home', 'mortgage statements and insurance for homes you own', 'For each home you own: the latest mortgage statement and the homeowners insurance declarations page', 'mortgage_statement', 190],
  ['leases', 'rental_or_dscr', 'current leases', 'A copy of the current lease for each rented home', 'lease', 200],
].map(([key, condition, shortText, fullText, kind, sortOrder]) => ({ key, condition, shortText, fullText, kind, sortOrder, active: true }) as DocRule)

/** Conditions about the whole file rather than one person. */
const FILE_CONDITIONS: DocumentCondition[] = ['owns_home', 'rental_or_dscr']

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

/**
 * What to ask each person for, from how they earn money, what they have and
 * their credit history, by the company's checklist rules (turned-off rules
 * are skipped).
 */
export function documentChecklist(input: ChecklistInput, rules: DocRule[] = DEFAULT_DOCUMENT_RULES): DocGroup[] {
  const doc = input.incomeDocType ?? 'full_doc'
  const active = rules.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder)
  const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m)

  const groups: DocGroup[] = input.people.map((p) => {
    const wage = p.jobs.filter((j) => !j.selfEmployed)
    const selfEmployed = p.jobs.filter((j) => j.selfEmployed)
    const bankStatementIncome = doc === 'bank_statement' && p.jobs.length > 0
    const income1099 = doc === 'form_1099' && p.jobs.length > 0
    const fullDoc = !bankStatementIncome && !income1099 && doc !== 'asset_based' && doc !== 'dscr'
    const has: Record<Exclude<DocumentCondition, 'award_income' | 'owns_home' | 'rental_or_dscr'>, boolean> = {
      everyone: true,
      wage_earner: fullDoc && wage.length > 0,
      self_employed: fullDoc && selfEmployed.length > 0,
      bank_statement_income: bankStatementIncome,
      form_1099_income: income1099,
      asset_based_income: doc === 'asset_based',
      support_income: p.otherIncomes.some((t) => SUPPORT.includes(t)),
      bank_accounts: p.assetTypes.some((t) => BANKABLE.includes(t)),
      investment_accounts: doc !== 'asset_based' && p.assetTypes.some((t) => INVESTMENT.includes(t)),
      gift: p.assetTypes.some((t) => GIFT.includes(t)),
      bankruptcy: p.creditEvents.some((t) => t === 'bankruptcy_ch7' || t === 'bankruptcy_ch13'),
      foreclosure: p.creditEvents.some((t) => t === 'foreclosure' || t === 'short_sale' || t === 'deed_in_lieu'),
      late_or_collection: p.creditEvents.some((t) => t === 'late_payment' || t === 'collection'),
    }
    const values = { each_job: wage.length > 1 ? ' from each job' : '' }
    const items: DocItem[] = active.flatMap((r): DocItem[] => {
      if (FILE_CONDITIONS.includes(r.condition)) return []
      if (r.condition === 'award_income') {
        const types = [...new Set(p.otherIncomes.filter((t) => AWARD_LETTER[t]))]
        return types.map((t) => ({ key: `${r.key}_${t}`, short: fill(r.shortText, { ...values, income: AWARD_LETTER[t]! }), full: fill(r.fullText, { ...values, income: AWARD_LETTER[t]! }), kind: r.kind }))
      }
      return has[r.condition as keyof typeof has] ? [{ key: r.key, short: fill(r.shortText, values), full: fill(r.fullText, values), kind: r.kind }] : []
    })
    return { title: p.firstName, contactId: p.contactId ?? null, items }
  })

  const fileHas: Record<'owns_home' | 'rental_or_dscr', boolean> = {
    owns_home: input.homes.length > 0,
    rental_or_dscr: input.homes.some((h) => h.rented) || doc === 'dscr',
  }
  const fileItems = active.filter((r) => FILE_CONDITIONS.includes(r.condition) && fileHas[r.condition as keyof typeof fileHas]).map((r) => ({ key: r.key, short: r.shortText, full: r.fullText, kind: r.kind }))
  if (fileItems.length) groups.push({ title: HOMES, contactId: null, items: fileItems })
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
      contactId: b.contactId,
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
