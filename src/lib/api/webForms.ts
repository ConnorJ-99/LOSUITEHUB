import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'
import { db, keys, unwrap } from './client'

export type SubmissionOutcome = 'new_lead' | 'existing_open_loan' | 'new_loan_existing_person' | 'partner_inquiry' | 'form_update'

/** One form submission from the website, as received (sensitive fields already removed). */
export interface WebForm {
  id: string
  loanId: string | null
  formType: string | null
  source: string | null
  tracking: Record<string, string>
  answers: Record<string, unknown>
  outcome: SubmissionOutcome
  receivedAt: string
}

interface WebFormRow {
  id: string
  loan_id: string | null
  form_type: string | null
  source: string | null
  tracking: Record<string, string> | null
  answers: Record<string, unknown> | null
  outcome: SubmissionOutcome
  received_at: string
}

/** Web forms from this person (any of their files), newest first. */
export function useWebForms(loanId: string, contactId: string | null) {
  return useQuery({
    queryKey: keys.webForms(loanId),
    queryFn: async () => {
      const filter = contactId ? `loan_id.eq.${loanId},contact_id.eq.${contactId}` : `loan_id.eq.${loanId}`
      return unwrap<WebFormRow[]>(
        await db().from('lead_submissions').select('id, loan_id, form_type, source, tracking, answers, outcome, received_at').or(filter).order('received_at', { ascending: false }).limit(20),
      ).map(
        (r): WebForm => ({ id: r.id, loanId: r.loan_id, formType: r.form_type, source: r.source, tracking: r.tracking ?? {}, answers: r.answers ?? {}, outcome: r.outcome, receivedAt: r.received_at }),
      )
    },
  })
}

// ---------------------------------------------------------------------------
// Showing the answers: blanks hidden, values formatted, grouped by meaning.
// Pure; the cards only lay this out. Keys may be snake_case or camelCase.
// ---------------------------------------------------------------------------

const BLANK_WORDS = new Set(['', 'empty', 'null', 'undefined', 'n/a', 'na', 'none', '-', '—'])

/** True for anything that isn't a real answer: null, "", "empty", "n/a", an empty list or object... */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return BLANK_WORDS.has(v.trim().toLowerCase())
  if (typeof v === 'number') return !Number.isFinite(v)
  if (Array.isArray(v)) return v.every(isBlank)
  if (typeof v === 'object') return Object.values(v).every(isBlank)
  return false
}

/** "homeValue", "home-value" and "home_value" all become "home_value". */
export const normalKey = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()

/** "purchase_price" → "Purchase price", "homeValue" → "Home value", "utm_source" → "UTM source". */
export function fieldLabel(key: string): string {
  const words = normalKey(key).replace(/_+/g, ' ').trim()
  if (!words) return key
  const text = words[0].toUpperCase() + words.slice(1)
  return text.replace(/\b(utm|ltv|dti|va|fha|usda|heloc|zip|id)\b/gi, (w) => w.toUpperCase())
}

/** "mortgage_preapproval" → "Mortgage preapproval". */
export const formTitle = (formType: string | null) => (formType && !isBlank(formType) ? fieldLabel(formType) : 'Web form')

/** Slugs read as words: "under-contract" → "Under contract", "second_home" → "Second home". Other text is left as typed. */
export function sentenceCase(text: string): string {
  const t = text.trim()
  if (!/^[a-z0-9]+([_-][a-z0-9]+)+$/.test(t) && !/^[a-z]+$/.test(t)) return t
  const words = t.replace(/[_-]+/g, ' ')
  return words[0].toUpperCase() + words.slice(1)
}

/** Never shown with the answers: ids, form plumbing and contact details already on the file. */
const HIDDEN = new Set([
  'lead_id', 'lead_code', 'external_id', 'submission_id', 'form_stage', 'entry_point', 'entry_intent', 'form_type', 'assigned_to_email',
  'first_name', 'firstname', 'last_name', 'lastname', 'name', 'full_name', 'fullname', 'email', 'email_address', 'phone', 'phone_number',
  'sms_consent', 'down_payment_mode', 'contact_type', 'partner_type', 'brokerage', 'company', 'company_name',
  // The website's routing and progress flags: how the form got here, not what they told us.
  'lead_priority', 'lead_priority_label', 'primary_route', 'routing_email', 'loan_officer_email', 'last_completed_module', 'contact_consent',
  'application_started', 'completed_prequalification', 'requested_prequalification', 'self_prequal', 'transaction_type', 'under_contract',
])
const isHidden = (k: string) => HIDDEN.has(k) || k.startsWith('assigned_')
/** Where they came from: its own section, collapsed by default. */
const ORIGIN = new Set(['source', 'lead_source', 'referrer', 'landing_page', 'gclid', 'fbclid', 'original_cta', 'starting_option'])
const isOrigin = (k: string) => ORIGIN.has(k) || k.startsWith('utm_')

const PRICE_KEYS = ['purchase_price', 'home_price', 'contract_price', 'listing_price', 'target_price']
const VALUE_KEYS = ['home_value', 'current_value', 'current_home_value', 'estimated_value', 'property_value']
const BALANCE_KEYS = ['loan_balance', 'current_balance', 'current_home_balance', 'mortgage_balance', 'balance_owed']
const CASH_OUT_KEYS = ['cash_out', 'cash_out_amount']
const NOTE_KEYS = ['notes', 'note', 'message', 'comments', 'comment', 'additional_info', 'questions', 'question', 'details']

/** Labels the forms' own names don't say well. */
const LABELS: Record<string, string> = {
  occupancy: 'Property use',
  property_use: 'Property use',
  location: 'Where',
  credit_range: 'Credit estimate',
  credit_score: 'Credit estimate',
  credit_estimate: 'Credit estimate',
  credit_score_range: 'Credit estimate',
  current_rate: 'Current rate',
  monthly_debts: 'Monthly debts',
  income_types: 'Income type',
  asset_sources: 'Assets in',
  property_address: 'Address',
  cash_out: 'Wants cash',
  cash_out_amount: 'Wants cash',
  ...Object.fromEntries(PRICE_KEYS.map((k) => [k, 'Purchase price'])),
  ...Object.fromEntries(VALUE_KEYS.map((k) => [k, 'Home value'])),
  ...Object.fromEntries(BALANCE_KEYS.map((k) => [k, 'Owes'])),
}

/** Yes/no answers shown as chips: what each says when true and when false. */
const CHECKS: Record<string, [string, string]> = {
  has_realtor: ['Has an agent', 'No agent yet'],
  has_agent: ['Has an agent', 'No agent yet'],
  working_with_realtor: ['Has an agent', 'No agent yet'],
  first_time_buyer: ['First-time buyer', 'Not first-time buyer'],
  first_time_home_buyer: ['First-time buyer', 'Not first-time buyer'],
  first_time_homebuyer: ['First-time buyer', 'Not first-time buyer'],
  fthb: ['First-time buyer', 'Not first-time buyer'],
  property_found: ['Found a home', 'Still looking'],
  requested_callback: ['Wants a call back', 'No call back asked'],
  veteran: ['Veteran', 'Not a veteran'],
  military: ['Military / veteran', 'Not military'],
  va_eligible: ['VA eligible', 'Not VA eligible'],
  pre_approved: ['Pre-approved', 'Not pre-approved'],
  preapproved: ['Pre-approved', 'Not pre-approved'],
  is_preapproved: ['Pre-approved', 'Not pre-approved'],
  self_employed: ['Self-employed', 'Not self-employed'],
}

/** The order fields show in, by group. Anything not listed goes to "Other". */
const LOAN_ORDER = ['goal', 'loan_purpose', 'refinance_goal', 'product_interest', 'buying_stage', 'lead_types', 'occupancy', 'property_use', 'property_type', 'location', 'city', 'zip', 'property_address', ...PRICE_KEYS, 'down_payment', 'down_payment_value', ...VALUE_KEYS, ...BALANCE_KEYS, ...CASH_OUT_KEYS, 'current_rate', 'closing_date', 'timeline']
const THEM_ORDER = ['credit_range', 'credit_score', 'credit_estimate', 'credit_score_range', 'employment', 'employment_type', 'employment_status', 'years_employed', 'income_types', 'income', 'annual_income', 'monthly_income', 'assets', 'asset_sources', 'savings', 'monthly_debts', 'debts', 'hourly_rate']

/** The same answer under several names (the website's multi-step form sends both): the first one present wins. */
const ALIASES = [
  ['income', 'income_amount', 'annual_income'],
  ['assets', 'available_assets'],
  ['monthly_debts', 'monthly_debt', 'debts'],
  ['first_time_buyer', 'first_time_homebuyer', 'first_time_home_buyer', 'fthb'],
  ['buying_stage', 'property_stage'],
  ['pre_approved', 'preapproved', 'is_preapproved'],
  ['has_realtor', 'has_agent', 'working_with_realtor'],
]

const MONEY = /(price|value|balance|amount|income|assets|savings|debts?|payment|rent|cash_out|hourly_rate|budget|equity)$/

/** "125000", "$125,000" or 125000 → 125000; null when it isn't one plain number (a range stays text). */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !/^\s*\$?\s*[\d,]+(\.\d+)?\s*%?\s*$/.test(v)) return null
  const n = Number(v.replace(/[$,%\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

const money = (n: number) => formatCurrency(n)
const isoDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim()) ? v.trim().slice(0, 10) : null)

/** "in 20 days", "today", "20 days ago". */
function daysAway(isoDate: string, now: Date): string {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((Date.parse(`${isoDate}T00:00:00Z`) - today) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

const yesNo = (v: unknown): boolean | null => {
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  return ['true', 'yes', 'y'].includes(t) ? true : ['false', 'no', 'n'].includes(t) ? false : null
}

export interface AnswerField {
  key: string
  label: string
  value: string
  /** Shown in gold, like every dollar amount in LOSuite. */
  money?: boolean
  /** A second, smaller line ("5%", "58% LTV", "in 20 days"). */
  sub?: string
}

export interface AnswerSection {
  id: 'loan' | 'them' | 'other'
  title: string
  fields: AnswerField[]
}

export interface AnswersView {
  sections: AnswerSection[]
  checks: { key: string; label: string; ok: boolean }[]
  note: string | null
  /** Source, UTM tags and landing page, from the answers and the saved tracking. */
  origin: { label: string; value: string }[]
  /** "google / cpc", for header lines. */
  originShort: string | null
  smsOk: boolean
}

/** One answer's display, given the other answers (down payment needs the price). */
function formatField(key: string, raw: unknown, all: Map<string, unknown>, now: Date): AnswerField | null {
  const label = LABELS[key] ?? fieldLabel(key)
  const price = PRICE_KEYS.map((k) => toNumber(all.get(k))).find((n) => n !== null && n > 0) ?? null

  if (key === 'down_payment' || key === 'down_payment_value') {
    const n = toNumber(raw)
    if (n === null) return { key, label: 'Down payment', value: textOf(raw) }
    const mode = String(all.get('down_payment_mode') ?? '').toLowerCase()
    const asPercent = mode ? mode.startsWith('percent') : n <= 100
    const pct = asPercent ? n : price ? Math.round((n / price) * 1000) / 10 : null
    const dollars = asPercent ? (price ? Math.round((price * n) / 100) : null) : n
    if (dollars === null) return { key, label: 'Down payment', value: formatPercent(pct, 1) }
    return { key, label: 'Down payment', value: pct === null ? money(dollars) : `${money(dollars)} · ${formatPercent(pct, 1)}`, money: true }
  }
  if (key === 'current_rate' || key === 'interest_rate') {
    const n = toNumber(raw)
    return { key, label, value: n === null ? textOf(raw) : formatPercent(n, 3) }
  }
  if (/^credit/.test(key) && (typeof raw === 'string' || typeof raw === 'number')) return { key, label, value: String(raw).trim().replace(/(\d)\s*-\s*(\d)/g, '$1–$2') }
  if (key.endsWith('_date') || key === 'date') {
    const day = isoDay(raw)
    if (day) return { key, label, value: formatIsoDate(day), sub: daysAway(day, now) }
  }
  if (MONEY.test(key)) {
    const n = toNumber(raw)
    if (n !== null) {
      const perYear = /income|salary/.test(key) && !/monthly/.test(key)
      const ltv = BALANCE_KEYS.includes(key) ? VALUE_KEYS.map((k) => toNumber(all.get(k))).find((v) => v !== null && v > 0) : null
      return { key, label, value: `${money(n)}${perYear ? '/yr' : /monthly/.test(key) || key === 'monthly_debts' ? '/mo' : ''}`, money: true, sub: ltv ? `${Math.round((n / ltv) * 100)}% LTV` : undefined }
    }
  }
  const b = yesNo(raw)
  if (b !== null) return { key, label, value: b ? 'Yes' : 'No' }
  const value = textOf(raw)
  return value ? { key, label, value } : null
}

/** Text for any answer: lists joined, one level of an object flattened, deeper levels skipped. Never JSON. */
function textOf(v: unknown): string {
  if (isBlank(v)) return ''
  if (typeof v === 'string') return sentenceCase(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.filter((x) => !isBlank(x) && typeof x !== 'object').map((x) => textOf(x)).join(', ')
  if (typeof v === 'object')
    return Object.entries(v as object)
      .filter(([, x]) => !isBlank(x) && typeof x !== 'object')
      .map(([k, x]) => `${fieldLabel(k)}: ${textOf(x)}`)
      .join(' · ')
  return ''
}

/** The answers, normalized: one value per key, blanks dropped. */
function answerMap(answers: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const [k, v] of Object.entries(answers)) {
    const key = normalKey(k)
    if (!isBlank(v) && !map.has(key)) map.set(key, v)
  }
  return map
}

/** Everything the Web forms card and the Today card show about one submission. */
export function answersView(answers: Record<string, unknown>, tracking: Record<string, string> = {}, now: Date = new Date()): AnswersView {
  const all = answerMap(answers)
  const used = new Set<string>()
  const take = (keys: string[]) =>
    keys.flatMap((k) => {
      if (used.has(k) || !all.has(k)) return []
      used.add(k)
      const f = formatField(k, all.get(k), all, now)
      return f ? [f] : []
    })

  // "Lead types: under-contract" next to "Buying stage: Already under contract" says nothing new.
  const stage = String(all.get('buying_stage') ?? '').toLowerCase()
  const types = String(all.get('lead_types') ?? '').toLowerCase().replace(/[_-]+/g, ' ')
  if (stage && types && stage.includes(types)) used.add('lead_types')
  if (all.has('down_payment')) used.add('down_payment_value')
  for (const group of ALIASES) {
    const first = group.find((k) => all.has(k))
    for (const k of group) if (k !== first) used.add(k)
  }

  const checks = Object.entries(CHECKS).flatMap(([k, [yes, no]]) => {
    const b = all.has(k) && !used.has(k) ? yesNo(all.get(k)) : null
    if (b === null) return []
    used.add(k)
    return [{ key: k, label: b ? yes : no, ok: b }]
  })
  const noteKey = NOTE_KEYS.find((k) => all.has(k) && typeof all.get(k) === 'string')
  if (noteKey) used.add(noteKey)
  // "Loan purpose: Get preapproved to buy" under "Goal: Get preapproved to buy" says nothing new.
  const loan = take(LOAN_ORDER).filter((f, i, list) => f.money || !list.slice(0, i).some((g) => g.value.toLowerCase() === f.value.toLowerCase()))
  const them = take(THEM_ORDER)
  const origin = [...all.entries()].filter(([k]) => isOrigin(k)).map(([k, v]) => ({ label: fieldLabel(k), value: textOf(v) }))
  for (const [k, v] of Object.entries(tracking)) if (!isBlank(v) && !all.has(normalKey(k))) origin.push({ label: fieldLabel(k), value: String(v) })
  const other = [...all.keys()].filter((k) => !used.has(k) && !isHidden(k) && !isOrigin(k))
  const sections: AnswerSection[] = [
    { id: 'loan' as const, title: 'The loan', fields: loan },
    { id: 'them' as const, title: 'Them', fields: them },
    { id: 'other' as const, title: 'Other', fields: take(other) },
  ].filter((s) => s.fields.length > 0)

  const src = (k: string) => {
    const v = all.get(k) ?? tracking[k]
    return isBlank(v) ? null : String(v).trim()
  }
  const short = [src('utm_source'), src('utm_medium')].filter(Boolean).join(' / ') || src('source') || src('lead_source')
  return {
    sections,
    checks,
    note: noteKey ? String(all.get(noteKey)).trim() : null,
    origin: origin.filter((o) => o.value),
    originShort: short && short !== 'mps_mortgage' ? short : null,
    smsOk: yesNo(all.get('sms_consent')) === true,
  }
}

/** Clean "Label: value" lines for the clipboard. */
export function answersText(view: AnswersView): string {
  return [
    ...view.sections.flatMap((s) => s.fields.map((f) => `${f.label}: ${f.value}`)),
    ...view.checks.map((c) => c.label),
    ...(view.note ? [`Their note: ${view.note}`] : []),
  ].join('\n')
}

/** Raw answers as sent (blanks dropped), for the Raw tab. */
export function rawLines(answers: Record<string, unknown>): { key: string; value: string }[] {
  return Object.entries(answers).flatMap(([k, v]) => (isBlank(v) ? [] : [{ key: k, value: typeof v === 'string' ? v : JSON.stringify(v) }]))
}

export interface LeadSummary {
  goal: string | null
  pills: string[]
  /** Up to 4 stat tiles for Today. */
  tiles: AnswerField[]
  note: string | null
  /** Answers not already on the row. */
  more: number
}

/** The Today row: the goal, a few pills and up to four figures, so a lead can be triaged without opening the file. */
export function leadSummary(view: AnswersView): LeadSummary {
  const fields = view.sections.flatMap((s) => s.fields)
  const get = (...keys: string[]) => fields.find((f) => keys.includes(f.key))
  const goal = get('goal', 'loan_purpose', 'refinance_goal', 'product_interest')
  const pills = [get('buying_stage'), get('occupancy', 'property_use'), get('location', 'city')].filter((f): f is AnswerField => !!f)
  const firstTime = view.checks.find((c) => c.key.includes('first_time') || c.key === 'fthb')
  const price = get(...PRICE_KEYS)
  const home = get(...VALUE_KEYS)
  const isRefi = !price && (!!home || /refi|cash|equity|heloc/i.test(goal?.value ?? ''))
  const credit = get('credit_range', 'credit_score', 'credit_estimate', 'credit_score_range')
  const underContract = /contract/i.test(`${get('buying_stage')?.value ?? ''} ${get('lead_types')?.value ?? ''}`)
  const when = underContract ? (get('closing_date') ?? get('timeline')) : (get('timeline') ?? get('closing_date'))
  const down = get('down_payment', 'down_payment_value')
  const downTile = down && { ...down, value: down.value.split(' · ')[0], sub: down.value.split(' · ')[1] }
  const tiles = (isRefi ? [home, get(...BALANCE_KEYS), get(...CASH_OUT_KEYS), credit] : [price, downTile, credit, when]).filter((f): f is AnswerField => !!f).slice(0, 4)
  const shown = new Set([goal, ...pills, ...tiles].filter(Boolean).map((f) => f!.key))
  const pillText = [...(firstTime?.ok ? [firstTime.label] : []), ...pills.map((p) => p.value)]
  return {
    goal: goal?.value ?? null,
    pills: pillText,
    tiles,
    note: view.note,
    more: fields.filter((f) => !shown.has(f.key)).length + view.checks.filter((c) => c !== firstTime || !c.ok).length,
  }
}

// ---------------------------------------------------------------------------
// Today: web forms nobody has handled yet
// ---------------------------------------------------------------------------

export interface OpenWebForm extends WebForm {
  kind: 'lead' | 'partner'
  /** Who sent it: the contact's name, or what the form says for partner inquiries. */
  name: string
  /** For partner inquiries (no file): email, phone and company from the form. */
  contactLine: string | null
}

interface OpenRow extends WebFormRow {
  kind: 'lead' | 'partner'
  contact: { first_name: string; last_name: string } | null
}

const str = (v: unknown) => (isBlank(v) ? '' : typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** Name and contact details from a form's answers (partner inquiries have no contact record). */
export function personFromAnswers(a: Record<string, unknown>): { name: string; contactLine: string | null } {
  const name = [str(a.first_name ?? a.firstName), str(a.last_name ?? a.lastName)].filter(Boolean).join(' ') || str(a.name ?? a.full_name) || str(a.email) || 'Someone'
  const company = str(a.brokerage ?? a.company ?? a.builder ?? a.business)
  const line = [str(a.email), str(a.phone ?? a.phone_number), company].filter(Boolean).join(' · ')
  return { name, contactLine: line || null }
}

export function useOpenWebForms() {
  return useQuery({
    queryKey: keys.openWebForms,
    queryFn: async () =>
      unwrap<OpenRow[]>(
        await db()
          .from('lead_submissions')
          .select('id, loan_id, kind, form_type, source, tracking, answers, outcome, received_at, contact:contacts!lead_submissions_contact_id_fkey ( first_name, last_name )')
          .is('handled_at', null)
          .order('received_at', { ascending: false })
          .limit(30),
      ).map((r): OpenWebForm => {
        const fromForm = personFromAnswers(r.answers ?? {})
        return {
          id: r.id,
          loanId: r.loan_id,
          kind: r.kind,
          formType: r.form_type,
          source: r.source,
          tracking: r.tracking ?? {},
          answers: r.answers ?? {},
          outcome: r.outcome,
          receivedAt: r.received_at,
          name: r.contact ? `${r.contact.first_name} ${r.contact.last_name}`.trim() : fromForm.name,
          contactLine: r.loan_id ? null : fromForm.contactLine,
        }
      }),
  })
}

export function useMarkHandled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, handled }: { id: string; handled: boolean }) => {
      const ok = unwrap<boolean>(await db().rpc('mark_submission_handled', { p_id: id, p_handled: handled }))
      if (!ok) throw new Error('This form was not found, or you do not have access.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.openWebForms }),
  })
}
