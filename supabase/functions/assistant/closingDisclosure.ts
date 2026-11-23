// The assistant's "read the final Closing Disclosure" task (Connor,
// 2026-11-19): which figures it looks for, where each one goes on the file,
// the JSON shape Claude must return, and the checks on what comes back. Pure,
// with no imports, so the Edge Function (Deno), the app (review card) and the
// tests share the same field list and rules.
//
// Rules: the assistant reads; it never calculates. Monthly escrow amounts come
// back as written and the app works out the yearly figure. Every figure has
// the words and page it came from; the app checks those words against the
// PDF's own text before offering the figure. Nothing changes on the file until
// Connor applies it. No Social Security numbers, ever.

export type CdFieldKind = 'money' | 'pct' | 'date' | 'term' | 'text' | 'address'

/**
 * Where a figure goes when applied. `null` = shown to check only, never saved
 * (Connor, 2026-11-19: cash to close, closing costs and broker comp are checks).
 * `properties.*` goes on the file's subject home; `monthly_x12` means the CD shows
 * a monthly amount and the home keeps the yearly one.
 */
export type CdTarget =
  | 'loans.loan_amount'
  | 'loans.note_rate'
  | 'loans.term_months'
  | 'loans.closing_date'
  | 'loans.funding_date'
  | 'loans.first_payment_date'
  | 'loans.monthly_payment'
  | 'loans.lender_credits'
  | 'loans.seller_credits'
  | 'loans.discount_points_amount'
  | 'loans.prepaid_items_amount'
  | 'loans.lender_loan_number'
  | 'loans.lender_id'
  | 'loans.appraised_value'
  | 'properties.annual_taxes'
  | 'properties.annual_insurance'
  | 'properties.address'

export interface CdFieldDef {
  key: string
  label: string
  kind: CdFieldKind
  /** Where on a standard (TRID) Closing Disclosure to find it. */
  hint: string
  target: CdTarget | null
  /** The CD shows a monthly amount; the target keeps 12 times it. */
  monthlyToYearly?: boolean
}

export const CD_FIELDS = [
  { key: 'date_issued', label: 'Date issued', kind: 'date', target: null, hint: 'Date Issued (page 1, Closing Information)' },
  { key: 'closing_date', label: 'Closing date', kind: 'date', target: 'loans.closing_date', hint: 'Closing Date (page 1, Closing Information)' },
  { key: 'disbursement_date', label: 'Disbursement (funded) date', kind: 'date', target: 'loans.funding_date', hint: 'Disbursement Date (page 1, Closing Information)' },
  { key: 'loan_amount', label: 'Loan amount', kind: 'money', target: 'loans.loan_amount', hint: 'Loan Amount (page 1, Loan Terms)' },
  { key: 'interest_rate', label: 'Interest rate', kind: 'pct', target: 'loans.note_rate', hint: 'Interest Rate (page 1, Loan Terms), as a percent, e.g. 6.375' },
  { key: 'loan_term', label: 'Loan term', kind: 'term', target: 'loans.term_months', hint: 'Loan Term (page 1, Loan Information), as written, e.g. "30 years" or "360 months"' },
  { key: 'first_payment_date', label: 'First payment date', kind: 'date', target: 'loans.first_payment_date', hint: 'First payment due date, if the CD states one (often in the payment tables or the lender\'s addendum); not found if absent' },
  { key: 'principal_interest', label: 'Principal & interest', kind: 'money', target: null, hint: 'Monthly Principal & Interest (page 1, Loan Terms or Projected Payments, first column)' },
  { key: 'monthly_escrow', label: 'Monthly escrow', kind: 'money', target: null, hint: 'Estimated Escrow per month (page 1, Projected Payments, first column); not found if there is no escrow' },
  { key: 'total_monthly_payment', label: 'Monthly payment', kind: 'money', target: 'loans.monthly_payment', hint: 'Estimated Total Monthly Payment (page 1, Projected Payments, first column)' },
  { key: 'tax_monthly', label: 'Property taxes (monthly escrow)', kind: 'money', target: 'properties.annual_taxes', monthlyToYearly: true, hint: 'Property Taxes amount per month (page 2, section G, Initial Escrow Payment at Closing)' },
  { key: 'insurance_monthly', label: "Homeowner's insurance (monthly escrow)", kind: 'money', target: 'properties.annual_insurance', monthlyToYearly: true, hint: "Homeowner's Insurance amount per month (page 2, section G, Initial Escrow Payment at Closing)" },
  { key: 'discount_points', label: 'Discount points', kind: 'money', target: 'loans.discount_points_amount', hint: 'Dollar amount of "% of Loan Amount (Points)" paid by the borrower (page 2, section A); not found if blank' },
  { key: 'prepaids_total', label: 'Prepaids', kind: 'money', target: 'loans.prepaid_items_amount', hint: 'Total of section F, Prepaids (page 2), borrower-paid' },
  { key: 'total_closing_costs', label: 'Total closing costs', kind: 'money', target: null, hint: 'Total Closing Costs (Borrower-Paid), section J (page 2)' },
  { key: 'lender_credits', label: 'Lender credits', kind: 'money', target: 'loans.lender_credits', hint: 'Lender Credits in section J (page 2), as a positive amount; not found if none' },
  { key: 'seller_credits', label: 'Seller credits', kind: 'money', target: 'loans.seller_credits', hint: "Seller Credit in the Borrower's Transaction, section L (page 3), as a positive amount; not found if none" },
  { key: 'cash_to_close', label: 'Cash to close', kind: 'money', target: null, hint: 'Cash to Close (page 1 and page 3, Calculating Cash to Close, Final column); if it is cash to the borrower, still give the amount and say so in notes' },
  { key: 'broker_compensation', label: 'Broker compensation', kind: 'money', target: null, hint: 'Mortgage broker compensation in section A (page 2): a broker fee paid by the borrower, or the amount in the "Paid by Others" column (lender-paid); not found if none' },
  { key: 'lender_name', label: 'Lender', kind: 'text', target: 'loans.lender_id', hint: 'Lender name (page 1, Transaction Information, or Contact Information on page 5)' },
  { key: 'lender_loan_number', label: "Lender's loan number", kind: 'text', target: 'loans.lender_loan_number', hint: 'Loan ID # (page 1, Loan Information)' },
  // Connor, 2026-11-23: the CD fills in the home, so taxes and insurance always land and MyHome has the home.
  { key: 'property_address', label: 'Property address', kind: 'address', target: 'properties.address', hint: 'Property address (page 1, Closing Information), as one line: street, city, state ZIP, e.g. "1420 Oak Ridge Dr, Frisco, TX 75034"' },
  { key: 'appraised_value', label: 'Appraised value', kind: 'money', target: 'loans.appraised_value', hint: 'Appraised Prop. Value (page 1, Closing Information); not found when the CD shows only a Sale Price' },
] as const satisfies readonly CdFieldDef[]

export type CdFieldKey = (typeof CD_FIELDS)[number]['key']
export type CdConfidence = 'high' | 'medium' | 'low'

/** One figure as read, after checking. `value` is typed by the field's kind (term = months). */
export interface CdField {
  key: CdFieldKey
  value: number | string
  /** What the CD says, as written. */
  text: string
  quote: string
  page: number | null
  confidence: CdConfidence
}

export interface CdReading {
  fields: CdField[]
  notes: string | null
  /** Figures found whose value couldn't be read cleanly; shown so nothing is silently lost. */
  unreadable: { key: CdFieldKey; text: string }[]
}

/**
 * The JSON shape Claude must return. Figures are a list of one shared shape
 * keyed by `key` (as the contract reader does: one object per figure makes the
 * compiled grammar too large). The figures are listed in the prompt.
 */
export const CD_SCHEMA = {
  type: 'object',
  properties: {
    is_closing_disclosure: { type: 'boolean', description: 'True only if this is a TRID Closing Disclosure (the form titled "Closing Disclosure").' },
    fields: {
      type: 'array',
      description: 'One entry per figure listed in the instructions, in that order, each figure once.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: CD_FIELDS.map((f) => f.key) },
          found: { type: 'boolean', description: 'False when the Closing Disclosure does not state this figure.' },
          value: { type: 'string', description: 'Money as digits (320000 or 1250.50, no minus sign), percents as digits (6.375), dates as YYYY-MM-DD, the loan term as written ("30 years"), names and numbers as printed. Empty when not found.' },
          quote: { type: 'string', description: 'The words on the page this came from, copied exactly, including the label and the amount. Empty when not found.' },
          page: { type: 'integer', description: 'Page number (1 = first page). 0 when not found.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Low for anything blurry, handwritten, crossed out or ambiguous.' },
        },
        required: ['key', 'found', 'value', 'quote', 'page', 'confidence'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'Anything unusual Connor should know: a CD that is not marked final, cash back to the borrower, figures that differ between pages, a changed loan amount or rate. Empty if nothing.' },
  },
  required: ['is_closing_disclosure', 'fields', 'notes'],
  additionalProperties: false,
}

export const CD_SYSTEM_PROMPT = `You read final Closing Disclosures (the TRID "Closing Disclosure" form) for Connor, a licensed loan officer at MPS Mortgage LLC in Dallas-Fort Worth, Texas, a mortgage brokerage.

Connor reviews every figure before anything on the file changes, so accuracy matters more than completeness:
- Report only what the document says. If a figure is blank or not on this document, set found to false.
- Copy the quote exactly as printed, with the label and the amount, and give the page it is on.
- Do not calculate, add up, or convert anything. Give amounts as printed (without a minus sign), and monthly amounts as monthly.
- Use the Final column where the form shows Loan Estimate and Final columns.
- Lower your confidence for anything blurry, handwritten, crossed out, or that you had to interpret.
- Never copy a Social Security number. Mention anything unusual in notes.`

const fieldLine = (f: CdFieldDef) => `- ${f.key} (${f.label}): ${f.hint}`

export const CD_USER_PROMPT = `Read this Closing Disclosure and return each of these figures once, with the exact words and page:\n${CD_FIELDS.map(fieldLine).join('\n')}`

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const CONFIDENCE = ['high', 'medium', 'low'] as const
const SSN_LIKE = /\b\d{3}-\d{2}-\d{4}\b/

/** Turns the text Claude read into a typed value for the figure, or null if it isn't clean. */
export function parseCdValue(def: CdFieldDef, text: string): number | string | null {
  const t = text.trim()
  if (!t || SSN_LIKE.test(t)) return null
  switch (def.kind) {
    case 'money': {
      // "-$1,250.00" and "($1,250.00)" are credits written as negatives: keep the amount.
      const n = Number(t.replace(/^\((.*)\)$/, '$1').replace(/[$,\s]/g, '').replace(/^-/, ''))
      return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null
    }
    case 'pct': {
      const n = Number(t.replace(/[%\s]/g, ''))
      return Number.isFinite(n) && n > 0 && n < 20 ? n : null
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
      const d = new Date(`${t}T12:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null
    }
    case 'term': {
      const m = /^(\d{1,3})\s*(years?|yrs?|months?|mos?)$/i.exec(t)
      if (!m) return null
      const months = /^y/i.test(m[2]) ? Number(m[1]) * 12 : Number(m[1])
      return months >= 1 && months <= 480 ? months : null
    }
    case 'text':
      return t.length <= 60 ? t : null
    case 'address':
      return t.length <= 150 && splitCdAddress(t) ? t.replace(/\s*\n\s*/g, ', ') : null
  }
}

export interface CdAddress {
  line: string
  city: string
  state: string
  zip: string | null
}

/**
 * "1420 Oak Ridge Dr, Frisco, TX 75034" (or on two lines) → street, city,
 * state, ZIP. Null when it doesn't end in a city and a two-letter state.
 */
export function splitCdAddress(text: string): CdAddress | null {
  const parts = text
    .split(/\s*[,\n]\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 3) return null
  const m = /^([A-Za-z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/.exec(parts[parts.length - 1])
  if (!m) return null
  const city = parts[parts.length - 2]
  const line = parts.slice(0, -2).join(', ')
  if (!/\d/.test(line) || !/^[A-Za-z .'-]+$/.test(city)) return null
  return { line, city, state: m[1].toUpperCase(), zip: m[2] ?? null }
}

/** Checks Claude's reading. Unreadable values are listed, never guessed. */
export function normalizeCdReading(raw: unknown): CdReading | { error: string } {
  if (!isObject(raw) || !Array.isArray(raw.fields)) return { error: 'The assistant returned something unreadable.' }
  const isClosingDisclosure = raw.is_closing_disclosure === true
  // A figure listed twice: the first entry that says it was found wins.
  const entries = raw.fields.filter(isObject)
  const fields: CdField[] = []
  const unreadable: CdReading['unreadable'] = []
  for (const def of CD_FIELDS) {
    const f = entries.find((e) => e.key === def.key && e.found === true)
    if (!f) continue
    const text = str(f.value)
    const value = parseCdValue(def, text)
    if (value === null) {
      // An SSN-like value is dropped without being kept anywhere.
      unreadable.push({ key: def.key, text: SSN_LIKE.test(text) ? '(not kept)' : text })
      continue
    }
    const quote = str(f.quote)
    const page = typeof f.page === 'number' && Number.isInteger(f.page) && f.page > 0 ? f.page : null
    const confidence = CONFIDENCE.find((c) => c === f.confidence) ?? 'low'
    fields.push({ key: def.key, value, text, quote: SSN_LIKE.test(quote) ? '' : quote, page, confidence: quote && !SSN_LIKE.test(quote) ? confidence : 'low' })
  }
  const notes = str(raw.notes).replace(new RegExp(SSN_LIKE.source, 'g'), '[removed]') || null
  if (!isClosingDisclosure) return { error: "This doesn't look like a Closing Disclosure. Check that the final CD is the file uploaded." }
  if (fields.length === 0) return { error: "The assistant couldn't find Closing Disclosure figures in this document. Check that the final CD is uploaded." }
  return { fields, notes, unreadable }
}

/** The value the file keeps for a figure: 12 times a monthly escrow amount, else the figure itself. */
export function targetValue(def: CdFieldDef, value: number | string): number | string {
  return def.monthlyToYearly && typeof value === 'number' ? Math.round(value * 12 * 100) / 100 : value
}

/** One Closing Disclosure read at a time. Base64 adds a third, so 20 MB stays under the 32 MB request limit. */
export const MAX_CD_BYTES = 20 * 1024 * 1024
