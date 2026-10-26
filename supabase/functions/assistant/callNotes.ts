// The assistant's "read call notes" task: what it pulls out of Connor's
// notes from a phone call, the JSON shape it must return, and the checks on
// what comes back. Pure, with no imports, so the Edge Function (Deno) and
// the app (review screen and tests) share the same lists and rules.
//
// The assistant reads; it never calculates. Monthly amounts are what the
// notes say; anything yearly, hourly or "about" is left for the code or
// Connor, never converted by the model.

export type Confidence = 'high' | 'medium' | 'low'

// These lists match the app's options (src/lib/urla/options.ts); a test checks they stay the same.
export const INCOME_TYPES = [
  'alimony', 'automobile_allowance', 'boarder_income', 'capital_gains', 'child_support', 'disability', 'foster_care', 'housing_or_parsonage',
  'interest_and_dividends', 'mortgage_credit_certificate', 'mortgage_differential', 'notes_receivable', 'public_assistance', 'retirement', 'royalty',
  'separate_maintenance', 'social_security', 'trust', 'unemployment', 'va_compensation', 'other',
] as const
export const ASSET_TYPES = [
  'checking', 'savings', 'money_market', 'certificate_of_deposit', 'mutual_fund', 'stocks', 'stock_options', 'bonds', 'retirement', 'bridge_loan_proceeds',
  'individual_development_account', 'trust_account', 'cash_value_life_insurance', 'proceeds_real_estate_sale', 'proceeds_non_real_estate_sale',
  'secured_borrowed_funds', 'unsecured_borrowed_funds', 'other_liquid', 'earnest_money', 'employer_assistance', 'lot_equity', 'relocation_funds', 'rent_credit',
  'sweat_equity', 'trade_equity', 'other_credit', 'gift_cash', 'gift_equity', 'grant',
] as const
export const DEBT_TYPES = ['revolving', 'installment', 'open_30_day', 'lease', 'other', 'alimony', 'child_support', 'separate_maintenance', 'job_related_expenses', 'other_expense'] as const
export const LOAN_TYPES = ['conventional', 'fha', 'va', 'usda_rural', 'other'] as const
export const DOC_TYPES = ['full_doc', 'bank_statement', 'form_1099', 'asset_based', 'dscr'] as const
export const EVENT_TYPES = ['bankruptcy_ch7', 'bankruptcy_ch13', 'foreclosure', 'short_sale', 'deed_in_lieu', 'late_payment', 'collection'] as const
export const HOME_PLANS = ['keep', 'rent', 'sell'] as const

type Source = { quote: string; confidence: Confidence }
/** Who it's about: a first name from the notes, or null for the main borrower. */
type Who = { borrower: string | null }

/** One fact read from the notes, typed and checked. */
export type NoteItem = { id: string; quoteFound: boolean } & Source &
  (
    | { kind: 'loan_type'; value: (typeof LOAN_TYPES)[number] }
    | { kind: 'purchase_price'; value: number }
    | { kind: 'down_payment'; value: number }
    | { kind: 'down_payment_pct'; value: number }
    | ({ kind: 'credit_score'; value: number } & Who)
    | ({ kind: 'first_time_buyer'; value: boolean } & Who)
    | ({ kind: 'job'; employer: string; selfEmployed: boolean; monthly: number | null; startDate: string | null; years: number | null } & Who)
    | ({ kind: 'other_income'; incomeType: (typeof INCOME_TYPES)[number]; monthly: number } & Who)
    | ({ kind: 'debt'; debtType: (typeof DEBT_TYPES)[number]; creditor: string; monthlyPayment: number; balance: number | null; payOff: boolean } & Who)
    | ({ kind: 'savings'; assetType: (typeof ASSET_TYPES)[number]; institution: string; amount: number } & Who)
    | { kind: 'home'; address: string; value: number | null; owed: number | null; plan: (typeof HOME_PLANS)[number] | null; monthlyRent: number | null }
    | ({ kind: 'credit_event'; eventType: (typeof EVENT_TYPES)[number]; date: string | null; daysLate: number | null; isMortgage: boolean } & Who)
    | { kind: 'doc_type'; value: (typeof DOC_TYPES)[number] }
    | { kind: 'timeline'; value: string }
  )

export interface NoteReading {
  items: NoteItem[]
  notes: string | null
}

const str = { type: 'string' } as const
const source = { quote: { type: 'string', description: 'The words from the notes, copied exactly.' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } } as const
const who = { borrower: { type: 'string', description: 'First name of who this is about, as written in the notes. Empty for the main borrower.' } } as const
const money = (d: string) => ({ type: 'string', description: `${d} Digits only (9800 or 9800.50); empty if not stated.` })
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const list = (description: string, properties: Record<string, unknown>) => ({ type: 'array', description, items: obj({ ...properties, ...source }) })
const single = (description: string, value: Record<string, unknown>) => obj({ found: { type: 'boolean', description }, value, ...source })

/** The JSON shape Claude must return (enforced by structured outputs, then checked again here). */
export const NOTES_SCHEMA = obj({
  loan_type: single('Loan type mentioned or clearly intended.', { type: 'string', enum: [...LOAN_TYPES, ''] }),
  purchase_price: single('Price of the home they want, or their target price.', money('Price.')),
  down_payment: single('Down payment in dollars, if stated in dollars.', money('Amount.')),
  down_payment_pct: single('Down payment as a percent, if stated as a percent.', { type: 'string', description: 'Number only (3.5); empty if not stated.' }),
  income_doc_type: single('How income would be documented, only if the notes say (e.g. bank statements, 1099 only).', { type: 'string', enum: [...DOC_TYPES, ''] }),
  timeline: single('When they want to buy or refinance, in their words.', str),
  credit_scores: list('Estimated credit scores.', { ...who, score: { type: 'string', description: 'Whole number.' } }),
  first_time_buyers: list('Whether someone is a first-time buyer (has not owned a home in 3 years).', { ...who, first_time: { type: 'boolean' } }),
  jobs: list('Jobs and businesses.', {
    ...who,
    employer: { type: 'string', description: 'Employer or business name, or a short description like "landscaping business".' },
    self_employed: { type: 'boolean' },
    monthly_income: money('Gross monthly income only if stated monthly. Leave empty for yearly, hourly or weekly figures.'),
    start_date: { type: 'string', description: 'YYYY-MM-DD only if a start date or month/year is stated (use the 1st); empty otherwise. Do not turn "6 years" into a date.' },
    years: { type: 'string', description: 'Years at the job or in business if stated (e.g. 6); empty otherwise.' },
  }),
  other_incomes: list('Other monthly income (social security, child support, pension...).', { ...who, income_type: { type: 'string', enum: [...INCOME_TYPES] }, monthly: money('Monthly amount.') }),
  debts: list('Monthly debts (car, cards, student loans, child support paid...). Not their current mortgage.', {
    ...who,
    debt_type: { type: 'string', enum: [...DEBT_TYPES] },
    creditor: { type: 'string', description: 'Lender or what it is (e.g. "truck loan").' },
    monthly_payment: money('Monthly payment.'),
    balance: money('Balance owed.'),
    pay_off: { type: 'boolean', description: 'True only if the notes say it will be paid off at closing.' },
  }),
  savings: list('Money they have: checking, savings, retirement, gifts.', { ...who, asset_type: { type: 'string', enum: [...ASSET_TYPES] }, institution: str, amount: money('Amount.') }),
  homes: list('Homes they already own.', {
    address: { type: 'string', description: 'Address or description (e.g. "current house").' },
    value: money('What it is worth.'),
    owed: money('What they owe on it.'),
    plan: { type: 'string', enum: [...HOME_PLANS, ''], description: 'What they plan to do with it, if said.' },
    monthly_rent: money('Rent it brings in or would bring in, monthly.'),
  }),
  credit_events: list('Bankruptcies, foreclosures, short sales, deeds in lieu, late payments and collections.', {
    ...who,
    event_type: { type: 'string', enum: [...EVENT_TYPES] },
    date: { type: 'string', description: 'YYYY-MM-DD of discharge/completion or the late payment; use the 1st of the month, or January 1st if only a year is given. Empty if no date at all.' },
    days_late: { type: 'string', enum: ['30', '60', '90', '120', ''] },
    is_mortgage: { type: 'boolean', description: 'True if a late payment was on a mortgage.' },
  }),
  notes: { type: 'string', description: 'Anything Connor should know that does not fit above (people not on the file, contradictions, goals). Empty if nothing.' },
})

export const NOTES_SYSTEM_PROMPT = `You read Connor's notes from phone calls with mortgage borrowers. Connor is a licensed loan officer at MPS Mortgage LLC in Dallas-Fort Worth, Texas. Notes are quick and informal, for example: "Marcus, landscaping biz 6 yrs, ~$9,800/mo, house worth 467, owes 282, wants 75K cash out, 652 credit, one late on truck 2024".

Your reading is reviewed by Connor item by item before anything is used, so accuracy matters more than completeness:
- Report only what the notes say. Never guess a number that isn't written.
- Do not calculate or convert. Don't turn yearly pay into monthly, hours into pay, or "6 years" into a start date. Leave those fields empty; Connor will fill them.
- Shorthand like "467" or "75K" for home values and cash amounts means thousands: 467000 and 75000.
- Copy the quote exactly as written in the notes, so Connor can see where each item came from.
- Use medium or low confidence for anything you had to interpret ("~", "about", unclear who it belongs to).
- The main borrower's items get an empty borrower name. For a spouse or co-borrower, give their first name if the notes do.
- Put anything that doesn't fit, including people who might need to be added to the file, in notes.`

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const CONF = ['high', 'medium', 'low'] as const

/** A money or number field: digits only, never negative. */
export function parseAmount(v: unknown): number | null {
  const t = text(v).replace(/[$,\s]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function parseDate(v: unknown): string | null {
  const t = text(v)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const d = new Date(`${t}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null
}

const oneOf = <T extends string>(options: readonly T[], v: unknown): T | null => (options as readonly string[]).includes(text(v)) ? (text(v) as T) : null
const squash = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Checks Claude's reading against the note. Items whose quote isn't in the
 * note are kept but marked low confidence, so nothing is trusted unseen.
 */
export function normalizeNotes(raw: unknown, noteText: string): NoteReading | { error: string } {
  if (!isObject(raw)) return { error: 'The assistant returned something unreadable.' }
  const note = squash(noteText)
  const items: NoteItem[] = []
  const push = (fields: Record<string, unknown>, from: Record<string, unknown>) => {
    const quote = text(from.quote)
    const quoteFound = !!quote && note.includes(squash(quote))
    const confidence = quoteFound ? (CONF.find((c) => c === from.confidence) ?? 'low') : 'low'
    items.push({ id: `i${items.length + 1}`, quote, confidence, quoteFound, ...fields } as NoteItem)
  }
  const who = (o: Record<string, unknown>) => ({ borrower: text(o.borrower) || null })
  const found = (k: string) => (isObject(raw[k]) && raw[k].found === true ? (raw[k] as Record<string, unknown>) : null)
  const each = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]).filter(isObject) : [])

  const lt = found('loan_type')
  if (lt && oneOf(LOAN_TYPES, lt.value)) push({ kind: 'loan_type', value: oneOf(LOAN_TYPES, lt.value) }, lt)
  for (const [key, kind] of [['purchase_price', 'purchase_price'], ['down_payment', 'down_payment'], ['down_payment_pct', 'down_payment_pct']] as const) {
    const f = found(key)
    const n = f ? parseAmount(f.value) : null
    if (f && n !== null && (kind !== 'down_payment_pct' || n <= 100)) push({ kind, value: n }, f)
  }
  const dt = found('income_doc_type')
  if (dt && oneOf(DOC_TYPES, dt.value)) push({ kind: 'doc_type', value: oneOf(DOC_TYPES, dt.value) }, dt)
  const tl = found('timeline')
  if (tl && text(tl.value)) push({ kind: 'timeline', value: text(tl.value) }, tl)

  for (const s of each('credit_scores')) {
    const n = parseAmount(s.score)
    if (n !== null && Number.isInteger(n) && n >= 300 && n <= 850) push({ kind: 'credit_score', value: n, ...who(s) }, s)
  }
  for (const f of each('first_time_buyers')) if (typeof f.first_time === 'boolean') push({ kind: 'first_time_buyer', value: f.first_time, ...who(f) }, f)
  for (const j of each('jobs')) {
    if (!text(j.employer)) continue
    push({ kind: 'job', employer: text(j.employer), selfEmployed: j.self_employed === true, monthly: parseAmount(j.monthly_income), startDate: parseDate(j.start_date), years: parseAmount(j.years), ...who(j) }, j)
  }
  for (const o of each('other_incomes')) {
    const type = oneOf(INCOME_TYPES, o.income_type)
    const monthly = parseAmount(o.monthly)
    if (type && monthly !== null) push({ kind: 'other_income', incomeType: type, monthly, ...who(o) }, o)
  }
  for (const d of each('debts')) {
    const type = oneOf(DEBT_TYPES, d.debt_type)
    const payment = parseAmount(d.monthly_payment)
    if (type && payment !== null) push({ kind: 'debt', debtType: type, creditor: text(d.creditor), monthlyPayment: payment, balance: parseAmount(d.balance), payOff: d.pay_off === true, ...who(d) }, d)
  }
  for (const s of each('savings')) {
    const type = oneOf(ASSET_TYPES, s.asset_type)
    const amount = parseAmount(s.amount)
    if (type && amount !== null) push({ kind: 'savings', assetType: type, institution: text(s.institution), amount, ...who(s) }, s)
  }
  for (const h of each('homes')) {
    if (!text(h.address)) continue
    push({ kind: 'home', address: text(h.address), value: parseAmount(h.value), owed: parseAmount(h.owed), plan: oneOf(HOME_PLANS, h.plan), monthlyRent: parseAmount(h.monthly_rent) }, h)
  }
  for (const e of each('credit_events')) {
    const type = oneOf(EVENT_TYPES, e.event_type)
    if (!type) continue
    const daysLate = type === 'late_payment' ? (parseAmount(e.days_late) ?? 30) : null
    push({ kind: 'credit_event', eventType: type, date: parseDate(e.date), daysLate, isMortgage: type === 'late_payment' && e.is_mortgage === true, ...who(e) }, e)
  }
  if (items.length === 0) return { error: "The assistant didn't find anything to use in this note." }
  return { items, notes: text(raw.notes) || null }
}
