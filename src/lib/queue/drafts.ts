// The drafting engine (next build Session 4; docs/plans/next-build.md
// decisions 6 and 8). Works out which reminder drafts belong in the Action
// Queue today; the app saves them and Connor approves each one. Nothing here
// sends anything. Pure functions, no data access.
//
// - Key dates for closed clients whose "Automate reminders" switch is on:
//   birthday, home anniversary, holidays, insurance renewal, first payment and
//   homestead, drafted on the day (or up to 2 days late, so a weekend isn't
//   lost; holidays on the day only), at most 2 a week per person, and only on a channel they agreed to.
// - Condition reminders: one draft to the primary borrower every 3 days while a
//   borrower condition is Outstanding or Requested, never two waiting at once.
//
// Every draft has a source key (action_items.source_key), so the same draft is
// never made twice.

import { addDays, keyDates, type KeyDate, type KeyDateKind } from '@/lib/closed/keyDates'
import type { DraftMessage } from './today'

export type Channel = 'text' | 'email'

export interface DraftPerson {
  contactId: string
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  smsConsent: boolean | null
  emailConsent: boolean | null
  smsOptedOut: boolean
  emailOptedOut: boolean
}

/** A closed loan whose primary borrower has "Automate reminders" on. */
export interface AutomatedLoan {
  loanId: string
  organizationId: string
  closingDate: string | null
  firstPaymentDate: string | null
  insuranceRenewalDate: string | null
  homesteadFiled: boolean | null
  occupancy: string | null
  /** The home's street address, for the anniversary note. */
  street: string | null
  loName: string | null
  borrower: DraftPerson & { birthday: string | null }
}

export interface OpenCondition {
  body: string
  status: 'outstanding' | 'requested'
  /** When it became Outstanding or Requested (YYYY-MM-DD). */
  since: string
}

/** An open file with borrower conditions still waiting. */
export interface ConditionLoan {
  loanId: string
  organizationId: string
  loName: string | null
  borrower: DraftPerson | null
  conditions: OpenCondition[]
}

/** A reminder draft already in the queue (any status), from action_items. */
export interface ExistingDraft {
  loanId: string
  sourceKey: string
  status: 'pending' | 'approved' | 'edited' | 'dismissed'
  dueOn: string | null
  contactId: string | null
}

export interface PlannedDraft {
  loanId: string
  organizationId: string
  sourceKey: string
  title: string
  dueOn: string
  /** The draft, plus who it's for so it can be sent from the queue. */
  payload: DraftMessage & { contactId: string }
}

/** Key dates that are automated (Step D: date reminders only; the thank-you stays a manual follow-up). */
export const AUTOMATED_KINDS: KeyDateKind[] = ['birthday', 'anniversary', 'insurance', 'first_payment', 'homestead', 'holiday']
/** When two compete for the week's 2 places, the more personal date wins. */
const PRIORITY: Record<KeyDateKind, number> = { birthday: 0, anniversary: 1, insurance: 2, first_payment: 3, homestead: 4, holiday: 5, thank_you: 6 }
export const WEEKLY_CAP = 2
/** Days late a key-date draft can still be made (catches a weekend nobody opened the app). */
export const LATE_DAYS = 2
export const CONDITION_EVERY_DAYS = 3
const CONDITION_LIST_MAX = 5
const CONDITION_TEXT_MAX = 120

const KEYDATE_PREFIX = 'keydate:'
const CONDITIONS_PREFIX = 'conditions:'

const signOff = (loName: string | null) => (loName?.trim() ? `\n– ${loName.trim().split(/\s+/)[0]}` : '')

/** The channel to use: one the person agreed to (text first). With `fallback`, any channel we have an address for, if neither was agreed to (the send screen then asks for consent). */
export function pickChannel(p: DraftPerson, fallback = false): Channel | null {
  const textOk = !!p.phone && !p.smsOptedOut
  const emailOk = !!p.email && !p.emailOptedOut
  if (textOk && p.smsConsent === true) return 'text'
  if (emailOk && p.emailConsent === true) return 'email'
  if (!fallback) return null
  if (textOk && p.smsConsent !== false) return 'text'
  if (emailOk && p.emailConsent !== false) return 'email'
  return null
}

const toLine = (p: DraftPerson, channel: Channel) => `${p.firstName} ${p.lastName}`.trim() + (channel === 'text' ? ' (text)' : ' (email)')

const HOLIDAY_GREETING: Record<string, string> = {
  "New Year's Day": 'Happy New Year',
  'Fourth of July': 'Happy Fourth of July',
  Thanksgiving: 'Happy Thanksgiving',
  Christmas: 'Merry Christmas',
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
const longDate = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))

/** The words of one key-date reminder. */
export function keyDateMessage(d: KeyDate, loan: AutomatedLoan): { subject: string; body: string } {
  const first = loan.borrower.firstName.trim() || 'there'
  const sign = signOff(loan.loName)
  switch (d.kind) {
    case 'birthday':
      return { subject: 'Happy birthday!', body: `Happy birthday, ${first}! Hope you have a great day.${sign}` }
    case 'anniversary': {
      const years = loan.closingDate ? Number(d.date.slice(0, 4)) - Number(loan.closingDate.slice(0, 4)) : 0
      const where = loan.street ? ` on ${loan.street}` : ''
      return {
        subject: 'Happy home anniversary!',
        body: `Hi ${first}, happy ${ordinal(years)} home anniversary! Hard to believe it's been ${years === 1 ? 'a year' : `${years} years`} since you closed${where}. If you ever have questions about your mortgage, I'm here.${sign}`,
      }
    }
    case 'holiday': {
      const greeting = HOLIDAY_GREETING[d.label] ?? `Happy ${d.label}`
      return { subject: `${greeting}!`, body: `${greeting}, ${first}! Wishing you and your family a great holiday.${sign}` }
    }
    case 'insurance':
      return {
        subject: 'Your homeowners insurance renews soon',
        body: `Hi ${first}, your homeowners insurance renews in about 30 days. It's a good time to compare quotes, and if your premium changes, your escrow payment can change too. Happy to help if you have questions.${sign}`,
      }
    case 'first_payment':
      return {
        subject: 'Your first mortgage payment',
        body: `Hi ${first}, a quick reminder that your first mortgage payment is due ${loan.firstPaymentDate ? longDate(loan.firstPaymentDate) : 'soon'}. Your servicer's welcome letter explains how to pay. Let me know if anything looks off.${sign}`,
      }
    case 'homestead':
      return {
        subject: 'Time to file your homestead exemption',
        body: `Hi ${first}, happy new year! Now that it's January, you can file your Texas homestead exemption with your county appraisal district. It can lower your property taxes. Let me know if you'd like help.${sign}`,
      }
    case 'thank_you':
      return { subject: 'Thank you!', body: `Hi ${first}, congratulations again on closing, and thank you for trusting me with your loan.${sign}` }
  }
}

/** Person-level dates are keyed by the person, so a client with two loans gets one birthday or holiday draft. */
const keyDateSource = (d: KeyDate, loan: AutomatedLoan) =>
  d.kind === 'birthday' || d.kind === 'holiday' ? `${KEYDATE_PREFIX}${loan.borrower.contactId}:${d.kind}:${d.date}` : `${KEYDATE_PREFIX}${loan.loanId}:${d.kind}:${d.date}`

/**
 * Key-date drafts due today for automated clients. A date can be drafted on
 * the day or up to 2 days late. Each person gets at most 2 key-date drafts in
 * any 7 days (counting drafts already made, whatever happened to them); the
 * rest are skipped. No consent on file = no draft.
 */
export function planKeyDateDrafts(loans: AutomatedLoan[], existing: ExistingDraft[], today: string): PlannedDraft[] {
  const made = new Set(existing.map((e) => e.sourceKey))
  const weekStart = addDays(today, -6)
  const used = new Map<string, number>()
  for (const e of existing) {
    if (e.sourceKey.startsWith(KEYDATE_PREFIX) && e.contactId && e.dueOn && e.dueOn >= weekStart && e.dueOn <= today) used.set(e.contactId, (used.get(e.contactId) ?? 0) + 1)
  }

  const candidates: { draft: PlannedDraft; priority: number }[] = []
  for (const loan of loans) {
    const channel = pickChannel(loan.borrower)
    if (!channel) continue
    const dates = keyDates(
      {
        closingDate: loan.closingDate,
        firstPaymentDate: loan.firstPaymentDate,
        birthday: loan.borrower.birthday,
        insuranceRenewalDate: loan.insuranceRenewalDate,
        homesteadFiled: loan.homesteadFiled,
        occupancy: loan.occupancy,
      },
      addDays(today, -LATE_DAYS),
      LATE_DAYS,
      { holidays: true },
    )
    for (const d of dates) {
      if (!AUTOMATED_KINDS.includes(d.kind)) continue
      // A late holiday greeting reads oddly, so holidays are drafted on the day only.
      if (d.kind === 'holiday' && d.date !== today) continue
      const sourceKey = keyDateSource(d, loan)
      if (made.has(sourceKey) || candidates.some((c) => c.draft.sourceKey === sourceKey)) continue
      const { subject, body } = keyDateMessage(d, loan)
      candidates.push({
        priority: PRIORITY[d.kind],
        draft: {
          loanId: loan.loanId,
          organizationId: loan.organizationId,
          sourceKey,
          title: `${d.label} · ${loan.borrower.firstName} ${loan.borrower.lastName}`.trim(),
          dueOn: d.date,
          payload: { channel, to: toLine(loan.borrower, channel), subject: channel === 'email' ? subject : null, body, contactId: loan.borrower.contactId },
        },
      })
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.draft.dueOn.localeCompare(b.draft.dueOn) || a.draft.sourceKey.localeCompare(b.draft.sourceKey))
  const out: PlannedDraft[] = []
  for (const { draft } of candidates) {
    const count = used.get(draft.payload.contactId) ?? 0
    if (count >= WEEKLY_CAP) continue
    used.set(draft.payload.contactId, count + 1)
    out.push(draft)
  }
  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.sourceKey.localeCompare(b.sourceKey))
}

const shorten = (s: string) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > CONDITION_TEXT_MAX ? `${one.slice(0, CONDITION_TEXT_MAX - 1).trimEnd()}…` : one
}

/** The words of a condition reminder: up to 5 items, then "and N more". */
export function conditionMessage(loan: ConditionLoan, borrower: DraftPerson): { subject: string; body: string } {
  const first = borrower.firstName.trim() || 'there'
  const items = [...loan.conditions].sort((a, b) => a.since.localeCompare(b.since))
  const shown = items.slice(0, CONDITION_LIST_MAX).map((c) => `- ${shorten(c.body)}`)
  const more = items.length - shown.length
  const list = [...shown, ...(more > 0 ? [`- and ${more} more`] : [])].join('\n')
  const what = items.length === 1 ? 'one item' : 'a few items'
  return {
    subject: 'Items still needed for your loan',
    body: `Hi ${first}, a quick reminder that we're still waiting on ${what} for your loan:\n${list}\nSend them over whenever you can. Thank you!${signOff(loan.loName)}`,
  }
}

/**
 * Condition reminder drafts due today. A file gets one when a borrower
 * condition has been Outstanding or Requested for 3 days, then every 3 days
 * after its last reminder, and never while one is still waiting for Connor.
 */
export function planConditionDrafts(loans: ConditionLoan[], existing: ExistingDraft[], today: string): PlannedDraft[] {
  const out: PlannedDraft[] = []
  for (const loan of loans) {
    if (!loan.borrower || loan.conditions.length === 0) continue
    const mine = existing.filter((e) => e.loanId === loan.loanId && e.sourceKey.startsWith(CONDITIONS_PREFIX))
    if (mine.some((e) => e.status === 'pending')) continue
    const last = mine.map((e) => e.dueOn ?? '').sort().at(-1)
    if (last && today < addDays(last, CONDITION_EVERY_DAYS)) continue
    const oldest = loan.conditions.map((c) => c.since).sort()[0]
    if (today < addDays(oldest, CONDITION_EVERY_DAYS)) continue
    const channel = pickChannel(loan.borrower, true)
    if (!channel) continue
    const sourceKey = `${CONDITIONS_PREFIX}${loan.loanId}:${today}`
    if (mine.some((e) => e.sourceKey === sourceKey)) continue
    const { subject, body } = conditionMessage(loan, loan.borrower)
    const n = loan.conditions.length
    out.push({
      loanId: loan.loanId,
      organizationId: loan.organizationId,
      sourceKey,
      title: `Condition reminder (${n} still needed) · ${loan.borrower.firstName} ${loan.borrower.lastName}`.trim(),
      dueOn: today,
      payload: { channel, to: toLine(loan.borrower, channel), subject: channel === 'email' ? subject : null, body, contactId: loan.borrower.contactId },
    })
  }
  return out
}

/** Reads who a queued draft is for (drafts made here carry the contact); null for older drafts. */
export function draftContactId(payload: unknown): string | null {
  return typeof payload === 'object' && payload !== null && typeof (payload as { contactId?: unknown }).contactId === 'string' ? (payload as { contactId: string }).contactId : null
}
