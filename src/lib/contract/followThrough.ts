// After the contract: deadlines become tasks, the people in it join the
// file's team, and intro emails are drafted for Connor to approve. Pure
// functions; the Contract section shows what they return.

import { complianceIssues, emailSignature, type Signer } from '../../../supabase/functions/assistant/followUp'
import type { ContactRole } from '../../../supabase/functions/assistant/contract'
import { formatIsoDate } from '@/lib/dates'
import type { DraftMessage } from '@/lib/queue/today'

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const iso = (d: Date) => d.toISOString().slice(0, 10)
const at = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`)

export function addDays(isoDate: string, days: number): string {
  const d = at(isoDate)
  d.setUTCDate(d.getUTCDate() + days)
  return iso(d)
}

/** The nth weekday (0 = Sunday) of a month; n = -1 for the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1, 12))
    const offset = (weekday - first.getUTCDay() + 7) % 7
    return iso(new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7, 12)))
  }
  const last = new Date(Date.UTC(year, month + 1, 0, 12))
  const back = (last.getUTCDay() - weekday + 7) % 7
  return iso(new Date(Date.UTC(year, month + 1, -back, 12)))
}

/** The 11 federal legal public holidays on their actual dates (5 U.S.C. 6103). */
export function federalHolidays(year: number): string[] {
  const fixed = (m: number, d: number) => iso(new Date(Date.UTC(year, m, d, 12)))
  return [
    fixed(0, 1), // New Year's Day
    nthWeekday(year, 0, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    nthWeekday(year, 4, 1, -1), // Memorial Day
    fixed(5, 19), // Juneteenth
    fixed(6, 4), // Independence Day
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 1, 2), // Columbus Day
    fixed(10, 11), // Veterans Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving
    fixed(11, 25), // Christmas
  ]
}

/**
 * The last day the borrower can receive the Closing Disclosure: three
 * business days before closing, where (for this rule) every day counts
 * except Sundays and federal holidays. A reminder only; Arive's dates are
 * the official ones.
 */
export function closingDisclosureDue(closingDate: string): string {
  let day = closingDate
  let counted = 0
  while (counted < 3) {
    day = addDays(day, -1)
    const d = at(day)
    if (d.getUTCDay() !== 0 && !federalHolidays(d.getUTCFullYear()).includes(day)) counted++
  }
  return day
}

// ---------------------------------------------------------------------------
// Deadline tasks
// ---------------------------------------------------------------------------

export interface ContractDates {
  contractDate: string | null
  optionEndDate: string | null
  financingDeadline: string | null
  surveyDeadline: string | null
  closingDate: string | null
}

export interface DeadlineTask {
  /** Saved as tasks.source_key, so a changed date updates the same task. */
  key: string
  title: string
  dueOn: string
}

/** One task per contract deadline that has a date. */
export function deadlineTasks(d: ContractDates): DeadlineTask[] {
  const tasks: (DeadlineTask | null)[] = [
    // TREC: earnest money and the option fee are due within 3 days after the effective date.
    d.contractDate ? { key: 'contract:earnest_money', title: 'Confirm title received the earnest money and option fee', dueOn: addDays(d.contractDate, 3) } : null,
    d.optionEndDate ? { key: 'contract:option_end', title: 'Option period ends (5:00 p.m.)', dueOn: d.optionEndDate } : null,
    d.surveyDeadline ? { key: 'contract:survey', title: 'Survey due to the buyer', dueOn: d.surveyDeadline } : null,
    d.financingDeadline ? { key: 'contract:financing', title: "Financing approval deadline: approval in hand, or the buyer's notice sent", dueOn: d.financingDeadline } : null,
    d.closingDate ? { key: 'contract:closing_disclosure', title: 'Closing Disclosure received by the borrower (3 business days before closing)', dueOn: closingDisclosureDue(d.closingDate) } : null,
  ]
  return tasks.filter((t): t is DeadlineTask => t !== null)
}

export interface ExistingTask {
  id: string
  sourceKey: string | null
  title: string
  dueOn: string | null
  completedAt: string | null
}

export interface TaskPlanRow {
  task: DeadlineTask
  status: 'new' | 'moved' | 'set' | 'done'
  existing: ExistingTask | null
}

/** Compares the deadlines with the file's tasks. Done tasks are left alone. */
export function planTasks(wanted: DeadlineTask[], existing: ExistingTask[]): TaskPlanRow[] {
  return wanted.map((task) => {
    const match = existing.find((e) => e.sourceKey === task.key) ?? null
    const status = !match ? 'new' : match.completedAt ? 'done' : match.dueOn !== task.dueOn ? 'moved' : 'set'
    return { task, status, existing: match }
  })
}

// ---------------------------------------------------------------------------
// People in the contract → the file's team
// ---------------------------------------------------------------------------

export type TeamRoleFromContract = 'buyer_agent' | 'listing_agent' | 'title' | 'escrow_officer'

/** Buyers and sellers aren't team roles (the buyer is the borrower). */
export function teamRoleFor(role: ContactRole): TeamRoleFromContract | null {
  return role === 'buyer_agent' || role === 'listing_agent' || role === 'title' || role === 'escrow_officer' ? role : null
}

export interface Person {
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
}

const digits = (phone: string | null) => (phone ?? '').replace(/\D/g, '').slice(-10)
const loose = (s: string | null) => (s ?? '').toLowerCase().replace(/\(test\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Same person: same email, same 10-digit phone, or (with neither on one side) the same name. */
export function samePerson(a: Person, b: Person): boolean {
  if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) return true
  if (digits(a.phone).length === 10 && digits(a.phone) === digits(b.phone)) return true
  return !!loose(a.name) && loose(a.name) === loose(b.name)
}

export interface PastTeamMember extends Person {
  loanId: string
  borrowerName: string
}

/** The same person on another file, matched by email or phone only (names are too often shared). */
export function findOnOtherFiles(contact: Person, past: PastTeamMember[], thisLoanId: string): PastTeamMember | null {
  return (
    past.find(
      (p) =>
        p.loanId !== thisLoanId &&
        ((!!contact.email && !!p.email && contact.email.trim().toLowerCase() === p.email.trim().toLowerCase()) || (digits(contact.phone).length === 10 && digits(contact.phone) === digits(p.phone))),
    ) ?? null
  )
}

/** Fills gaps in what the contract gave from the same person's record on another file. */
export function mergePerson(fromContract: Person, known: Person | null): Person {
  return {
    name: fromContract.name || known?.name || null,
    company: fromContract.company || known?.company || null,
    email: fromContract.email || known?.email || null,
    phone: fromContract.phone || known?.phone || null,
  }
}

// ---------------------------------------------------------------------------
// Intro emails
// ---------------------------------------------------------------------------

export interface IntroFacts {
  buyerNames: string
  propertyAddress: string | null
  dates: ContractDates
  signer: Signer
}

const greeting = (p: Person) => {
  const first = p.name && loose(p.name) !== loose(p.company) ? p.name.trim().split(/\s+/)[0] : null
  return first ? `Hi ${first},` : 'Hello,'
}

function dateLines(d: ContractDates): string[] {
  const lines: [string, string | null][] = [
    ['Effective date', d.contractDate],
    ['Option period ends', d.optionEndDate],
    ['Financing approval deadline', d.financingDeadline],
    ['Closing', d.closingDate],
  ]
  return lines.filter(([, v]) => v).map(([label, v]) => `- ${label}: ${formatIsoDate(v)}`)
}

/**
 * The intro email for one team member, in Connor's voice, with the email
 * signature added. Built from the file (no AI), so it's the same every time
 * and passes the same compliance checks as assistant drafts.
 */
export function introEmail(role: TeamRoleFromContract, person: Person, facts: IntroFacts): DraftMessage {
  const where = facts.propertyAddress ?? 'the purchase'
  const me = facts.signer.loName ? `${facts.signer.loName} with ${facts.signer.companyName}` : facts.signer.companyName
  const dates = dateLines(facts.dates)
  const timeline = dates.length ? ['Here are the dates I am working from:', ...dates, ''] : []
  let subject: string
  let middle: string[]
  if (role === 'listing_agent' || role === 'buyer_agent') {
    subject = `Lender intro: ${where}`
    middle = [
      role === 'listing_agent' ? `I'm ${me}, the lender for ${facts.buyerNames} on ${where}.` : `I'm ${me}, working with our mutual client ${facts.buyerNames} on ${where}.`,
      '',
      ...timeline,
      "I'll keep you posted at each step: appraisal, approval and clear to close. If anything changes on your side, just let me know.",
    ]
  } else {
    subject = `New order: ${where} (buyer ${facts.buyerNames})`
    middle = [
      `I'm ${me}, the lender for ${facts.buyerNames} on ${where}.`,
      '',
      ...timeline,
      'Could you send the title commitment and your fee invoice when they are ready, and let me know once you receive the earnest money and option fee?',
    ]
  }
  const body = [greeting(person), '', ...middle, '', 'Thank you,', '', emailSignature(facts.signer)].join('\n')
  return { channel: 'email', to: [person.name, person.email].filter(Boolean).join(' · '), subject, body }
}

/** Compliance problems in an intro (the same rules as assistant drafts, without the signature line). */
export function introIssues(draft: DraftMessage, signer: Signer): string[] {
  return complianceIssues('email', { subject: draft.subject, body: draft.body.replace(emailSignature(signer), '') })
}
