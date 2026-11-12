// The assistant's "read an upload" task (Stage 3b; plan
// docs/plans/employment-documents.md): which document types it may suggest,
// the fields it looks for, the JSON shape it must return, the checks on what
// comes back, and the mismatch flags against the 1003. Pure, with no imports,
// so the Edge Function (Deno), the app (Documents tab, suggested conditions)
// and the tests share it.
//
// Rules: the AI only suggests (a type with its confidence, fields each with
// the words they came from). It never changes the file. No Social Security
// numbers, ever; account numbers last 4 only. Flags are worked out here in
// code, not by the AI.

export const READ_KINDS = [
  'paystub', 'w2', 'form_1099', 'tax_return', 'business_return', 'profit_loss', 'bank_statement', 'investment_statement',
  'photo_id', 'award_letter', 'gift_letter', 'mortgage_statement', 'insurance_declarations', 'lease', 'other',
] as const
export type ReadKind = (typeof READ_KINDS)[number]

export const KIND_LABEL: Record<ReadKind, string> = {
  paystub: 'Pay stub', w2: 'W-2', form_1099: '1099', tax_return: 'Tax return', business_return: 'Business tax return', profit_loss: 'Profit & loss',
  bank_statement: 'Bank statement', investment_statement: 'Investment statement', photo_id: 'Photo ID', award_letter: 'Award letter', gift_letter: 'Gift letter',
  mortgage_statement: 'Mortgage statement', insurance_declarations: 'Insurance declarations', lease: 'Lease', other: 'Other',
}

export type FieldType = 'text' | 'date' | 'money' | 'year' | 'last4'

export const READ_FIELDS = [
  { key: 'employer_name', label: 'Employer', type: 'text' },
  { key: 'employee_name', label: 'Employee / account holder', type: 'text' },
  { key: 'pay_period_start', label: 'Pay period start', type: 'date' },
  { key: 'pay_period_end', label: 'Pay period end', type: 'date' },
  { key: 'pay_date', label: 'Pay date', type: 'date' },
  { key: 'gross_pay_current', label: 'Gross pay this period', type: 'money' },
  { key: 'ytd_gross', label: 'YTD gross', type: 'money' },
  { key: 'ytd_base', label: 'YTD base', type: 'money' },
  { key: 'ytd_overtime', label: 'YTD overtime', type: 'money' },
  { key: 'ytd_bonus', label: 'YTD bonus', type: 'money' },
  { key: 'ytd_commission', label: 'YTD commission', type: 'money' },
  { key: 'hourly_rate', label: 'Hourly rate', type: 'money' },
  { key: 'tax_year', label: 'Tax year', type: 'year' },
  { key: 'w2_wages', label: 'W-2 wages (box 1)', type: 'money' },
  { key: 'institution', label: 'Bank or institution', type: 'text' },
  { key: 'account_last4', label: 'Account (last 4)', type: 'last4' },
  { key: 'statement_period_start', label: 'Statement start', type: 'date' },
  { key: 'statement_period_end', label: 'Statement end', type: 'date' },
  { key: 'ending_balance', label: 'Ending balance', type: 'money' },
  { key: 'id_expiration', label: 'ID expires', type: 'date' },
] as const satisfies readonly { key: string; label: string; type: FieldType }[]
export type ReadFieldKey = (typeof READ_FIELDS)[number]['key']

export interface ReadField {
  value: string | number
  /** The words on the document it came from. */
  quote: string
}

export interface DocumentReading {
  kind: ReadKind
  confidence: 'high' | 'medium' | 'low'
  fields: Partial<Record<ReadFieldKey, ReadField>>
}

export const DOC_READ_SYSTEM_PROMPT = [
  'You read one mortgage document a borrower uploaded (a PDF or a photo) for a loan officer.',
  'Say what kind of document it is (one of the listed kinds) and how sure you are, then copy out the listed fields that appear on it.',
  'Copy only what is printed. Never guess, compute or fill in a value that is not on the document. Leave a field out when it is not there.',
  'For every field give the value and a short quote: the exact words or numbers on the document it came from (40 characters or less).',
  'Dates as YYYY-MM-DD. Money as a plain number (no $ or commas). A year as four digits.',
  'Never copy a Social Security number, a full account number or a date of birth. For an account give only its last 4 digits.',
  'Confidence: high = clearly this kind and the fields are legible; medium = probably, or some fields hard to read; low = unsure or mostly unreadable.',
].join('\n')

export const DOC_READ_USER_PROMPT = 'Read this uploaded document.'

export const DOC_READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'confidence', 'fields'],
  properties: {
    kind: { type: 'string', enum: [...READ_KINDS] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'quote'],
        properties: { key: { type: 'string', enum: READ_FIELDS.map((f) => f.key) }, value: { type: 'string' }, quote: { type: 'string' } },
      },
    },
  },
} as const

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Checks and cleans the reply: known kinds and fields only, values in the right form, no SSNs, account numbers cut to the last 4. */
export function normalizeDocReading(raw: unknown): DocumentReading | { error: string } {
  if (!isObject(raw)) return { error: 'The reading was not in the expected form.' }
  const kind = READ_KINDS.includes(raw.kind as ReadKind) ? (raw.kind as ReadKind) : null
  if (!kind) return { error: 'The reading named a document type MPS HQ does not know.' }
  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low' ? raw.confidence : 'low'
  const fields: DocumentReading['fields'] = {}
  for (const f of Array.isArray(raw.fields) ? raw.fields : []) {
    if (!isObject(f)) continue
    const def = READ_FIELDS.find((d) => d.key === f.key)
    if (!def || fields[def.key]) continue
    const text = String(f.value ?? '').trim()
    const quote = String(f.quote ?? '').trim().slice(0, 80)
    if (!text || SSN.test(text) || SSN.test(quote)) continue
    let value: string | number | null = null
    if (def.type === 'money') {
      const n = Number(text.replace(/[$,\s]/g, ''))
      value = Number.isFinite(n) ? Math.round(n * 100) / 100 : null
    } else if (def.type === 'date') value = ISO.test(text) && !Number.isNaN(Date.parse(`${text}T12:00:00Z`)) ? text : null
    else if (def.type === 'year') value = /^(19|20)\d{2}$/.test(text) ? Number(text) : null
    else if (def.type === 'last4') value = text.replace(/\D/g, '').slice(-4) || null
    else value = text.slice(0, 120)
    if (value === null || value === '') continue
    fields[def.key] = { value, quote: def.type === 'last4' ? `••${value}` : quote }
  }
  return { kind, confidence, fields }
}

// ---------------------------------------------------------------------------
// Flags (code, not AI)
// ---------------------------------------------------------------------------

export interface FlagJob {
  id: string
  employerName: string
  current: boolean
  startDate: string | null
  endDate: string | null
}

export interface DocFlag {
  code: 'type_mismatch' | 'employer_not_on_1003' | 'dates_conflict' | 'old_paystub' | 'statement_old' | 'id_expired' | 'low_confidence'
  text: string
  /** For employer_not_on_1003: the name to offer as a new job. */
  employer?: string
}

/** "Excel, Inc." → "excel": lowercase, no punctuation, no company endings. */
export function employerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|l l c|corp|corporation|co|company|ltd|lp|llp|pllc|pc|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The 1003 job a document's employer matches (one name contains the other, ignoring "Inc", "LLC" and so on). */
export function matchJob(employer: string, jobs: FlagJob[]): FlagJob | null {
  const k = employerKey(employer)
  if (!k) return null
  return jobs.find((j) => {
    const jk = employerKey(j.employerName)
    return !!jk && (jk === k || jk.includes(k) || k.includes(jk))
  }) ?? null
}

const DAY = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`
const monthYear = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`

/**
 * The flags for one reading. `uploadedAs` is the type the document was saved
 * with ('other' when nobody picked one); `jobs` are the borrower's jobs on the
 * 1003. Each flag is something for Connor to look at; nothing is changed.
 */
export function documentFlags(r: DocumentReading, uploadedAs: string, jobs: FlagJob[], today: string, paystubDays = 30): DocFlag[] {
  const out: DocFlag[] = []
  const f = r.fields
  if (r.confidence === 'low') out.push({ code: 'low_confidence', text: 'The assistant was unsure what this is or could not read it well' })
  if (uploadedAs !== 'other' && r.kind !== 'other' && uploadedAs !== r.kind) out.push({ code: 'type_mismatch', text: `Uploaded as ${KIND_LABEL[uploadedAs as ReadKind] ?? uploadedAs}; it looks like a ${KIND_LABEL[r.kind].toLowerCase()}` })

  const employer = typeof f.employer_name?.value === 'string' ? f.employer_name.value : null
  if (employer && (r.kind === 'paystub' || r.kind === 'w2')) {
    const job = matchJob(employer, jobs)
    if (!job) out.push({ code: 'employer_not_on_1003', text: `Employer "${employer}" isn't on the 1003`, employer })
    else if (job.startDate) {
      const year = typeof f.tax_year?.value === 'number' ? f.tax_year.value : null
      const paid = typeof f.pay_date?.value === 'string' ? f.pay_date.value : typeof f.pay_period_end?.value === 'string' ? f.pay_period_end.value : null
      if (r.kind === 'w2' && year && year < Number(job.startDate.slice(0, 4))) out.push({ code: 'dates_conflict', text: `The W-2 shows ${job.employerName} earnings in ${year}, but the 1003 start date is ${monthYear(job.startDate)}` })
      if (r.kind === 'paystub' && paid && paid < job.startDate) out.push({ code: 'dates_conflict', text: `The pay stub is dated ${shortDate(paid)}, before the 1003 start date at ${job.employerName} (${monthYear(job.startDate)})` })
      if (!job.current && job.endDate) {
        if (r.kind === 'w2' && year && year > Number(job.endDate.slice(0, 4))) out.push({ code: 'dates_conflict', text: `The W-2 is for ${year}, after the 1003 end date at ${job.employerName} (${monthYear(job.endDate)})` })
        if (r.kind === 'paystub' && paid && paid > job.endDate) out.push({ code: 'dates_conflict', text: `The pay stub is dated ${shortDate(paid)}, after the 1003 end date at ${job.employerName} (${monthYear(job.endDate)})` })
      }
    }
  }
  if (r.kind === 'paystub') {
    const paid = typeof f.pay_date?.value === 'string' ? f.pay_date.value : typeof f.pay_period_end?.value === 'string' ? f.pay_period_end.value : null
    if (paid && daysBetween(paid, today) > paystubDays) out.push({ code: 'old_paystub', text: `The pay stub is from ${shortDate(paid)}, over ${paystubDays} days old` })
  }
  if (r.kind === 'bank_statement' || r.kind === 'investment_statement') {
    const end = typeof f.statement_period_end?.value === 'string' ? f.statement_period_end.value : null
    if (end && daysBetween(end, today) > 60) out.push({ code: 'statement_old', text: `The statement ends ${shortDate(end)}, over 60 days ago` })
  }
  if (r.kind === 'photo_id') {
    const exp = typeof f.id_expiration?.value === 'string' ? f.id_expiration.value : null
    if (exp && exp < today) out.push({ code: 'id_expired', text: `The ID expired ${shortDate(exp)}` })
  }
  return out
}

/** Ready when it's sure and nothing is flagged; otherwise Needs review. */
export const statusFor = (r: DocumentReading, flags: DocFlag[]): 'ready' | 'needs_review' => (r.confidence === 'high' && flags.length === 0 ? 'ready' : 'needs_review')

/**
 * Missing months across one account's statements (Connor's "statement months
 * missing"): any break of more than a week between one statement's end and
 * the next one's start.
 */
export function statementGaps(statements: { start: string; end: string }[]): { from: string; to: string }[] {
  const sorted = [...statements].filter((s) => ISO.test(s.start) && ISO.test(s.end)).sort((a, b) => a.start.localeCompare(b.start))
  const gaps: { from: string; to: string }[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted.slice(0, i).reduce((m, s) => (s.end > m ? s.end : m), sorted[0].end)
    if (daysBetween(prevEnd, sorted[i].start) > 7) gaps.push({ from: prevEnd, to: sorted[i].start })
  }
  return gaps
}
