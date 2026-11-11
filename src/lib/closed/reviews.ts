// Review requests after closing (build plan Phase 6): who gets a drafted
// request and when, and the wording. The daily database job
// (draft_review_requests) follows the same rules; these are the tested
// version the screens use. Drafts only: nothing sends without a click.
//
// COMPLIANCE: the wording below is subject to Connor's compliance review. It
// must stay neutral (never "only if you were happy", which is review gating,
// against Google's and the FTC's rules) and offer no incentive for a review.

export type ReviewStatus = 'not_requested' | 'drafted' | 'requested' | 'follow_up_sent' | 'received' | 'skipped'

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  not_requested: 'Not requested',
  drafted: 'Drafted',
  requested: 'Requested',
  follow_up_sent: 'Follow-up sent',
  received: 'Received',
  skipped: 'Skipped',
}

export const DEFAULT_REVIEW_TEXT = "Hi {first}, it's {lo}. Congrats again on closing! If you have a minute, would you leave a quick review of your experience? {link} Thank you!"
export const DEFAULT_REVIEW_EMAIL =
  "Hi {first},\n\nCongratulations again on closing, and thank you for letting us help with your loan.\n\nIf you have a minute, would you leave a quick review of your experience? It helps other families find us.\n\n{link}\n\nThank you!\n{lo}"
export const DEFAULT_REVIEW_SUBJECT = 'Thank you, {first}!'

export interface ReviewSettings {
  enabled: boolean
  companyLink: string | null
  secondLink: string | null
  daysAfterFunding: number
  followUp: boolean
  followUpDays: number
  /** Loans funded before this day get no automatic draft (only the manual button). */
  draftsFrom: string
}

export interface ReviewLoan {
  fundingDate: string | null
  closingDate: string | null
  status: ReviewStatus
  skip: boolean
  requestedAt: string | null
  /** The person: consent and opt-outs on each channel. */
  smsOk: boolean
  emailOk: boolean
  /** The latest review request to this person on another loan (repeat clients), if any. */
  lastAskedElsewhereAt: string | null
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const monthsBefore = (iso: string, months: number) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}

/** Text when they agreed to texts, else email when they agreed to email, else none. */
export const reviewChannel = (l: Pick<ReviewLoan, 'smsOk' | 'emailOk'>): 'text' | 'email' | null => (l.smsOk ? 'text' : l.emailOk ? 'email' : null)

export type Eligibility = { draft: true; channel: 'text' | 'email' } | { draft: false; why: string }

/** Should the first request be drafted today? */
export function firstRequest(l: ReviewLoan, s: ReviewSettings, today: string): Eligibility {
  if (!s.enabled || !s.companyLink) return { draft: false, why: 'Reviews are off, or no review link is set' }
  if (l.skip) return { draft: false, why: "Marked \"Don't ask for a review\"" }
  if (l.status !== 'not_requested') return { draft: false, why: 'Already drafted or asked' }
  const funded = l.fundingDate ?? l.closingDate
  if (!funded) return { draft: false, why: 'No funding or closing date' }
  if (funded < s.draftsFrom) return { draft: false, why: 'Funded before review requests started (use Request review)' }
  if (addDays(funded, s.daysAfterFunding) > today) return { draft: false, why: `Waits until ${addDays(funded, s.daysAfterFunding)}` }
  if (l.lastAskedElsewhereAt && l.lastAskedElsewhereAt.slice(0, 10) > monthsBefore(today, 12)) return { draft: false, why: 'Asked for a review in the last 12 months' }
  const channel = reviewChannel(l)
  if (!channel) return { draft: false, why: 'No text or email consent' }
  return { draft: true, channel }
}

/** Should the one follow-up be drafted today? Never more than 2 asks per loan. */
export function followUpRequest(l: ReviewLoan, s: ReviewSettings, today: string): Eligibility {
  if (!s.enabled || !s.followUp) return { draft: false, why: 'Follow-ups are off' }
  if (l.skip) return { draft: false, why: "Marked \"Don't ask for a review\"" }
  if (l.status !== 'requested' || !l.requestedAt) return { draft: false, why: l.status === 'follow_up_sent' ? 'Already followed up (2 asks)' : 'Not requested yet' }
  if (addDays(l.requestedAt, s.followUpDays) > today) return { draft: false, why: `Waits until ${addDays(l.requestedAt, s.followUpDays)}` }
  const channel = reviewChannel(l)
  if (!channel) return { draft: false, why: 'No text or email consent' }
  return { draft: true, channel }
}

/** The link line: the LO's own link, else the company's, with the second link as "or here". */
export function reviewLink(s: Pick<ReviewSettings, 'companyLink' | 'secondLink'>, personalLink: string | null): string {
  const main = personalLink?.trim() || s.companyLink?.trim() || ''
  return s.secondLink?.trim() ? `${main} or here: ${s.secondLink.trim()}` : main
}

/** Fills {first}, {lo} and {link}. */
export function fillReview(template: string, v: { first: string; lo: string; link: string }): string {
  return template.replaceAll('{first}', v.first).replaceAll('{lo}', v.lo).replaceAll('{link}', v.link).trim()
}

/** Wording that gates or bribes reviews is refused (compliance). */
export function reviewWordingProblem(text: string): string | null {
  if (/\b(only if|if you (were|are) (happy|satisfied)|positive review|5[- ]star|five[- ]star)\b/i.test(text)) return "Keep it neutral: don't ask only happy clients or for a positive or 5-star review."
  if (/\b(gift card|discount|reward|raffle|drawing|chance to win|\$\d)/i.test(text)) return 'No incentives for reviews.'
  return null
}
