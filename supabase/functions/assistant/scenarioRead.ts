// The assistant's "read a scenario sentence" task (Product Search v2 step 9,
// Ask the assistant): the JSON shape it must return, its instructions, and the
// checks on what comes back. Pure, with no imports, so the Edge Function
// (Deno) and the app (chips and tests) share it. The word lists match
// src/lib/products/taxonomy.ts (a test checks).
//
// The AI only reads the sentence. Down payment and LTV become a loan amount
// here, in code, and the search that follows is the same rule-based search as
// the form (no AI).

export const SCENARIO_FAMILIES = ['conventional', 'fha', 'va', 'usda', 'jumbo', 'non_qm', 'any'] as const
export const SCENARIO_LIENS = ['first', 'ces', 'heloc'] as const
export const SCENARIO_DOC_TYPES = ['full_doc', 'bank_statement_12', 'bank_statement_24', 'form_1099', 'pnl_only', 'asset_depletion', 'dscr', 'wvoe', 'no_ratio', 'retirement_distribution'] as const
export const SCENARIO_FEATURES = ['dpa', 'itin', 'foreign_national', 'interest_only', 'non_warrantable_condo', 'manufactured', 'buydown', 'recent_credit_event', 'first_time_investor', 'str_income', 'homeready_possible', 'llc_vesting'] as const
export const SCENARIO_PURPOSES = ['purchase', 'rate_term', 'cash_out'] as const
export const SCENARIO_OCCUPANCIES = ['primary', 'second_home', 'investment'] as const
export const SCENARIO_PROPERTY_TYPES = ['sfr_pud', 'condo', 'non_warrantable_condo', 'two_to_four', 'manufactured', 'mixed_use', 'condotel', 'rural', 'five_plus'] as const
export const SCENARIO_CITIZENSHIPS = ['us_citizen', 'permanent_resident', 'non_permanent_resident', 'itin', 'foreign_national'] as const

type Of<T extends readonly string[]> = T[number]

/** What the sentence said, field by field (null = not mentioned). */
export interface ScenarioRead {
  lien: Of<typeof SCENARIO_LIENS> | null
  family: Of<typeof SCENARIO_FAMILIES> | null
  docType: Of<typeof SCENARIO_DOC_TYPES> | null
  features: Of<typeof SCENARIO_FEATURES>[]
  purpose: Of<typeof SCENARIO_PURPOSES> | null
  occupancy: Of<typeof SCENARIO_OCCUPANCIES> | null
  propertyType: Of<typeof SCENARIO_PROPERTY_TYPES> | null
  units: number | null
  state: string | null
  county: string | null
  purchasePrice: number | null
  value: number | null
  loanAmount: number | null
  firstLienBalance: number | null
  fico: number | null
  dti: number | null
  reservesMonths: number | null
  dscr: number | null
  citizenship: Of<typeof SCENARIO_CITIZENSHIPS> | null
  mortgageLates12: number | null
  mortgageLates24: number | null
  bkSeasoningMonths: number | null
  fcSeasoningMonths: number | null
  selfEmployedYears: number | null
  firstTimeBuyer: boolean | null
  homestead: boolean | null
}

export type ReadField = keyof ScenarioRead

/** One field the assistant read, with the words it came from (shown as an editable chip). */
export interface ReadEvidence {
  field: ReadField
  words: string
  /** The words really are in the sentence. */
  found: boolean
}

export interface ScenarioReading {
  read: ScenarioRead
  evidence: ReadEvidence[]
  /** Things the sentence left unclear, as short questions. */
  unclear: string[]
}

// Structured outputs allow at most 16 "value or null" fields per form, so
// words and numbers that weren't said come back empty ("" or -1) instead of
// null; the checks below turn those into "not stated". Only yes/no stays nullable.
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })
const choice = (values: readonly string[]) => ({ type: 'string', enum: ['', ...values], description: '"" when not stated.' })
const number = () => ({ type: 'number', description: '-1 when not stated.' })
const integer = () => ({ type: 'integer', description: '-1 when not stated.' })
const text = () => ({ type: 'string', description: '"" when not stated.' })
const flag = () => nullable({ type: 'boolean' })

const READ_PROPERTIES = {
  lien: choice(SCENARIO_LIENS),
  family: choice(SCENARIO_FAMILIES),
  docType: choice(SCENARIO_DOC_TYPES),
  features: { type: 'array', items: { type: 'string', enum: [...SCENARIO_FEATURES] } },
  purpose: choice(SCENARIO_PURPOSES),
  occupancy: choice(SCENARIO_OCCUPANCIES),
  propertyType: choice(SCENARIO_PROPERTY_TYPES),
  units: integer(),
  state: text(),
  county: text(),
  purchasePrice: number(),
  value: number(),
  loanAmount: number(),
  downPaymentPct: number(),
  ltvPct: number(),
  firstLienBalance: number(),
  fico: integer(),
  dti: number(),
  reservesMonths: number(),
  dscr: number(),
  citizenship: choice(SCENARIO_CITIZENSHIPS),
  mortgageLates12: integer(),
  mortgageLates24: integer(),
  bkSeasoningMonths: integer(),
  fcSeasoningMonths: integer(),
  selfEmployedYears: number(),
  firstTimeBuyer: flag(),
  homestead: flag(),
}

export const SCENARIO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['read', 'evidence', 'unclear'],
  properties: {
    read: { type: 'object', additionalProperties: false, required: Object.keys(READ_PROPERTIES), properties: READ_PROPERTIES },
    evidence: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['field', 'words'], properties: { field: { type: 'string', enum: Object.keys(READ_PROPERTIES) }, words: { type: 'string' } } },
    },
    unclear: { type: 'array', items: { type: 'string' } },
  },
}

export const SCENARIO_SYSTEM_PROMPT = `You read a loan officer's one-line description of a borrower's mortgage scenario and fill in a search form. You only read; you never judge eligibility or suggest lenders.

Rules:
- Fill in only what the sentence says or clearly implies. Leave everything else empty: "" for words and codes, -1 for numbers, null for yes/no (features: an empty list). Never guess a credit score, income, DTI or value.
- Product type: lien "first" unless it says second, closed-end second, CES, HELOAN ("ces") or HELOC ("heloc"). family: conventional, fha, va, usda, jumbo, non_qm, or "any" when it says any or doesn't care. A DSCR, bank statement, P&L, 1099, asset depletion or IRA distribution loan is non_qm. docType: dscr for DSCR, bank_statement_12 / bank_statement_24 for bank statements (12 if no months are given), form_1099, pnl_only, asset_depletion, wvoe, no_ratio, retirement_distribution (income from IRA or retirement account distributions), otherwise full_doc when the income is W-2 or tax returns.
- Features only when stated: dpa (down payment assistance), itin, foreign_national, interest_only, non_warrantable_condo, manufactured, buydown, recent_credit_event, first_time_investor, str_income (short-term rental income), homeready_possible, llc_vesting (closing in an LLC).
- purpose: purchase, rate_term (refi with no cash out), cash_out. occupancy: primary, second_home, investment (investor, rental, NOO, DSCR usually means investment).
- propertyType: sfr_pud (house, SFR, single family, PUD, townhome), condo, non_warrantable_condo, two_to_four (duplex, triplex, fourplex; set units 2 to 4), five_plus (5 or more units; set units), manufactured, mixed_use.
- Money: "$450k" is 450000, "1.2M" is 1200000. purchasePrice for a purchase; value for an appraised or estimated value. loanAmount only if a loan amount is stated. Put a down payment percent in downPaymentPct ("5% down" = 5) and a stated LTV in ltvPct; never work out the loan amount yourself. firstLienBalance is the existing first mortgage balance on a second-lien scenario.
- fico is a whole number (a range like 700-719 means the lower end). dti and reservesMonths are numbers ("6 months reserves" = 6). dscr is a ratio like 1.1.
- Credit events: months since a bankruptcy (bkSeasoningMonths) or foreclosure, short sale or deed in lieu (fcSeasoningMonths); "2 years ago" = 24. Mortgage lates in the last 12 or 24 months as counts.
- state is a two-letter code ("Texas", "Dallas", "Frisco" mean TX); county only if named.
- For every field you fill in, add an evidence item with the exact words from the sentence it came from, copied character for character.
- unclear lists short questions about anything important that is ambiguous (at most 3). Empty when nothing is.`

const isOneOf = <T extends readonly string[]>(values: T, v: unknown): v is T[number] => typeof v === 'string' && (values as readonly string[]).includes(v)
const asNumber = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)
const whole = (v: number | null) => (v == null ? null : Math.round(v))
const squash = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()

/**
 * Checks a reading and turns it into search-form values: bad values are
 * dropped, a down payment percent or LTV becomes a loan amount, and each
 * field's words are checked against the sentence.
 */
export function normalizeScenarioRead(raw: unknown, sentence: string): ScenarioReading | { error: string } {
  const r = (raw as { read?: Record<string, unknown> } | null)?.read
  if (!r || typeof r !== 'object') return { error: 'The assistant returned no reading. Try again.' }
  const price = asNumber(r.purchasePrice, 1000, 100_000_000)
  const value = asNumber(r.value, 1000, 100_000_000)
  const downPct = asNumber(r.downPaymentPct, 0, 100)
  const ltvPct = asNumber(r.ltvPct, 1, 100)
  const base = price ?? value
  let loanAmount = asNumber(r.loanAmount, 1000, 100_000_000)
  if (loanAmount == null && base != null && downPct != null) loanAmount = Math.round(base * (1 - downPct / 100))
  if (loanAmount == null && base != null && ltvPct != null) loanAmount = Math.round((base * ltvPct) / 100)
  const state = typeof r.state === 'string' && /^[A-Za-z]{2}$/.test(r.state.trim()) ? r.state.trim().toUpperCase() : null

  const read: ScenarioRead = {
    lien: isOneOf(SCENARIO_LIENS, r.lien) ? r.lien : null,
    family: isOneOf(SCENARIO_FAMILIES, r.family) ? r.family : null,
    docType: isOneOf(SCENARIO_DOC_TYPES, r.docType) ? r.docType : null,
    features: Array.isArray(r.features) ? [...new Set(r.features.filter((f): f is Of<typeof SCENARIO_FEATURES> => isOneOf(SCENARIO_FEATURES, f)))] : [],
    purpose: isOneOf(SCENARIO_PURPOSES, r.purpose) ? r.purpose : null,
    occupancy: isOneOf(SCENARIO_OCCUPANCIES, r.occupancy) ? r.occupancy : null,
    propertyType: isOneOf(SCENARIO_PROPERTY_TYPES, r.propertyType) ? r.propertyType : null,
    units: whole(asNumber(r.units, 1, 20)),
    state,
    county: typeof r.county === 'string' && r.county.trim() ? r.county.trim() : null,
    purchasePrice: price,
    value,
    loanAmount,
    firstLienBalance: asNumber(r.firstLienBalance, 0, 100_000_000),
    fico: whole(asNumber(r.fico, 300, 850)),
    dti: asNumber(r.dti, 0, 100),
    reservesMonths: asNumber(r.reservesMonths, 0, 240),
    dscr: asNumber(r.dscr, 0, 10),
    citizenship: isOneOf(SCENARIO_CITIZENSHIPS, r.citizenship) ? r.citizenship : null,
    mortgageLates12: whole(asNumber(r.mortgageLates12, 0, 12)),
    mortgageLates24: whole(asNumber(r.mortgageLates24, 0, 24)),
    bkSeasoningMonths: whole(asNumber(r.bkSeasoningMonths, 0, 600)),
    fcSeasoningMonths: whole(asNumber(r.fcSeasoningMonths, 0, 600)),
    selfEmployedYears: asNumber(r.selfEmployedYears, 0, 80),
    firstTimeBuyer: typeof r.firstTimeBuyer === 'boolean' ? r.firstTimeBuyer : null,
    homestead: typeof r.homestead === 'boolean' ? r.homestead : null,
  }
  // A duplex/triplex/fourplex sets the units if the reading forgot; 5 or more units is a 5+ unit building.
  if (read.units != null && read.units >= 5) read.propertyType = 'five_plus'
  if (read.propertyType === 'two_to_four' && read.units == null) read.units = 2
  if (read.propertyType === 'five_plus' && read.units == null) read.units = 5

  const filled = new Set(Object.entries(read).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0)).map(([k]) => k))
  // The loan amount may have come from the down payment or LTV words.
  const alias: Record<string, ReadField> = { downPaymentPct: 'loanAmount', ltvPct: 'loanAmount' }
  const sentenceText = squash(sentence)
  const raws = (raw as { evidence?: unknown }).evidence
  const evidence: ReadEvidence[] = []
  for (const e of Array.isArray(raws) ? raws : []) {
    const name = typeof e?.field === 'string' ? (alias[e.field] ?? e.field) : null
    const words = typeof e?.words === 'string' ? e.words.trim() : ''
    if (!name || !words || !filled.has(name) || evidence.some((x) => x.field === name)) continue
    evidence.push({ field: name as ReadField, words, found: sentenceText.includes(squash(words)) })
  }
  const unclear = Array.isArray((raw as { unclear?: unknown }).unclear) ? ((raw as { unclear: unknown[] }).unclear.filter((u) => typeof u === 'string' && u.trim()).slice(0, 3) as string[]) : []
  if (filled.size === 0) return { error: "I couldn't find a loan scenario in that. Try something like “Conventional purchase, $450k, 5% down, 720, primary SFR in Frisco”." }
  return { read, evidence, unclear }
}
