// Cleans up what the mps.mortgage forms send, before it reaches the
// database. Accepts the same fields the old app's intake accepted
// (first_name, phone, loan_purpose, purchase_price, "$450k"...), so the
// website only needs a new address and secret. Pure, with no imports, so the
// Edge Function (Deno) and the tests (Vitest) share it.
//
// The website (checked 2026-11-02) sends { form_type, payload } from every
// form. Its multi-step form fills unanswered questions with the word "empty",
// sends a down payment as a dollar amount or a percent (down_payment_mode),
// credit as a range ("700-739", "Below 620"), refinance home value as
// current_value, and posts again after each step with the same lead_id.
// Its loan-sweet-intake function forwards borrower forms flat (source
// "mps_mortgage") and reshapes partner inquiries for /partner: contact_type,
// brokerage, and consent only as a line in notes.

export type LoanPurpose = 'purchase' | 'refinance_rate_term' | 'refinance_cash_out' | 'heloc' | 'heloan' | 'investment_dscr'

export interface IntakeLead {
  kind: 'lead' | 'partner'
  firstName: string
  lastName: string
  email: string | null
  /** 10 digits. */
  phone: string | null
  purpose: LoanPurpose
  purchasePrice: number | null
  downPayment: number | null
  estimatedValue: number | null
  loanBalance: number | null
  cashOut: number | null
  creditScore: number | null
  timeline: string | null
  /** The text-message consent box: true, false, or null when the form has none. */
  smsConsent: boolean | null
  /** The website's id for one person's trip through its multi-step form (the same on every step). */
  formLeadId: string | null
  source: string
  formType: string | null
  assignedToEmail: string | null
  /** The website's own id for the submission, so a re-send isn't saved twice. */
  externalId: string | null
  /** utm_source, utm_campaign, referrer, landing page... */
  tracking: Record<string, string>
  /** Everything that was sent, minus anything sensitive. */
  answers: Record<string, unknown>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** "$450k" → 450000, "1.2m" → 1200000, "450,000" → 450000. Null when it isn't a clean amount. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
  const t = text(v).toLowerCase().replace(/[$,\s]/g, '')
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(t)
  if (!m) return null
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1)
  return Math.round(n * 100) / 100
}

/** Ten digits, dropping a leading US 1. Null when it isn't a US phone number. */
export function normalizePhone(v: unknown): string | null {
  let d = text(v).replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}

export function normalizeEmail(v: unknown): string | null {
  const t = text(v).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}

/**
 * Plain-language purposes from the forms ("Cash-out refi", "Buy a home",
 * "HELOC") to LOSuite's. The occupancy answer ("Investment property") counts
 * too.
 */
export function parsePurpose(v: unknown, formType: string | null, occupancy?: unknown): LoanPurpose {
  const t = `${text(v)} ${text(formType)} ${text(occupancy)}`.toLowerCase()
  if (/heloc/.test(t)) return 'heloc'
  if (/heloan|home equity loan|second (lien|mortgage)/.test(t)) return 'heloan'
  if (/home[\s_-]?equity/.test(t)) return 'heloc'
  if (/dscr|invest|rental|hard[\s_-]?money|flip/.test(t)) return 'investment_dscr'
  if (/cash[\s-]?out|consolidat|access (my )?equity/.test(t)) return 'refinance_cash_out'
  if (/refi|refinanc|rate[\s/-]?term|lower (my )?(rate|payment)/.test(t)) return 'refinance_rate_term'
  return 'purchase'
}

/** "700-739" → 700, "Excellent (740+)" → 740, "720" → 720, "Below 620" → 619. */
export function parseCreditScore(v: unknown): number | null {
  const t = text(v)
  const m = /\b([3-8]\d{2})\b/.exec(t)
  const below = m !== null && /\b(below|under|less than)\b|</i.test(t.slice(0, m.index))
  const n = m ? Number(m[1]) - (below ? 1 : 0) : null
  return n !== null && n >= 300 && n <= 850 ? n : null
}

/** Field names that may hold something LOSuite must never store (SSNs, account numbers, passwords). */
const SENSITIVE_KEY = /(^|_)(ssn|social(_security)?(_number)?|sin|tax_?id|tin|itin|account(_?(no|num|number))?|acct(_?(no|num|number))?|routing(_?(no|num|number))?|password|pin|card_?(no|num|number)|cvv|cvc)$/
const keyName = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[\s-]+/g, '_')
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g

/** Drops sensitive fields and blanks anything shaped like an SSN, at any depth. */
export function sanitize(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(SSN, '[removed]')
  if (Array.isArray(v)) return v.map(sanitize)
  if (isObject(v)) return Object.fromEntries(Object.entries(v).filter(([k]) => !SENSITIVE_KEY.test(keyName(k))).map(([k, x]) => [k, sanitize(x)]))
  return v
}

/** Blank, or the website's word for a question nobody answered. */
const isBlank = (v: unknown) => v === undefined || v === null || text(v) === '' || text(v).toLowerCase() === 'empty'

/** The first non-empty value among a field's spellings (snake_case, camelCase and old names). */
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (!isBlank(o[k])) return o[k]
  return undefined
}

/** A checkbox: true, false, or null when it wasn't on the form. */
const yesNo = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  const t = text(v).toLowerCase()
  return /^(true|yes|y|1|on)$/.test(t) ? true : /^(false|no|n|0|off)$/.test(t) ? false : null
}

const TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer', 'landing_page', 'gclid', 'fbclid']

/**
 * Turns a form submission into a clean lead, or a plain-English reason it
 * can't be used. Accepts the payload at the top level or under "payload"
 * (how the website's function wraps it).
 */
export function normalizeLead(body: unknown, kind: 'lead' | 'partner'): IntakeLead | { error: string } {
  if (!isObject(body)) return { error: 'The request body must be a JSON object.' }
  const raw = isObject(body.payload) ? { ...body.payload, form_type: body.form_type ?? body.payload.form_type } : body
  // Unanswered questions ("empty") aren't kept.
  const o = Object.fromEntries(Object.entries(sanitize(raw) as Record<string, unknown>).filter(([, v]) => typeof v !== 'string' || !isBlank(v)))

  const email = normalizeEmail(pick(o, 'email', 'email_address'))
  const phone = normalizePhone(pick(o, 'phone', 'phone_number', 'mobile', 'cell'))
  if (!email && !phone) return { error: 'An email or phone number is required.' }

  let firstName = text(pick(o, 'first_name', 'firstName', 'fname'))
  let lastName = text(pick(o, 'last_name', 'lastName', 'lname'))
  if (!firstName) {
    const full = text(pick(o, 'name', 'full_name', 'fullName')).split(/\s+/).filter(Boolean)
    firstName = full[0] ?? ''
    lastName = lastName || full.slice(1).join(' ')
  }
  if (!firstName) firstName = email ? email.split('@')[0] : 'Web lead'

  const formType = text(pick(o, 'form_type', 'formType')) || null
  // The website's partner form is "partner_inquiry", whichever address it's sent to.
  if (formType === 'partner_inquiry') kind = 'partner'

  // Under contract, the contract price is the price; the open house form sends the listing price.
  const purchasePrice = parseMoney(pick(o, 'contract_price', 'purchase_price', 'purchasePrice', 'price', 'home_price', 'target_price', 'listing_price', 'listingPrice'))
  // The multi-step form asks "a dollar amount or a percentage?"
  const downMode = text(o.down_payment_mode).toLowerCase()
  let downPayment = parseMoney(pick(o, 'down_payment', 'downPayment', 'down_payment_value'))
  if (downMode === 'percent') {
    const pct = parseMoney(pick(o, 'down_payment_value', 'down_payment'))
    downPayment = pct !== null && pct <= 100 && purchasePrice !== null ? Math.round((purchasePrice * pct) / 100) : null
  } else if (downMode === 'unsure') downPayment = null
  const tracking = Object.fromEntries(
    TRACKING_KEYS.flatMap((k) => {
      const v = text(o[k] ?? (isObject(o.attribution) ? o.attribution[k] : undefined) ?? (isObject(o.utm) ? o.utm[k.replace('utm_', '')] : undefined))
      return v ? [[k, v.slice(0, 500)]] : []
    }),
  )

  return {
    kind,
    firstName: firstName.slice(0, 100),
    lastName: lastName.slice(0, 100),
    email,
    phone,
    purpose: parsePurpose(pick(o, 'loan_purpose', 'loanPurpose', 'purpose', 'refinance_goal', 'product_interest', 'loan_interest', 'goal'), formType, o.occupancy),
    purchasePrice,
    downPayment,
    estimatedValue: parseMoney(pick(o, 'estimated_value', 'home_value', 'property_value', 'homeValue', 'current_value', 'current_home_value')),
    loanBalance: parseMoney(pick(o, 'loan_balance', 'mortgage_balance', 'current_balance', 'current_home_balance', 'balance_owed')),
    cashOut: parseMoney(pick(o, 'cash_out', 'cash_out_amount', 'cashOut')),
    creditScore: parseCreditScore(pick(o, 'credit_score', 'creditScore', 'credit_range', 'creditRange', 'credit_score_range', 'credit', 'credit_estimate')),
    timeline: text(pick(o, 'timeline', 'timeframe', 'when')).slice(0, 200) || null,
    // The website's partner relay sends consent only as a line in notes ("SMS consent: yes").
    smsConsent: yesNo(o.sms_consent) ?? yesNo(/\bSMS consent:\s*(yes|no)\b/i.exec(text(o.notes))?.[1]),
    formLeadId: text(pick(o, 'lead_id')).slice(0, 200) || null,
    source: (text(pick(o, 'lead_source', 'leadSource', 'source')) || 'mps.mortgage website').slice(0, 200),
    formType,
    assignedToEmail: normalizeEmail(pick(o, 'assigned_to_email', 'assignedToEmail')),
    externalId: text(pick(o, 'external_id', 'externalId', 'submission_id')).slice(0, 200) || null,
    tracking,
    answers: o,
  }
}

/** Compares the secret without leaking how much of it matched. */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 16) return false
  let diff = given.length ^ expected.length
  for (let i = 0; i < Math.max(given.length, expected.length); i++) diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0)
  return diff === 0
}
