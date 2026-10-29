// The assistant's "read the contract" task: which terms it looks for, the
// JSON shape it must return, and the checks on what comes back. Pure, with
// no imports, so the Edge Function (Deno) and the app (review screen and
// tests) share the same field list and rules.
//
// The assistant reads; it never calculates. Deadlines written as "within N
// days after the Effective Date" come back as day counts, and the app works
// out the dates.

export type FieldKind = 'money' | 'date' | 'days' | 'choice' | 'yes_no' | 'text'

export interface ContractFieldDef {
  key: string
  label: string
  kind: FieldKind
  /** What to look for, in the words of the Texas (TREC) forms. */
  hint: string
  choices?: readonly string[]
}

export const CONTRACT_FIELDS = [
  { key: 'sales_price', label: 'Sales price', kind: 'money', hint: 'Sales Price (paragraph 3C, the total)' },
  { key: 'effective_date', label: 'Effective date', kind: 'date', hint: 'Effective Date filled in on the execution page (by the broker or title)' },
  { key: 'closing_date', label: 'Closing date', kind: 'date', hint: 'Closing date (paragraph 9A, "on or before")' },
  { key: 'earnest_money', label: 'Earnest money', kind: 'money', hint: 'Earnest money (paragraph 5)' },
  { key: 'option_fee', label: 'Option fee', kind: 'money', hint: 'Option Fee (paragraph 5)' },
  { key: 'option_period_days', label: 'Option period', kind: 'days', hint: 'Option period: number of days after the Effective Date (paragraph 5)' },
  { key: 'financing_type', label: 'Loan type', kind: 'choice', choices: ['conventional', 'fha', 'va', 'usda_rural', 'other'], hint: 'Type of financing in the Third Party Financing Addendum' },
  { key: 'financing_amount', label: 'Financing amount', kind: 'money', hint: 'Loan amount in the Third Party Financing Addendum (excluding any financed MI or funding fee)' },
  { key: 'financing_approval_days', label: 'Buyer approval period', kind: 'days', hint: 'Buyer Approval: number of days after the Effective Date (Third Party Financing Addendum)' },
  { key: 'survey_days', label: 'Survey period', kind: 'days', hint: 'Days after the Effective Date to deliver a new survey (paragraph 6C), if a new survey is required' },
  { key: 'seller_concessions', label: 'Seller concessions', kind: 'money', hint: "Amount the seller pays toward the buyer's expenses (paragraph 12A(1)(b)); a percent becomes the dollar amount only if written" },
  { key: 'title_policy_paid_by', label: 'Title policy paid by', kind: 'choice', choices: ['seller', 'buyer'], hint: "Owner's title policy paid at Seller's or Buyer's expense (paragraph 6A)" },
  { key: 'possession', label: 'Possession', kind: 'choice', choices: ['closing_and_funding', 'temporary_lease'], hint: 'Possession (paragraph 10): upon closing and funding, or under a temporary lease' },
  { key: 'hoa_addendum', label: 'Mandatory HOA', kind: 'yes_no', hint: 'Is the Addendum for Property Subject to Mandatory Membership in a Property Owners Association attached or checked?' },
  { key: 'property_address', label: 'Property address', kind: 'text', hint: 'Property address (paragraph 2)' },
] as const satisfies readonly ContractFieldDef[]

export type ContractFieldKey = (typeof CONTRACT_FIELDS)[number]['key']
export type Confidence = 'high' | 'medium' | 'low'

export const CONTACT_ROLES = ['buyer', 'seller', 'buyer_agent', 'listing_agent', 'title', 'escrow_officer'] as const
export type ContactRole = (typeof CONTACT_ROLES)[number]

/** One term as read, after checking. `value` is typed by the field's kind. */
export interface ExtractedField {
  key: ContractFieldKey
  value: number | string | boolean
  /** What the contract says, as written. */
  text: string
  quote: string
  page: number | null
  confidence: Confidence
}

export interface ExtractedContact {
  role: ContactRole
  name: string
  company: string | null
  email: string | null
  phone: string | null
  quote: string
  page: number | null
}

export interface ContractReading {
  fields: ExtractedField[]
  contacts: ExtractedContact[]
  notes: string | null
  /** Terms the assistant found but whose value couldn't be read cleanly; shown so nothing is silently lost. */
  unreadable: { key: ContractFieldKey; text: string }[]
}

/**
 * The JSON shape Claude must return (enforced by structured outputs, then checked again here).
 * Terms are a list of one shared shape, keyed by `key`, not one object per term:
 * fifteen copies of the term shape made the compiled grammar too large for the API.
 * The terms themselves are listed in the prompt (CONTRACT_USER_PROMPT).
 */
export const CONTRACT_SCHEMA = {
  type: 'object',
  properties: {
    fields: {
      type: 'array',
      description: 'One entry per term listed in the instructions, in that order, each term once.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: CONTRACT_FIELDS.map((f) => f.key) },
          found: { type: 'boolean', description: 'False when the contract does not state this term.' },
          value: { type: 'string', description: 'Money as digits (305000 or 305000.50), dates as YYYY-MM-DD, days as a whole number, choices and yes/no exactly as listed. Empty when not found.' },
          quote: { type: 'string', description: 'The words on the page this came from, copied exactly. Empty when not found.' },
          page: { type: 'integer', description: 'Page number in the documents as given (1 = first page). 0 when not found.' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Low for handwriting, strike-throughs, blanks or anything ambiguous.' },
        },
        required: ['key', 'found', 'value', 'quote', 'page', 'confidence'],
        additionalProperties: false,
      },
    },
    contacts: {
      type: 'array',
      description: 'People and companies named in the contract: buyers, sellers, both agents, title company and escrow officer. Skip anyone not named.',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: [...CONTACT_ROLES] },
          name: { type: 'string', description: 'Person, or the company if no person is named.' },
          company: { type: 'string', description: 'Brokerage or title company; empty if none.' },
          email: { type: 'string', description: 'Empty if not written.' },
          phone: { type: 'string', description: 'Empty if not written.' },
          quote: { type: 'string' },
          page: { type: 'integer' },
        },
        required: ['role', 'name', 'company', 'email', 'phone', 'quote', 'page'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'Anything unusual Connor should know: handwritten changes, special provisions, missing initials or signatures, addenda that are referenced but not included. Empty if nothing.' },
  },
  required: ['fields', 'contacts', 'notes'],
  additionalProperties: false,
}

export const CONTRACT_SYSTEM_PROMPT = `You read executed residential purchase contracts for Connor, a licensed loan officer at MPS Mortgage LLC in Dallas-Fort Worth, Texas. Most are TREC One to Four Family Residential Contracts (Resale) with addenda such as the Third Party Financing Addendum.

Your reading is reviewed by Connor field by field before anything is saved, so accuracy matters more than completeness:
- Report only what the documents say. If a term is blank, crossed out without a replacement, or not in these documents, set found to false.
- Copy the quote exactly as printed or written, and give the page it is on.
- Do not calculate. If a deadline is written as a number of days, return the number of days, not a date.
- Lower your confidence for handwriting, strike-throughs, initials-only changes, or anything you had to interpret.
- When a later addendum or amendment changes a term, use the changed value and quote the change.
- Mention in notes anything unusual: handwritten changes, special provisions, missing signatures or initials, or addenda that are referenced but not included.`

const termLine = (f: ContractFieldDef) => `- ${f.key} (${f.label}): ${f.hint}${f.choices ? ` (one of: ${f.choices.join(', ')})` : f.kind === 'yes_no' ? ' (yes or no)' : ''}`

export const CONTRACT_USER_PROMPT = `Read these contract documents and return each of these terms once, with quotes and pages, and the people named in them:\n${CONTRACT_FIELDS.map(termLine).join('\n')}`

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const CONFIDENCE = ['high', 'medium', 'low'] as const

/** Turns the text Claude read into a typed value for the field, or null if it isn't clean. */
export function parseFieldValue(def: ContractFieldDef, text: string): number | string | boolean | null {
  const t = text.trim()
  switch (def.kind) {
    case 'money': {
      const n = Number(t.replace(/[$,\s]/g, ''))
      return t && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
      const d = new Date(`${t}T12:00:00Z`)
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null
    }
    case 'days': {
      const n = Number(t)
      return /^\d+$/.test(t) && n <= 365 ? n : null
    }
    case 'choice':
      return def.choices?.includes(t.toLowerCase()) ? t.toLowerCase() : null
    case 'yes_no':
      return /^yes$/i.test(t) ? true : /^no$/i.test(t) ? false : null
    case 'text':
      return t || null
  }
}

/** Checks Claude's reading. Unreadable values are listed, never guessed. */
export function normalizeReading(raw: unknown): ContractReading | { error: string } {
  if (!isObject(raw) || !Array.isArray(raw.fields)) return { error: 'The assistant returned something unreadable.' }
  // A term listed twice: the first entry that says it was found wins.
  const entries = raw.fields.filter(isObject)
  const fields: ExtractedField[] = []
  const unreadable: ContractReading['unreadable'] = []
  for (const def of CONTRACT_FIELDS) {
    const f = entries.find((e) => e.key === def.key && e.found === true)
    if (!f) continue
    const text = str(f.value)
    const value = parseFieldValue(def, text)
    if (value === null) {
      unreadable.push({ key: def.key, text })
      continue
    }
    const page = typeof f.page === 'number' && Number.isInteger(f.page) && f.page > 0 ? f.page : null
    const confidence = CONFIDENCE.find((c) => c === f.confidence) ?? 'low'
    fields.push({ key: def.key, value, text, quote: str(f.quote), page, confidence: str(f.quote) ? confidence : 'low' })
  }
  const contacts = (Array.isArray(raw.contacts) ? raw.contacts : []).filter(isObject).flatMap((c): ExtractedContact[] => {
    const role = CONTACT_ROLES.find((r) => r === c.role)
    const name = str(c.name)
    if (!role || !name) return []
    const page = typeof c.page === 'number' && Number.isInteger(c.page) && c.page > 0 ? c.page : null
    return [{ role, name, company: str(c.company) || null, email: str(c.email) || null, phone: str(c.phone) || null, quote: str(c.quote), page }]
  })
  if (fields.length === 0 && contacts.length === 0) return { error: "The assistant couldn't find contract terms in these documents. Check that the executed contract is uploaded." }
  return { fields, contacts, notes: str(raw.notes) || null, unreadable }
}

/** Documents sent in one reading. Base64 adds a third, so 20 MB of files stays under the 32 MB request limit. */
export const MAX_READ_BYTES = 20 * 1024 * 1024
