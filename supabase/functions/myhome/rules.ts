// MyHome (Stage 1, docs/plans/myhome.md): the rules the `myhome` Edge
// Function follows and the shapes it returns. Pure, with no imports, so the
// function (Deno), the /myhome page and the tests share it.

export const CODE_LENGTH = 6
/** Wrong tries (code or email) in an hour before an account locks for the hour. */
export const WRONG_LIMIT = 5

export const isLocked = (wrongInLastHour: number) => wrongInLastHour >= WRONG_LIMIT

/** The personal link's token: /myhome?invite=<64 hex>. */
export const INVITE_TOKEN = /^[0-9a-f]{64}$/

/** Compares two codes without stopping at the first different digit. */
export function sameCode(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const normEmail = (e: string | null | undefined) => e?.trim().toLowerCase() || null

/** Loose on purpose: something@something.something, no spaces. */
export const emailLooksValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

/** The typed code with spaces and dashes taken out, or null when it isn't 6 digits. */
export function cleanCode(typed: string): string | null {
  const c = typed.replace(/[\s-]/g, '')
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(c) ? c : null
}

export type AccountStatus = 'invited' | 'active' | 'off'

export interface AccountMatch {
  accountId: string
  status: AccountStatus
  contactEmail: string | null
}

/**
 * The one account a typed email signs in to: an invited or active account whose
 * person has that email. None, or two people sharing it, means no sign-in (the
 * page says the same thing as a wrong code, so it never tells who has an account).
 */
export function pickAccount(rows: AccountMatch[], typed: string): { accountId: string } | { problem: 'none' | 'shared' } {
  const t = normEmail(typed)
  const live = rows.filter((r) => r.status !== 'off' && !!t && normEmail(r.contactEmail) === t)
  if (live.length === 0) return { problem: 'none' }
  if (live.length > 1) return { problem: 'shared' }
  return { accountId: live[0].accountId }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type MyHomeView = 'active' | 'nurture' | 'closed'

/** Which MyHome view a file gets from its stage; lost files aren't shown. */
export function viewFor(stage: string): MyHomeView | null {
  if (stage === 'lost') return null
  if (stage === 'nurture') return 'nurture'
  if (stage === 'closed') return 'closed'
  return 'active'
}

const PURPOSE_WORDS: Record<string, string> = {
  purchase: 'Purchase',
  refinance_rate_term: 'Refinance',
  refinance_cash_out: 'Cash-out refinance',
  heloc: 'Home equity line',
  heloan: 'Home equity loan',
  investment_dscr: 'Investment',
}

export const purposeWords = (purpose: string) => PURPOSE_WORDS[purpose] ?? 'Loan'

/** The street part of an address: "1420 Oak Ridge Dr, Frisco" → "1420 Oak Ridge Dr". */
export const streetOf = (address: string | null) => (address ? address.split(',')[0].trim() : null)

export interface MyHomeFile {
  loanId: string
  view: MyHomeView
  purpose: string
  stage: string
  /** The subject home's address line, if the file has one. */
  address: string | null
  city: string | null
  closingDate: string | null
  createdAt: string
}

/** The chip on the file switcher: "Purchase · 1420 Oak Ridge Dr", "88 Willow Bend Ct · Closed", "Getting ready to buy". */
export function fileLabel(f: Pick<MyHomeFile, 'view' | 'purpose' | 'address'>): string {
  const street = streetOf(f.address)
  if (f.view === 'nurture') return f.purpose === 'purchase' ? 'Getting ready to buy' : `Getting ready · ${purposeWords(f.purpose)}`
  if (f.view === 'closed') return street ? `${street} · Closed` : `${purposeWords(f.purpose)} · Closed`
  return street ? `${purposeWords(f.purpose)} · ${street}` : purposeWords(f.purpose)
}

const VIEW_ORDER: Record<MyHomeView, number> = { active: 0, nurture: 1, closed: 2 }

/** Open files first (newest first), then getting-ready files, then closed loans (latest closing first). */
export function orderFiles<T extends Pick<MyHomeFile, 'view' | 'closingDate' | 'createdAt'>>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    if (a.view !== b.view) return VIEW_ORDER[a.view] - VIEW_ORDER[b.view]
    if (a.view === 'closed') return (b.closingDate ?? '').localeCompare(a.closingDate ?? '') || b.createdAt.localeCompare(a.createdAt)
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/** The loan officer's card (same shape as the portal's). */
export interface MyHomeLo {
  name: string
  nmls: string | null
  phone: string | null
  email: string | null
  photoUrl: string | null
}

/** What `me` returns to a signed-in borrower. */
export interface MyHomeMe {
  firstName: string
  files: (MyHomeFile & { label: string })[]
  lo: MyHomeLo | null
}

/** The same words whether the email or the code is wrong, so the page never tells who has an account. */
export const NO_MATCH = "That email and code don't match. Check the MyHome email from MPS Mortgage, or ask your loan officer."
export const LOCKED = 'Too many tries. Please wait an hour, or contact your loan officer.'
export const LINK_GONE = 'This MyHome link is no longer active. Ask your loan officer for your MyHome code.'
export const NOT_SIGNED_IN = 'Please sign in again.'
/** A file that isn't theirs (or doesn't exist): the same words either way. */
export const NOT_YOURS = "That loan isn't in your MyHome."
/** Stage 2 serves open files only; nurture and closed views come later. */
export const NOT_OPEN = "This loan isn't open anymore. Refresh the page to see where it stands."
export const TURNED_OFF = 'This MyHome account is turned off. Contact your loan officer to turn it back on.'
export const STAFF_EMAIL = 'That email is an MPS-HQ team login. Ask your loan officer to use your personal email for MyHome.'
