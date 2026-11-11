// Shared estimates (build plan Phase 7): the rules the estimate-view Edge
// Function follows, and the frozen copy's shape. Pure, with no imports, so the
// function (Deno), the public page and the tests share it.
//
// COMPLIANCE: the disclaimer, and showing APR beside the rate, are subject to
// Connor's compliance review.

/** One option as the borrower sees it, frozen when the link was made. */
export interface ShareOption {
  estimateId: string
  /** "Option 1"… */
  name: string
  /** The program (never the lender). */
  program: string
  ratePct: number | null
  aprPct: number | null
  /** Positive = points paid, negative = a credit. */
  pointsPct: number
  lenderCredit: number
  loanAmount: number
  downPayment: number
  principalAndInterest: number
  /** Principal and interest, taxes, insurance, MI, HOA… */
  payment: { lines: { label: string; amount: number }[]; total: number }
  cash: { title: string; lines: { label: string; amount: number; minus?: boolean }[]; total: number }
  /** Sections A–H. */
  sections: { letter: string; title: string; total: number; rows: { label: string; amount: number }[] }[]
  /** The estimate PDF made when sharing (in the file's documents). */
  pdfDocumentId: string | null
}

export interface ShareSnapshot {
  /** When the numbers were priced (the "Rates as of"). */
  asOf: string
  options: ShareOption[]
}

/** The loan officer's card on the page. */
export interface ShareLo {
  name: string
  nmls: string | null
  phone: string | null
  email: string | null
  photoUrl: string | null
}

export const WRONG_EMAIL_LIMIT = 5
export const SESSION_HOURS = 24
export const COMPANY_NMLS = '2501110'

/** Lowercased and trimmed; null when empty. */
export const normEmail = (e: string | null | undefined) => e?.trim().toLowerCase() || null

/** The typed email matches one of the borrowers on the file (any borrower, a co-borrower too). */
export function emailMatches(typed: string, borrowerEmails: (string | null)[]): boolean {
  const t = normEmail(typed)
  return !!t && borrowerEmails.some((e) => normEmail(e) === t)
}

export type ShareState = 'open' | 'expired' | 'revoked'

export function shareState(s: { expiresAt: string; revokedAt: string | null }, now: Date): ShareState {
  if (s.revokedAt) return 'revoked'
  return Date.parse(s.expiresAt) <= now.getTime() ? 'expired' : 'open'
}

/** Too many wrong emails in the last hour: the link waits. */
export const isLocked = (wrongInLastHour: number) => wrongInLastHour >= WRONG_EMAIL_LIMIT

export function sessionValid(s: { sessionHash: string | null; sessionExpiresAt: string | null }, presentedHash: string | null, now: Date): boolean {
  return !!s.sessionHash && !!presentedHash && s.sessionHash === presentedHash && !!s.sessionExpiresAt && Date.parse(s.sessionExpiresAt) > now.getTime()
}

/** "Nov 11, 2026 at 9:05 AM" (Central). */
export function asOfText(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
  return `${date} at ${time}`
}

export function disclaimer(asOfIso: string): string {
  return `Rates as of ${asOfText(asOfIso)}. Estimates only, not a commitment to lend or a rate lock; rates and fees change daily and depend on final approval. MPS Mortgage LLC, NMLS #${COMPANY_NMLS}. Equal Housing Opportunity.`
}

export const expiredText = (loName: string) => `These rates have expired. Contact ${loName} for updated numbers.`
export const NOT_VERIFIED = "We couldn't verify that email."
