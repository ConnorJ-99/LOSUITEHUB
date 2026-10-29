// The bulk client import: which columns the CSV has, how each value is read,
// and which rows can go to the database. Pure and tested; the database
// (import_clients) does the matching and saving.

import { normalizeEmail, normalizePhone, parseMoney } from '../../../supabase/functions/lead-intake/normalize'
import type { MortgageType, Occupancy } from '@/lib/api/types'
import type { LoanPurpose, PipelineStage } from '@/lib/pipeline/stages'
import { parseCsv, toCsv } from './csv'

export type ColumnKey =
  | 'lo_email' | 'first_name' | 'last_name' | 'stage' | 'email' | 'phone' | 'birthday'
  | 'mailing_address' | 'mailing_city' | 'mailing_state' | 'mailing_zip' | 'sms_ok' | 'email_ok'
  | 'co_first_name' | 'co_last_name' | 'co_email' | 'co_phone'
  | 'loan_purpose' | 'loan_type' | 'loan_amount' | 'purchase_price' | 'rate' | 'term_years' | 'monthly_payment'
  | 'lender' | 'program' | 'closing_date' | 'first_payment_date'
  | 'property_address' | 'property_city' | 'property_state' | 'property_zip' | 'occupancy' | 'estimated_value'
  | 'insurance_carrier' | 'insurance_renewal_date' | 'homestead_filed'
  | 'agent_name' | 'agent_email' | 'agent_phone' | 'title_company'
  | 'referral_source' | 'arive_loan_number' | 'lost_reason' | 'old_site_id' | 'notes'

export interface ColumnInfo {
  key: ColumnKey
  group: string
  /** Required on every row ("when" says if it depends on the row). */
  required?: boolean
  when?: string
  format: string
  example: string
  /** Other header names that mean the same column. When a file has several, the first one with a value in that row wins. */
  aliases?: string[]
}

/** Every column, in template order. */
export const COLUMNS: readonly ColumnInfo[] = [
  { key: 'lo_email', group: 'Required', required: true, format: 'The loan officer\'s LOSuite login email', example: 'connor@mps.mortgage', aliases: ['loan officer email', 'lo', 'loan officer', 'assigned to email', 'assigned lo email', 'assigned to', 'primary loan officer email'] },
  { key: 'first_name', group: 'Required', required: true, format: 'Text', example: 'Jane', aliases: ['first', 'borrower first name', 'primary borrower first name'] },
  { key: 'last_name', group: 'Required', required: true, format: 'Text', example: 'TEST', aliases: ['last', 'borrower last name', 'primary borrower last name'] },
  { key: 'stage', group: 'Required', required: true, format: 'Lead, Contacted, Pre-Qualified, Pre-Approved, Home Search, Under Contract (or Application), Processing, Clear to Close, Closed, Nurture or Lost', example: 'Closed', aliases: ['status', 'pipeline stage', 'stage name'] },
  { key: 'email', group: 'Person', when: 'Email or phone on every current client', format: 'name@example.com', example: 'jane.test@example.com', aliases: ['email address', 'borrower email', 'primary borrower email'] },
  { key: 'phone', group: 'Person', when: 'Email or phone on every current client', format: 'Any format, 10 digits', example: '(214) 555-0100', aliases: ['phone number', 'cell', 'mobile', 'cell phone', 'borrower phone', 'primary borrower cell phone', 'primary borrower phone'] },
  { key: 'birthday', group: 'Person', format: 'Date: 03/15/1985 or 1985-03-15', example: '03/15/1985', aliases: ['dob', 'date of birth', 'birth date', 'primary borrower birthday'] },
  { key: 'mailing_address', group: 'Person', format: 'Street address', example: '100 Example St', aliases: ['mailing street'] },
  { key: 'mailing_city', group: 'Person', format: 'Text', example: 'Dallas' },
  { key: 'mailing_state', group: 'Person', format: 'Two letters', example: 'TX' },
  { key: 'mailing_zip', group: 'Person', format: '5 digits', example: '75201' },
  { key: 'sms_ok', group: 'Person', format: 'Yes or No (OK to text)', example: 'Yes', aliases: ['sms consent', 'text ok', 'ok to text'] },
  { key: 'email_ok', group: 'Person', format: 'Yes or No (OK to email)', example: 'Yes', aliases: ['email consent', 'ok to email'] },
  { key: 'co_first_name', group: 'Co-borrower', format: 'Text', example: 'John', aliases: ['coborrower first name', 'co borrower first name'] },
  { key: 'co_last_name', group: 'Co-borrower', format: 'Text', example: 'TEST', aliases: ['coborrower last name', 'co borrower last name'] },
  { key: 'co_email', group: 'Co-borrower', format: 'name@example.com', example: '', aliases: ['coborrower email', 'co borrower email'] },
  { key: 'co_phone', group: 'Co-borrower', format: 'Any format, 10 digits', example: '', aliases: ['coborrower phone', 'co borrower phone', 'co-borrower cell phone'] },
  { key: 'loan_purpose', group: 'Loan', format: 'Purchase, Refinance, Cash-Out Refinance, HELOC, HELOAN or Investment/DSCR (blank = Purchase)', example: 'Purchase', aliases: ['purpose', 'transaction type'] },
  { key: 'loan_type', group: 'Loan', format: 'Conventional, FHA, VA, USDA or Other', example: 'FHA', aliases: ['mortgage type', 'loan program type'] },
  { key: 'loan_amount', group: 'Loan', format: 'Money: 300000, $300,000 or 300k', example: '300000', aliases: ['base loan amount', 'amount'] },
  { key: 'purchase_price', group: 'Loan', format: 'Money', example: '315000', aliases: ['sales price', 'price'] },
  { key: 'rate', group: 'Loan', format: 'Percent: 6.125 or 6.125%', example: '6.125', aliases: ['interest rate', 'note rate'] },
  { key: 'term_years', group: 'Loan', format: 'Years: 30 (360 months also works)', example: '30', aliases: ['term', 'loan term', 'amortization term'] },
  { key: 'monthly_payment', group: 'Loan', format: 'Money: the full payment at closing (PITI)', example: '2450', aliases: ['piti', 'payment', 'total payment', 'total monthly payment', 'total housing payment'] },
  { key: 'lender', group: 'Loan', format: 'Text', example: 'Sample Lender', aliases: ['lender name', 'investor'] },
  { key: 'program', group: 'Loan', format: 'Text', example: 'FHA 30 Fixed', aliases: ['loan program', 'product', 'loan product'] },
  { key: 'closing_date', group: 'Loan', when: 'Required when the stage is Closed', format: 'Date: 03/15/2024 or 2024-03-15', example: '03/15/2024', aliases: ['close date', 'closed date', 'funded date', 'funding date', 'docs signed / loan closed', 'loan closed', 'loan funded', 'firm closing date'] },
  { key: 'first_payment_date', group: 'Loan', format: 'Date', example: '05/01/2024', aliases: ['first payment'] },
  { key: 'property_address', group: 'Property', when: 'Closed rows with no email or phone need it', format: 'Street address', example: '123 Sample Ln', aliases: ['address', 'subject address', 'street', 'property street', 'subject address line 1'] },
  { key: 'property_city', group: 'Property', format: 'Text', example: 'Frisco', aliases: ['city', 'subject city'] },
  { key: 'property_state', group: 'Property', format: 'Two letters (blank = TX)', example: 'TX', aliases: ['state', 'subject state'] },
  { key: 'property_zip', group: 'Property', format: '5 digits', example: '75034', aliases: ['zip', 'zip code', 'postal code', 'subject zip', 'subject zip code', 'subject postal code'] },
  { key: 'occupancy', group: 'Property', format: 'Primary, Second Home or Investment (blank = Primary)', example: 'Primary', aliases: ['occupancy type'] },
  { key: 'estimated_value', group: 'Property', format: 'Money', example: '340000', aliases: ['home value', 'current value', 'appraised value'] },
  { key: 'insurance_carrier', group: 'Property', format: 'Text', example: 'Sample Insurance Co', aliases: ['insurance company', 'hoi carrier'] },
  { key: 'insurance_renewal_date', group: 'Property', format: 'Date', example: '03/15/2025', aliases: ['insurance renewal', 'hoi renewal date'] },
  { key: 'homestead_filed', group: 'Property', format: 'Yes or No', example: 'No', aliases: ['homestead', 'homestead exemption'] },
  { key: 'agent_name', group: 'People', format: 'Text', example: 'Agent TEST', aliases: ['realtor', 'buyer agent', 'referring agent', 'realtor name'] },
  { key: 'agent_email', group: 'People', format: 'name@example.com', example: '', aliases: ['realtor email'] },
  { key: 'agent_phone', group: 'People', format: 'Any format, 10 digits', example: '', aliases: ['realtor phone'] },
  { key: 'title_company', group: 'People', format: 'Text', example: 'Sample Title', aliases: ['title'] },
  { key: 'referral_source', group: 'Other', format: 'Text', example: 'Past client', aliases: ['source', 'lead source', 'referral'] },
  { key: 'arive_loan_number', group: 'Other', format: 'Text', example: '', aliases: ['arive number', 'loan number', 'arive loan id'] },
  { key: 'lost_reason', group: 'Other', when: 'Required when the stage is Lost', format: 'Text', example: '', aliases: ['reason lost'] },
  { key: 'old_site_id', group: 'Other', format: 'The old site\'s record ID (recommended)', example: 'OLD-1001', aliases: ['id', 'record id', 'lead id', 'loan id', 'external id'] },
  { key: 'notes', group: 'Other', format: 'Text, saved once as a note', example: 'TEST row, delete me', aliases: ['note', 'comments'] },
]

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const HEADER_LOOKUP = new Map<string, ColumnKey>(
  COLUMNS.flatMap((c) => [c.key, ...(c.aliases ?? [])].map((name) => [headerKey(name), c.key] as const)),
)
/** Columns that look like Social Security or tax ID numbers. They are never read. */
const SENSITIVE_HEADER = /ssn|social|taxid/
/** TIN and ITIN only as whole words, so ARIVE's "Submit to Underwriting" isn't one. */
const SENSITIVE_WORD = /\b(tin|itin)\b/i

/** The blank template: every header plus one fake example row. */
export function templateCsv(): string {
  return toCsv([COLUMNS.map((c) => c.key), COLUMNS.map((c) => c.example)])
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const word = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

const STAGE_WORDS: Record<string, PipelineStage> = {
  lead: 'lead', new: 'lead', newlead: 'lead',
  contacted: 'contacted', attemptedcontact: 'contacted',
  prequalified: 'pre_qualified', prequal: 'pre_qualified', prequalification: 'pre_qualified',
  preapproved: 'pre_approved', preapproval: 'pre_approved',
  homesearch: 'home_search', shopping: 'home_search', househunting: 'home_search',
  undercontract: 'under_contract', contract: 'under_contract', application: 'under_contract', app: 'under_contract',
  processing: 'processing', submitted: 'processing', submittedprocessing: 'processing', inprocess: 'processing', underwriting: 'processing',
  cleartoclose: 'clear_to_close', ctc: 'clear_to_close', approved: 'clear_to_close', approvedctc: 'clear_to_close',
  closed: 'closed', funded: 'closed', won: 'closed', complete: 'closed', completed: 'closed',
  // ARIVE stage names.
  loanfunded: 'closed', loanclosed: 'closed', docssigned: 'closed', docssignedloanclosed: 'closed', postclosing: 'closed',
  clearedtoclose: 'clear_to_close', submittedtounderwriting: 'processing', approvedwithconditions: 'processing',
  nurture: 'nurture', notready: 'nurture',
  lost: 'lost', dead: 'lost',
}

const PURPOSE_WORDS: Record<string, LoanPurpose> = {
  purchase: 'purchase', buy: 'purchase', buying: 'purchase', homepurchase: 'purchase',
  refinance: 'refinance_rate_term', refi: 'refinance_rate_term', rateterm: 'refinance_rate_term', ratetermrefi: 'refinance_rate_term', ratetermrefinance: 'refinance_rate_term', rateandterm: 'refinance_rate_term', nocashoutrefinance: 'refinance_rate_term',
  limitedcashoutrefinance: 'refinance_rate_term', nocashoutrefi: 'refinance_rate_term', refinancerateterm: 'refinance_rate_term',
  cashout: 'refinance_cash_out', cashoutrefi: 'refinance_cash_out', cashoutrefinance: 'refinance_cash_out', refinancecashout: 'refinance_cash_out',
  heloc: 'heloc', heloan: 'heloan', homeequityloan: 'heloan', closedendsecond: 'heloan', secondmortgage: 'heloan',
  investment: 'investment_dscr', dscr: 'investment_dscr', investmentdscr: 'investment_dscr', investor: 'investment_dscr',
}

const TYPE_WORDS: Record<string, MortgageType> = {
  conventional: 'conventional', conv: 'conventional', conforming: 'conventional', jumbo: 'conventional', highbalance: 'conventional',
  fha: 'fha', va: 'va', usda: 'usda_rural', rural: 'usda_rural', usdarural: 'usda_rural', usdard: 'usda_rural',
  other: 'other', nonqm: 'other', dscr: 'other', bankstatement: 'other', heloc: 'other',
}

const OCCUPANCY_WORDS: Record<string, Occupancy> = {
  primary: 'primary', primaryresidence: 'primary', owneroccupied: 'primary', owner: 'primary', residence: 'primary',
  second: 'second_home', secondhome: 'second_home', secondaryresidence: 'second_home', vacation: 'second_home', vacationhome: 'second_home',
  investment: 'investment', investmentproperty: 'investment', rental: 'investment', nonowner: 'investment', nonowneroccupied: 'investment', investor: 'investment',
}

/** A real calendar date from 2024-03-15, 3/15/2024, 3-15-2024 or 3/15/24. */
export function parseDate(value: string, today = new Date()): string | null {
  const t = value.trim()
  let y: number, m: number, d: number
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t)
  if (match) {
    ;[y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(t)
    if (!match) return null
    ;[m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (match[3].length === 2) {
      const nextYear = (today.getFullYear() + 1) % 100
      y += y <= nextYear ? 2000 : 1900
    }
  }
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

export function parseYesNo(value: string): boolean | null | undefined {
  const w = word(value)
  if (['yes', 'y', 'true', 't', '1', 'x', 'ok', 'filed'].includes(w)) return true
  if (['no', 'n', 'false', 'f', '0', 'notfiled'].includes(w)) return false
  return undefined
}

/** A rate in percent. A decimal like 0.06125 (how some exports write 6.125%) is read as a percent. */
export function parseRate(value: string): number | null {
  const n = Number(value.replace(/[%\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  const pct = n < 0.3 ? n * 100 : n
  return pct <= 30 ? Math.round(pct * 1000) / 1000 : null
}

/** Years (30) or months (360) to months. */
export function parseTermMonths(value: string): number | null {
  const n = Number(value.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  const months = n > 50 ? n : n * 12
  return Number.isInteger(months) && months <= 480 ? months : null
}

function parseState(value: string): string | null {
  const t = value.trim()
  if (/^[a-z]{2}$/i.test(t)) return t.toUpperCase()
  return word(t) === 'texas' ? 'TX' : null
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** One row as import_clients() expects it (see the migration). */
export interface ImportRow {
  row: number
  lo_email: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  birthday: string | null
  mailing: { address: string | null; city: string | null; state: string | null; zip: string | null }
  sms_ok: boolean | null
  email_ok: boolean | null
  co: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null }
  stage: PipelineStage
  lost_reason: string | null
  purpose: LoanPurpose | null
  loan_type: MortgageType | null
  loan_amount: number | null
  purchase_price: number | null
  monthly_payment: number | null
  rate: number | null
  term_months: number | null
  lender: string | null
  program: string | null
  arive_loan_number: string | null
  referral_source: string | null
  closing_date: string | null
  first_payment_date: string | null
  property: {
    address: string | null
    city: string | null
    state: string | null
    zip: string | null
    occupancy: Occupancy | null
    estimated_value: number | null
    insurance_carrier: string | null
    insurance_renewal_date: string | null
    homestead_filed: boolean | null
  } | null
  agent: { name: string | null; email: string | null; phone: string | null }
  title_company: string | null
  old_site_id: string | null
  notes: string | null
}

export interface CheckedRow {
  /** Spreadsheet row number (the header is row 1). */
  row: number
  name: string
  loEmail: string
  stage: PipelineStage | null
  /** Problems that keep the row out of the import. */
  errors: string[]
  /** Values that were left blank or need attention later. */
  warnings: string[]
  data: ImportRow | null
}

export interface CheckedFile {
  rows: CheckedRow[]
  /** Headers that don't match a column; their values are ignored. */
  ignoredColumns: string[]
  /** Social Security / tax ID columns found and never read. */
  sensitiveColumns: string[]
  missingRequired: ColumnKey[]
}

/** Reads and checks a whole file. Nothing here talks to the database. */
export function checkClientFile(text: string, today = new Date()): CheckedFile {
  const [header = [], ...body] = parseCsv(text)
  const map = new Map<number, ColumnKey>()
  const ignoredColumns: string[] = []
  const sensitiveColumns: string[] = []
  header.forEach((h, i) => {
    const k = headerKey(h)
    if (SENSITIVE_HEADER.test(k) || SENSITIVE_WORD.test(h.replace(/[^a-z0-9]+/gi, ' '))) sensitiveColumns.push(h.trim())
    else if (HEADER_LOOKUP.has(k)) map.set(i, HEADER_LOOKUP.get(k)!)
    else if (h.trim()) ignoredColumns.push(h.trim())
  })
  const present = new Set(map.values())
  const missingRequired = COLUMNS.filter((c) => c.required && !present.has(c.key)).map((c) => c.key)

  const seenIds = new Map<string, number>()
  const rows = body.map((cells, index) => {
    const raw = Object.fromEntries(COLUMNS.map((c) => [c.key, ''])) as Record<ColumnKey, string>
    // Columns in file order, so the first one with a value wins (ARIVE: Docs Signed, then Loan Funded, then Firm Closing Date).
    map.forEach((key, i) => (raw[key] ||= (cells[i] ?? '').trim()))
    const checked = checkRow(raw, index + 2, today)
    const id = checked.data?.old_site_id
    if (id) {
      if (seenIds.has(id)) checked.warnings.push(`Same old site ID as row ${seenIds.get(id)}; it updates that row's file.`)
      else seenIds.set(id, checked.row)
    }
    return checked
  })
  return { rows, ignoredColumns, sensitiveColumns, missingRequired }
}

function checkRow(raw: Record<ColumnKey, string>, row: number, today: Date): CheckedRow {
  const errors: string[] = []
  const warnings: string[] = []
  const text = (k: ColumnKey) => raw[k] || null
  const label = (k: ColumnKey) => k.replace(/_/g, ' ')
  const read = <T,>(k: ColumnKey, parse: (v: string) => T | null | undefined, what: string): T | null => {
    if (!raw[k]) return null
    const value = parse(raw[k])
    if (value === null || value === undefined) {
      warnings.push(`${label(k)} "${raw[k]}" isn't ${what}, so it was left blank.`)
      return null
    }
    return value
  }
  const fromWords = <T,>(k: ColumnKey, words: Record<string, T>, what: string) => read(k, (v) => words[word(v)], what)
  const date = (k: ColumnKey) => read(k, (v) => parseDate(v, today), 'a date')
  const money = (k: ColumnKey) => read(k, parseMoney, 'an amount')
  const phone = (k: ColumnKey) => read(k, normalizePhone, 'a 10-digit phone number')
  const email = (k: ColumnKey) => read(k, normalizeEmail, 'an email address')
  const yesNo = (k: ColumnKey) => read(k, parseYesNo, 'Yes or No')
  const state = (k: ColumnKey) => read(k, parseState, 'a two-letter state')

  const name = [raw.first_name, raw.last_name].filter(Boolean).join(' ')
  const loEmail = normalizeEmail(raw.lo_email)
  if (!raw.lo_email) errors.push('lo_email is blank.')
  else if (!loEmail) errors.push(`lo_email "${raw.lo_email}" isn't an email address.`)
  if (!raw.first_name) errors.push('first_name is blank.')
  if (!raw.last_name) errors.push('last_name is blank.')

  const stage = raw.stage ? (STAGE_WORDS[word(raw.stage)] ?? null) : null
  if (!raw.stage) errors.push('stage is blank.')
  else if (!stage) errors.push(`stage "${raw.stage}" isn't one of the LOSuite stages.`)
  const closed = stage === 'closed'

  const closingDate = date('closing_date')
  if (closed && !closingDate) errors.push(raw.closing_date ? `closing_date "${raw.closing_date}" isn't a date.` : 'Closed rows need a closing_date.')
  if (stage === 'lost' && !raw.lost_reason) errors.push('Lost rows need a lost_reason.')

  const borrowerEmail = email('email')
  const borrowerPhone = phone('phone')
  if (!closed && stage && !borrowerEmail && !borrowerPhone) errors.push('Current clients need an email or a phone number.')
  if (closed && !borrowerEmail && !borrowerPhone && !raw.property_address) errors.push('Closed rows need an email, a phone number or a property address.')
  if (closed && !borrowerEmail) warnings.push('No email: add one before sending follow-ups.')

  const property = raw.property_address
    ? {
        address: raw.property_address,
        city: text('property_city'),
        state: state('property_state'),
        zip: text('property_zip'),
        occupancy: fromWords('occupancy', OCCUPANCY_WORDS, 'Primary, Second Home or Investment'),
        estimated_value: money('estimated_value'),
        insurance_carrier: text('insurance_carrier'),
        insurance_renewal_date: date('insurance_renewal_date'),
        homestead_filed: yesNo('homestead_filed'),
      }
    : null
  if (!property && ['property_city', 'property_zip', 'estimated_value', 'insurance_carrier', 'insurance_renewal_date', 'homestead_filed'].some((k) => raw[k as ColumnKey])) {
    warnings.push('Property details without a property_address were left out.')
  }

  const data: ImportRow = {
    row,
    lo_email: loEmail ?? '',
    first_name: raw.first_name,
    last_name: raw.last_name,
    email: borrowerEmail,
    phone: borrowerPhone,
    birthday: date('birthday'),
    mailing: { address: text('mailing_address'), city: text('mailing_city'), state: state('mailing_state'), zip: text('mailing_zip') },
    sms_ok: yesNo('sms_ok'),
    email_ok: yesNo('email_ok'),
    co: { first_name: text('co_first_name'), last_name: text('co_last_name'), email: email('co_email'), phone: phone('co_phone') },
    stage: stage ?? 'lead',
    lost_reason: text('lost_reason'),
    purpose: fromWords('loan_purpose', PURPOSE_WORDS, 'a loan purpose LOSuite knows'),
    loan_type: fromWords('loan_type', TYPE_WORDS, 'Conventional, FHA, VA, USDA or Other'),
    loan_amount: money('loan_amount'),
    purchase_price: money('purchase_price'),
    monthly_payment: money('monthly_payment'),
    rate: read('rate', parseRate, 'a rate between 0% and 30%'),
    term_months: read('term_years', parseTermMonths, 'a term in years'),
    lender: text('lender'),
    program: text('program'),
    arive_loan_number: text('arive_loan_number'),
    referral_source: text('referral_source'),
    closing_date: closingDate,
    first_payment_date: date('first_payment_date'),
    property,
    agent: { name: text('agent_name'), email: email('agent_email'), phone: phone('agent_phone') },
    title_company: text('title_company'),
    old_site_id: text('old_site_id'),
    notes: text('notes'),
  }
  return { row, name: name || '(no name)', loEmail: loEmail ?? raw.lo_email, stage, errors, warnings, data: errors.length ? null : data }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type RowStatus = 'added' | 'updated' | 'unchanged' | 'skipped' | 'error'

/** What import_clients() said about one row. */
export interface RowResult {
  row: number
  status: RowStatus
  person?: 'new' | 'matched'
  matched_by?: string | null
  loan_id?: string | null
  message?: string | null
}

export interface ImportTotals {
  added: number
  updated: number
  unchanged: number
  skipped: number
  error: number
}

/** Counts by outcome. Rows the file check stopped count as errors. */
export function importTotals(checked: CheckedRow[], results: RowResult[]): ImportTotals {
  const totals: ImportTotals = { added: 0, updated: 0, unchanged: 0, skipped: 0, error: checked.filter((r) => !r.data).length }
  for (const r of results) totals[r.status]++
  return totals
}

/** The report as a CSV, one line per row, for keeping or fixing the file. */
export function reportCsv(checked: CheckedRow[], results: RowResult[]): string {
  const byRow = new Map(results.map((r) => [r.row, r]))
  return toCsv([
    ['row', 'name', 'lo_email', 'result', 'matched_by', 'details'],
    ...checked.map((c) => {
      const r = byRow.get(c.row)
      const status = c.data ? (r?.status ?? 'not sent') : 'error'
      const details = [...c.errors, r?.message, ...c.warnings].filter(Boolean).join(' ')
      return [c.row, c.name, c.loEmail, status, r?.matched_by ?? '', details]
    }),
  ])
}
