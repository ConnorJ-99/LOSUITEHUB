// Pages (Connor, 2026-11-06; docs/plans/pages.md): what a page is made of,
// and how a visitor's answers are checked and read into a lead. Pure, with no
// imports: the builder and the public page (Vite) and the page-submit Edge
// Function (Deno) all use this one copy, so what the screen allows is what
// the server accepts.

export type ContentBlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'lo_card' | 'footer'
export type FieldType = 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'currency' | 'dropdown' | 'choice' | 'checkboxes' | 'date' | 'yes_no' | 'file'
export type BlockType = ContentBlockType | FieldType

/** Borrower fields an answer can fill (existing columns; see record_page_submission). */
export type MapsTo =
  | 'full_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'purpose'
  | 'purchase_price'
  | 'down_payment'
  | 'cash_out'
  | 'credit_score'
  | 'timeline'
  | 'income_doc_type'

export interface Block {
  id: string
  type: BlockType
  /** Heading, text, button: the words. */
  text?: string
  /** Heading: shown in the dark band at the top. */
  hero?: boolean
  /** Image: public URL in page-assets. */
  url?: string
  alt?: string
  /** Button: where it goes (https:, tel:, mailto:). */
  href?: string
  /** Fields. */
  label?: string
  placeholder?: string
  required?: boolean
  help?: string
  options?: string[]
  mapsTo?: MapsTo | null
}

export interface PageSettings {
  successTitle?: string
  successMessage?: string
  /** https only: where to send the visitor after submitting, instead of the message. */
  redirectUrl?: string
  tags?: string[]
  /** Notify the owner (default on). */
  notify?: boolean
  seoTitle?: string
  seoDescription?: string
  /** Public URL of the share image. */
  ogImage?: string
  submitLabel?: string
  /** The call/text/email consent box above the button (default on). */
  consent?: boolean
  /** 'partner': submissions go to the Partner center instead of becoming leads. */
  leadKind?: 'lead' | 'partner'
}

export const FIELD_TYPES: { type: FieldType; label: string }[] = [
  { type: 'short_text', label: 'Short text' },
  { type: 'long_text', label: 'Long text' },
  { type: 'email', label: 'Email' },
  { type: 'phone', label: 'Phone' },
  { type: 'number', label: 'Number' },
  { type: 'currency', label: 'Currency' },
  { type: 'dropdown', label: 'Dropdown' },
  { type: 'choice', label: 'Choice' },
  { type: 'checkboxes', label: 'Checkboxes' },
  { type: 'date', label: 'Date' },
  { type: 'yes_no', label: 'Yes / no' },
  { type: 'file', label: 'File upload' },
]

export const CONTENT_TYPES: { type: ContentBlockType; label: string }[] = [
  { type: 'heading', label: 'Heading' },
  { type: 'text', label: 'Text' },
  { type: 'image', label: 'Image' },
  { type: 'button', label: 'Button' },
  { type: 'divider', label: 'Divider' },
  { type: 'lo_card', label: 'LO card' },
  { type: 'footer', label: 'MPS footer' },
]

export const isField = (type: BlockType): type is FieldType => FIELD_TYPES.some((f) => f.type === type)
export const blockTypeLabel = (type: BlockType): string => [...FIELD_TYPES, ...CONTENT_TYPES].find((t) => t.type === type)?.label ?? type
export const hasOptions = (type: BlockType) => type === 'dropdown' || type === 'choice' || type === 'checkboxes'

/** What each "maps to" choice is called, and which field types can fill it. */
export const MAPS_TO: { key: MapsTo; label: string; types: FieldType[] }[] = [
  { key: 'full_name', label: 'Contact · Full name', types: ['short_text'] },
  { key: 'first_name', label: 'Contact · First name', types: ['short_text'] },
  { key: 'last_name', label: 'Contact · Last name', types: ['short_text'] },
  { key: 'email', label: 'Contact · Email', types: ['email'] },
  { key: 'phone', label: 'Contact · Phone', types: ['phone'] },
  { key: 'purpose', label: 'Loan · Buying or refinancing', types: ['dropdown', 'choice'] },
  { key: 'purchase_price', label: 'Loan · Purchase price', types: ['currency', 'number'] },
  { key: 'down_payment', label: 'Loan · Down payment', types: ['currency', 'number'] },
  { key: 'cash_out', label: 'Loan · Cash-out amount', types: ['currency', 'number'] },
  { key: 'credit_score', label: 'Borrower · Credit range', types: ['dropdown', 'choice', 'number'] },
  { key: 'timeline', label: 'Loan · Timeline', types: ['dropdown', 'choice', 'short_text'] },
  { key: 'income_doc_type', label: 'Loan · Income type', types: ['dropdown', 'choice'] },
]

/** No SSN or date-of-birth questions (the database refuses them too). */
export const FORBIDDEN_LABEL = /(social\s*security|\bssn\b|\bsocial\b.*\bnumber\b|date\s+of\s+birth|\bdob\b|birth\s*date)/i
export const isForbiddenLabel = (label: string | undefined) => FORBIDDEN_LABEL.test(label ?? '')

/** "Quick Pre-Qual!" → "quick-pre-qual". */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
}

export const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/
export const isValidSlug = (slug: string) => SLUG_PATTERN.test(slug)

export const MAX_FILES_PER_FIELD = 5
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const UPLOAD_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif']

// ---------------------------------------------------------------------------
// Reading answers
// ---------------------------------------------------------------------------

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')

/** "$425,000" → 425000; "450k" → 450000. Null when it isn't a clean amount. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
  const t = text(v).toLowerCase().replace(/[$,\s]/g, '')
  const m = /^(\d+(?:\.\d+)?)([km])?$/.exec(t)
  if (!m) return null
  return Math.round(Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1) * 100) / 100
}

/** Ten digits, dropping a leading US 1. */
export function phoneDigits(v: unknown): string | null {
  let d = text(v).replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

/** A credit answer as a score: "700–739" → 700, "Below 620" → 619, "740+" → 740, "720" → 720. */
export function creditScore(v: unknown): number | null {
  const t = text(v).toLowerCase()
  if (!t) return null
  const nums = (t.match(/\d{3}/g) ?? []).map(Number).filter((n) => n >= 300 && n <= 850)
  if (!nums.length) return null
  if (/below|under|less than|</.test(t)) return nums[0] - 1
  return Math.min(...nums)
}

/** Buying / refinancing / cash-out / HELOC → a loan purpose. */
export function loanPurpose(v: unknown): string | null {
  const t = text(v).toLowerCase()
  if (!t) return null
  if (/heloc|line of credit/.test(t)) return 'heloc'
  if (/home equity|heloan|second/.test(t)) return 'heloan'
  if (/cash/.test(t)) return 'refinance_cash_out'
  if (/refi/.test(t)) return 'refinance_rate_term'
  if (/invest|dscr|rental/.test(t)) return 'investment_dscr'
  if (/buy|purchas|first home|new home/.test(t)) return 'purchase'
  return null
}

/** How they're paid → the loan's income type. Unclear answers (self-employed) aren't mapped. */
export function incomeDocType(v: unknown): string | null {
  const t = text(v).toLowerCase()
  if (/bank statement/.test(t)) return 'bank_statement'
  if (/1099/.test(t)) return 'form_1099'
  if (/dscr|rental income/.test(t)) return 'dscr'
  if (/asset/.test(t)) return 'asset_based'
  if (/w-?2|salar|hourly|retire|pension|social security income/.test(t)) return 'full_doc'
  return null
}

/** A timeline answer in the pipeline's words where it fits; other wording is kept as typed. */
export function timeline(v: unknown): string | null {
  const t = text(v)
  const l = t.toLowerCase()
  if (!t) return null
  if (/asap|right away|now|immediately|this month|30 days/.test(l)) return 'ASAP'
  if (/just looking|not sure|browsing|curious/.test(l)) return 'Just looking'
  if (/6\s*\+|6 or more|more than 6|over 6|6 months or|year/.test(l)) return '6+ months'
  if (/3\s*[-–to]+\s*6/.test(l)) return '3–6 months'
  if (/\b3\b/.test(l)) return '3 months'
  if (/\b2\b/.test(l)) return '2 months'
  if (/\b1\b|one month/.test(l)) return '1 month'
  return t.slice(0, 200)
}

/** Text that looks like a Social Security number (123-45-6789 or 9 digits alone). */
export const looksLikeSsn = (v: string) => /\b\d{3}-\d{2}-\d{4}\b/.test(v) || /^\s*\d{9}\s*$/.test(v)

export interface UploadedFile {
  path: string
  name: string
  size: number
  type: string
}

export interface DataRow {
  blockId: string
  label: string
  type: FieldType
  value: string | string[] | number | boolean | null
}

export interface ReadResult {
  /** Problems by block id ('_contact' when neither email nor phone came in). */
  errors: Record<string, string>
  data: DataRow[]
  files: (UploadedFile & { blockId: string })[]
  /** For record_page_submission: clean values by borrower field, as text. */
  mapped: Record<string, string>
  /** Label → answer, for the Web forms list on the file. */
  answers: Record<string, string>
}

const display = (v: DataRow['value']) => (v === null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v))

/**
 * Checks every answer against its question and reads the mapped ones.
 * answers: block id → what the visitor entered; files: block id → uploads;
 * consent: the call/text box.
 */
export function readSubmission(blocks: Block[], answers: Record<string, unknown>, files: Record<string, UploadedFile[]>, consent: boolean): ReadResult {
  const errors: Record<string, string> = {}
  const data: DataRow[] = []
  const outFiles: ReadResult['files'] = []
  const mapped: Record<string, string> = {}
  const labeled: Record<string, string> = {}

  for (const b of blocks) {
    if (!isField(b.type)) continue
    const label = (b.label ?? '').trim() || blockTypeLabel(b.type)
    if (isForbiddenLabel(label)) continue
    const raw = answers[b.id]
    let value: DataRow['value'] = null
    let problem: string | null = null

    switch (b.type) {
      case 'short_text':
      case 'long_text': {
        const t = text(raw).slice(0, b.type === 'long_text' ? 5000 : 500)
        if (t && looksLikeSsn(t)) problem = 'Please don\'t enter a Social Security number here.'
        else value = t || null
        break
      }
      case 'email': {
        const t = text(raw).toLowerCase()
        if (t && !isEmail(t)) problem = 'Enter a valid email address.'
        else value = t || null
        break
      }
      case 'phone': {
        const t = text(raw)
        const d = phoneDigits(t)
        if (t && !d) problem = 'Enter a 10-digit phone number.'
        else value = d
        break
      }
      case 'number':
      case 'currency': {
        const t = text(raw)
        const n = parseAmount(t)
        if (t && n === null) problem = b.type === 'currency' ? 'Enter a dollar amount.' : 'Enter a number.'
        else value = n
        break
      }
      case 'dropdown':
      case 'choice': {
        const t = text(raw)
        if (t && !(b.options ?? []).includes(t)) problem = 'Pick one of the choices.'
        else value = t || null
        break
      }
      case 'checkboxes': {
        const list = Array.isArray(raw) ? raw.map(text).filter(Boolean) : []
        if (list.some((x) => !(b.options ?? []).includes(x))) problem = 'Pick from the choices.'
        else value = list.length ? list : null
        break
      }
      case 'date': {
        const t = text(raw)
        if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) problem = 'Enter a date.'
        else value = t || null
        break
      }
      case 'yes_no': {
        const t = text(raw).toLowerCase()
        value = t === 'yes' || raw === true ? true : t === 'no' || raw === false ? false : null
        break
      }
      case 'file': {
        const list = (files[b.id] ?? []).slice(0, MAX_FILES_PER_FIELD)
        for (const f of list) outFiles.push({ ...f, blockId: b.id })
        value = list.length ? list.map((f) => f.name) : null
        break
      }
    }

    if (!problem && b.required && (value === null || (Array.isArray(value) && value.length === 0))) problem = 'This one is required.'
    if (problem) {
      errors[b.id] = problem
      continue
    }
    data.push({ blockId: b.id, label, type: b.type, value })
    if (value !== null) labeled[label] = display(value)

    if (value === null || !b.mapsTo) continue
    const s = display(value)
    switch (b.mapsTo) {
      case 'full_name': {
        const parts = s.split(/\s+/).filter(Boolean)
        if (parts.length) {
          mapped.first_name ??= parts[0]
          if (parts.length > 1) mapped.last_name ??= parts.slice(1).join(' ')
        }
        break
      }
      case 'first_name':
      case 'last_name':
      case 'email':
      case 'phone':
        mapped[b.mapsTo] = s
        break
      case 'purchase_price':
      case 'down_payment':
      case 'cash_out':
        if (typeof value === 'number') mapped[b.mapsTo] = String(value)
        break
      case 'purpose': {
        const p = loanPurpose(s)
        if (p) mapped.purpose = p
        break
      }
      case 'credit_score': {
        const c = creditScore(s)
        if (c !== null) mapped.credit_score = String(c)
        break
      }
      case 'timeline': {
        const t = timeline(s)
        if (t) mapped.timeline = t
        break
      }
      case 'income_doc_type': {
        const i = incomeDocType(s)
        if (i) mapped.income_doc_type = i
        break
      }
    }
  }

  if (!Object.keys(errors).length && !mapped.email && !mapped.phone) errors._contact = 'Please add your email or phone so we can reach you.'
  if (consent) mapped.sms_consent = 'true'
  return { errors, data, files: outFiles, mapped, answers: labeled }
}

/** What the builder warns about before publishing. */
export function publishProblems(title: string, slug: string, blocks: Block[]): string[] {
  const out: string[] = []
  if (!title.trim()) out.push('Give the page a title.')
  if (!isValidSlug(slug)) out.push('The web address can use lowercase letters, numbers and dashes.')
  const fields = blocks.filter((b) => isField(b.type))
  if (blocks.some((b) => isForbiddenLabel(b.label))) out.push("Pages can't ask for a Social Security number or date of birth.")
  if (fields.length && !fields.some((b) => b.mapsTo === 'email' || b.mapsTo === 'phone')) out.push('Add an email or phone question that maps to the contact, so a submission can become a lead.')
  for (const b of fields) {
    if (hasOptions(b.type) && !(b.options ?? []).filter((o) => o.trim()).length) out.push(`"${b.label || blockTypeLabel(b.type)}" needs at least one choice.`)
  }
  return out
}

/** Safe link targets for buttons and redirects. */
export const isSafeHref = (href: string | undefined) => !!href && /^(https:\/\/|tel:|mailto:|sms:)/i.test(href.trim())
