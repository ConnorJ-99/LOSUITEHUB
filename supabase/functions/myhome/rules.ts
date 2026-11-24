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
  /** "Conventional 30-year" (closed files' header), or null. */
  loanLine?: string | null
}

const MORTGAGE_WORDS: Record<string, string> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA' }

/**
 * The loan in a few words: "Conventional 30-year", "FHA 15-year", a home equity
 * line, or the program's name for anything else ("DSCR 30-year"). Null when
 * nothing is known. (Connor, 2026-11-20: closed borrowers see their own loan
 * type and term.)
 */
export function loanLine(v: { purpose: string; mortgageType: string | null; termMonths: number | null; programName: string | null }): string | null {
  if (v.purpose === 'heloc') return 'Home equity line'
  const term = v.termMonths && v.termMonths % 12 === 0 ? `${v.termMonths / 12}-year` : v.termMonths ? `${v.termMonths}-month` : null
  const kind = (v.mortgageType && MORTGAGE_WORDS[v.mortgageType]) || v.programName?.trim() || (v.purpose === 'heloan' ? 'Home equity loan' : null)
  if (!kind) return term ? `${term} loan` : null
  return term ? `${kind} ${term}` : kind
}

/** The 13 counties Quick Links has an appraisal district for. */
const COUNTIES = ['Dallas', 'Tarrant', 'Collin', 'Denton', 'Rockwall', 'Kaufman', 'Ellis', 'Johnson', 'Parker', 'Wise', 'Hood', 'Hunt', 'Grayson']

/** "Collin County", " collin ", "COLLIN CO." → "Collin"; anything else → null. */
export function countyName(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/\s+(county|co)$/, '').trim()
  return COUNTIES.find((c) => c.toLowerCase() === t) ?? null
}

/**
 * The FHFA area for a county (section 5): Fort Worth (23104) for Tarrant,
 * Johnson, Parker and Wise; Dallas (19124) for Dallas, Collin, Denton, Ellis,
 * Kaufman, Rockwall and Hunt; Hood has no index of its own and uses Fort
 * Worth, labeled the nearest area (Connor, 2026-11-20). Anything else: none.
 */
export function areaForCounty(county: string | null): { series: '19124' | '23104'; area: 'Dallas' | 'Fort Worth'; nearest: boolean } | null {
  if (!county) return null
  if (['Tarrant', 'Johnson', 'Parker', 'Wise'].includes(county)) return { series: '23104', area: 'Fort Worth', nearest: false }
  if (county === 'Hood') return { series: '23104', area: 'Fort Worth', nearest: true }
  if (['Dallas', 'Collin', 'Denton', 'Ellis', 'Kaufman', 'Rockwall', 'Hunt'].includes(county)) return { series: '19124', area: 'Dallas', nearest: false }
  return null
}

/** Zillow's search for the home's address (opens their page for it, or the closest match). */
export function zillowUrl(a: { line: string; city: string | null; state: string | null; zip: string | null }): string {
  const full = [a.line, a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter((x) => x && x.trim()).join(', ')
  return `https://www.zillow.com/homes/${encodeURIComponent(full)}_rb/`
}

/** Asks from a closed file. "Ask Connor to check my value" is Step A; refi and equity checks come in Step C. */
export type AskKind = 'value_check' | 'refi_check' | 'equity_check'
export const ASK_KINDS: AskKind[] = ['value_check', 'refi_check', 'equity_check']

/** What `closed` returns for a closed file. */
export interface MyHomeClosed {
  home: { line: string; city: string | null; state: string | null; zip: string | null; county: string | null } | null
  /** The day it closed (closing date, else funding date). */
  closedOn: string | null
  loanLine: string | null
  monthlyPayment: number | null
  /** The home's yearly taxes and insurance (for the payment breakdown; the CD fills them). */
  annualTaxes: number | null
  annualInsurance: number | null
  insuranceRenewsOn: string | null
  homesteadFiled: boolean | null
  /** Connor's own figure on the home, and the day he set it (null when unknown). */
  value: { amount: number; on: string | null } | null
  /**
   * Step B: what the page needs for the index estimate (src/lib/calc/homeValue.ts):
   * the starting value, the index when it closed and now, and the area. Null
   * outside the covered counties, or with no purchase price / appraised value.
   */
  index: {
    base: number
    baseKind: 'purchase' | 'appraised'
    baseIndex: number
    latestIndex: number
    latestQuarter: string
    loadedOn: string
    area: 'Dallas' | 'Fort Worth'
    nearest: boolean
  } | null
  /** Step B: the loan's own terms, for its estimated balance today (mortgageToday). Null when any is missing. */
  balance: { loanAmount: number; ratePct: number; termMonths: number; firstPaymentDate: string | null; closingDate: string | null } | null
  links: { label: string; url: string }[]
  /** Extra payments the borrower logged (not removed), oldest first. */
  extraPaid: { id: string; paidOn: string; amount: number }[]
  /** Documents Connor published on the closed file. */
  documents: { id: string; name: string; publishedAt: string }[]
  /** When each ask was last made and not yet handled (within a day, asking again does nothing new). */
  asked: Partial<Record<AskKind, string>>
  lo: MyHomeLo
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
/** A file asked for in one view (open, closed) that is now in another. */
export const NOT_OPEN = "This loan has moved on. Refresh the page to see where it stands."
export const TURNED_OFF = 'This MyHome account is turned off. Contact your loan officer to turn it back on.'
export const STAFF_EMAIL = 'That email is an MPS-HQ team login. Ask your loan officer to use your personal email for MyHome.'


// ---------------------------------------------------------------------------
// Nurture goals (Phase 1, docs/plans/nurture-goals.md)
// ---------------------------------------------------------------------------

export type GoalKind = 'savings' | 'credit' | 'debt'
export type GoalStatus = 'not_started' | 'in_progress' | 'reported_complete' | 'verified_complete'
/** What a borrower can send for a goal. */
export type GoalUpdateKind = 'balance' | 'contribution' | 'score' | 'payment' | 'note' | 'reported_complete'
export const GOAL_UPDATE_KINDS: GoalUpdateKind[] = ['balance', 'contribution', 'score', 'payment', 'note', 'reported_complete']

export interface MyHomeGoal {
  id: string
  kind: GoalKind
  label: string
  debtType: string | null
  start: number
  target: number
  current: number | null
  currentAt: string | null
  /** Shown only as "verified" once the LO verified it. */
  verified: number | null
  targetDate: string | null
  status: GoalStatus
  paused: boolean
  history: { kind: string; amount: number | null; after: number | null; note: string | null; on: string; byBorrower: boolean }[]
}

/** What the nurture action returns for a Nurture file. */
export interface MyHomeNurture {
  goals: MyHomeGoal[]
  lo: MyHomeLo
}
