// Quick Quote math: loan options for a borrower before a full pre-qual.
// Each option runs through the same pricing engine as the Fees tab
// (`priceScenario`: payment with mortgage insurance, the company fee list,
// prepaids and escrows), so the quote and the Fees tab never disagree.
// Rates and points are percents (6.375, 1.000).

import { round, type FeeTemplate } from '@/lib/calc'
import type { MortgageType, Occupancy, PropertyType } from '@/lib/api/types'
import { cashFigure, priceScenario, type ScenarioDraft } from '@/lib/pricing/scenario'
import { estimatedApr } from './apr'

export type QuotePurpose = 'purchase' | 'refinance_rate_term' | 'refinance_cash_out'

export const QUOTE_PURPOSES: { value: QuotePurpose; label: string }[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'refinance_rate_term', label: 'Rate/term' },
  { value: 'refinance_cash_out', label: 'Cash-out' },
]

/** Default estimates until a county rate is known (the Prequal tab's defaults). */
export const DEFAULT_TAX_RATE_PCT = 2.2
export const DEFAULT_ANNUAL_INSURANCE = 3600
/** Prepaid interest with no closing date yet: about half a month (Connor, 2026-10-30). */
export const ASSUMED_PREPAID_INTEREST_DAYS = 15
export const MAX_OPTIONS = 4
export const DEFAULT_VALID_DAYS = 7

/**
 * Yearly property tax rates by county, as a percent of the price. Empty until
 * Connor sends the old app's 14 counties; every county uses the default rate
 * until then.
 */
export const COUNTY_TAX_RATES: Record<string, number> = {}

export interface QuoteBorrower {
  name: string
  email: string
  phone: string
}

export interface QuoteScenario {
  borrower: QuoteBorrower
  purpose: QuotePurpose
  /** Purchase only. */
  purchasePrice: number | null
  /** Purchase only: the scenario's down payment in dollars (an option can use its own). */
  downPayment: number | null
  /** Refinance: the home's value. */
  value: number | null
  /** Refinance: the mortgage balance paid off. */
  loanBalance: number | null
  /** Cash-out: cash the borrower wants back (added to the loan). */
  cashOut: number | null
  /** Low end of the 20-point credit range (700 = 700–719); null = not known. */
  creditBucket: number | null
  occupancy: Occupancy
  propertyType: PropertyType
  county: string | null
  state: string
  firstTimeBuyer: boolean
  vaEligible: boolean
  showDpa: boolean
  /** Monthly overrides; null = the estimate. */
  taxesMonthly: number | null
  insuranceMonthly: number | null
}

export type QuoteBadge = 'recommended' | 'lowest_payment' | 'least_cash'

export const BADGE_LABEL: Record<QuoteBadge, string> = { recommended: 'Recommended', lowest_payment: 'Lowest payment', least_cash: 'Least cash to close' }

export interface QuoteOption {
  id: string
  lenderId: string | null
  lenderName: string | null
  programId: string | null
  programName: string | null
  mortgageType: MortgageType
  termMonths: number
  /** Entered by hand; null until typed. */
  ratePct: number | null
  pointsPct: number
  /** Purchase: this option's own down payment in dollars; null = the scenario's. */
  downPayment: number | null
  /** Typed closing costs (points included); null = the fee engine's estimate. */
  closingCostsOverride: number | null
  onQuote: boolean
  recommended: boolean
}

export function blankScenario(): QuoteScenario {
  return {
    borrower: { name: '', email: '', phone: '' },
    purpose: 'purchase',
    purchasePrice: null,
    downPayment: null,
    value: null,
    loanBalance: null,
    cashOut: null,
    creditBucket: null,
    occupancy: 'primary',
    propertyType: 'single_family',
    county: null,
    state: 'TX',
    firstTimeBuyer: false,
    vaEligible: false,
    showDpa: false,
    taxesMonthly: null,
    insuranceMonthly: null,
  }
}

export function blankOption(id: string, over: Partial<QuoteOption> = {}): QuoteOption {
  return {
    id,
    lenderId: null,
    lenderName: null,
    programId: null,
    programName: null,
    mortgageType: 'conventional',
    termMonths: 360,
    ratePct: null,
    pointsPct: 0,
    downPayment: null,
    closingCostsOverride: null,
    onQuote: true,
    recommended: false,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Credit ranges
// ---------------------------------------------------------------------------

/** 20-point credit ranges, from "Under 580" to "780+" (the value is the low end; 0 = under 580). */
export const CREDIT_BUCKETS: { value: number; label: string }[] = [
  { value: 0, label: 'Under 580' },
  ...Array.from({ length: 10 }, (_, i) => 580 + i * 20).map((low) => ({ value: low, label: `${low}–${low + 19}` })),
  { value: 780, label: '780+' },
]

export const creditLabel = (bucket: number | null) => CREDIT_BUCKETS.find((b) => b.value === bucket)?.label ?? null

/** The bucket a score falls in (a 712 is 700–719). */
export function bucketFor(score: number | null): number | null {
  if (score == null || !Number.isFinite(score)) return null
  if (score < 580) return 0
  if (score >= 780) return 780
  return 580 + Math.floor((score - 580) / 20) * 20
}

/** The score to save or search with: the low end of the range ("Under 580" counts as 579). */
export const scoreFor = (bucket: number | null) => (bucket == null ? null : bucket === 0 ? 579 : bucket)

// ---------------------------------------------------------------------------
// Down payment, taxes and insurance
// ---------------------------------------------------------------------------

const isPurchase = (s: Pick<QuoteScenario, 'purpose'>) => s.purpose === 'purchase'

/** Down payment percent from dollars (3 decimals), or null without a price. */
export const downPct = (price: number | null, amount: number | null) => (price && amount != null ? round((amount / price) * 100, 3) : null)
/** Down payment dollars from a percent of the price. */
export const downAmount = (price: number | null, pct: number) => (price ? round((price * pct) / 100, 0) : null)

/** What taxes are figured on: the price on a purchase, else the value. */
export const taxBasis = (s: QuoteScenario) => (isPurchase(s) ? s.purchasePrice : s.value)

export function countyTaxRate(county: string | null): { ratePct: number; fromCounty: boolean } {
  const key = county?.trim().replace(/\s+county$/i, '').toLowerCase()
  const hit = key ? Object.entries(COUNTY_TAX_RATES).find(([name]) => name.toLowerCase() === key) : undefined
  return hit ? { ratePct: hit[1], fromCounty: true } : { ratePct: DEFAULT_TAX_RATE_PCT, fromCounty: false }
}

export interface HousingEstimate {
  taxesMonthly: number
  insuranceMonthly: number
  /** True when the figure is the estimate (not typed over). */
  taxesEstimated: boolean
  insuranceEstimated: boolean
  taxRatePct: number
  taxRateFromCounty: boolean
}

/** Monthly taxes and insurance: the typed figures, else the county (or default) rate and $3,600 a year. */
export function housingEstimate(s: QuoteScenario): HousingEstimate {
  const rate = countyTaxRate(s.county)
  const basis = taxBasis(s)
  const estTaxes = basis ? round((basis * rate.ratePct) / 100 / 12) : 0
  return {
    taxesMonthly: s.taxesMonthly ?? estTaxes,
    insuranceMonthly: s.insuranceMonthly ?? round(DEFAULT_ANNUAL_INSURANCE / 12),
    taxesEstimated: s.taxesMonthly == null,
    insuranceEstimated: s.insuranceMonthly == null,
    taxRatePct: rate.ratePct,
    taxRateFromCounty: rate.fromCounty,
  }
}

// ---------------------------------------------------------------------------
// One option's figures
// ---------------------------------------------------------------------------

/** The option's down payment in dollars (purchases only). */
export const optionDownPayment = (s: QuoteScenario, o: QuoteOption) => (isPurchase(s) ? (o.downPayment ?? s.downPayment) : null)

/** Base loan before any financed FHA/VA/USDA fee: price − down payment, or the payoff plus cash out. */
export function baseLoanAmount(s: QuoteScenario, o: QuoteOption): number | null {
  if (isPurchase(s)) {
    const down = optionDownPayment(s, o)
    return s.purchasePrice && down != null && down < s.purchasePrice ? round(s.purchasePrice - down) : null
  }
  if (!s.loanBalance) return null
  return round(s.loanBalance + (s.purpose === 'refinance_cash_out' ? (s.cashOut ?? 0) : 0))
}

export interface OptionFigures {
  id: string
  baseLoanAmount: number
  /** With the financed FHA UFMIP / VA funding fee / USDA guarantee fee. */
  loanAmount: number
  financedFee: number
  downPayment: number | null
  downPaymentPct: number | null
  ltvPct: number | null
  principalAndInterest: number
  mortgageInsurance: number
  taxesInsurance: number
  totalMonthly: number
  pointsAmount: number
  /** Closing costs with points, prepaids and escrows (the override when typed). */
  closingCosts: number
  closingCostsEstimated: boolean
  /** The engine's estimate (shown next to an override). */
  closingCostsEngine: number
  /** "Cash to close" or, on a refinance that pays out, "Cash to borrower". */
  cashLabel: 'Cash to close' | 'Cash to borrower'
  cashAmount: number
  /** Cash to close as a signed number: positive = the borrower brings it (for sorting and badges). */
  cashToClose: number
  aprPct: number | null
}

/** The option as the pricing engine's scenario (no loan, no home: a TBD scenario). */
export function draftFor(s: QuoteScenario, o: QuoteOption, housing: HousingEstimate, loan: number): ScenarioDraft {
  return {
    loanId: '',
    propertyId: null,
    name: o.programName ?? 'Quick quote',
    lenderName: o.lenderName,
    programName: o.programName,
    mortgageType: o.mortgageType,
    amortizationType: 'fixed',
    interestOnly: false,
    termMonths: o.termMonths,
    noteRate: o.ratePct,
    qualifyingRate: null,
    buydown: null,
    lockDays: null,
    loanAmount: loan,
    purchasePrice: isPurchase(s) ? s.purchasePrice : null,
    propertyValue: isPurchase(s) ? s.purchasePrice : s.value,
    taxesValue: housing.taxesMonthly,
    taxesFactor: 'monthly',
    insuranceValue: housing.insuranceMonthly,
    insuranceFactor: 'monthly',
    supplementalInsuranceMonthly: null,
    monthlyHoa: null,
    monthlyMi: null,
    otherPaymentMonthly: null,
    otherPaymentLabel: null,
    impoundWaiver: 'none',
    estimatedFundingDate: null,
    firstPaymentDate: null,
    pointsPct: o.pointsPct,
    lenderCredit: 0,
    prepaidInterestDays: ASSUMED_PREPAID_INTEREST_DAYS,
    hoiPrepaidMonths: null,
    taxPrepaidMonths: null,
    hoiReserveMonths: null,
    taxReserveMonths: null,
    miReserveMonths: null,
    aggregateAdjustment: 0,
    notes: null,
  }
}

/** Figures for one option, or null until it has a loan amount and a rate. */
export function optionFigures(s: QuoteScenario, o: QuoteOption, templates: FeeTemplate[]): OptionFigures | null {
  const base = baseLoanAmount(s, o)
  if (!base || o.ratePct == null || !(o.termMonths > 0)) return null
  const housing = housingEstimate(s)
  const priced = priceScenario(draftFor(s, o, housing, base), s.purpose, templates, [])
  const { figures } = priced
  const closingCosts = o.closingCostsOverride ?? priced.closingCosts
  const cash = cashFigure({
    purpose: s.purpose,
    purchasePrice: isPurchase(s) ? s.purchasePrice : null,
    totalLoanAmount: figures.totalLoanAmount,
    financedFee: figures.financedFee,
    closingCosts,
    payoffs: isPurchase(s) ? 0 : (s.loanBalance ?? 0),
    earnestMoney: 0,
    sellerCredits: 0,
  })
  const down = optionDownPayment(s, o)
  const pointsLine = priced.lines.find((l) => l.key === 'points')
  const aprFees = priced.lines.filter((l) => l.apr && l.paidBy === 'B').reduce((sum, l) => sum + l.atClosing + l.beforeClosing, 0)
  return {
    id: o.id,
    baseLoanAmount: base,
    loanAmount: figures.totalLoanAmount,
    financedFee: figures.financedFee,
    downPayment: down,
    downPaymentPct: isPurchase(s) ? downPct(s.purchasePrice, down) : null,
    ltvPct: figures.ltvPct,
    principalAndInterest: figures.payment.principalAndInterest,
    mortgageInsurance: figures.payment.mi,
    taxesInsurance: round(figures.payment.taxes + figures.payment.hoi),
    totalMonthly: figures.pitia,
    pointsAmount: pointsLine?.atClosing ?? 0,
    closingCosts,
    closingCostsEstimated: o.closingCostsOverride == null,
    closingCostsEngine: priced.closingCosts,
    cashLabel: cash.label,
    cashAmount: cash.amount,
    cashToClose: cash.label === 'Cash to close' ? cash.amount : -cash.amount,
    aprPct: estimatedApr({
      loanAmount: figures.totalLoanAmount,
      financedFee: figures.financedFee,
      aprFees: round(aprFees),
      ratePct: o.ratePct,
      termMonths: o.termMonths,
      monthlyMi: figures.payment.mi,
      mortgageType: o.mortgageType,
      ltvPct: figures.ltvPct,
      value: isPurchase(s) ? s.purchasePrice : s.value,
    }),
  }
}

// ---------------------------------------------------------------------------
// Badges and sorting
// ---------------------------------------------------------------------------

/**
 * Badges for the options on the quote: Recommended is Connor's pick;
 * Lowest payment and Least cash to close go to the lowest figure when at
 * least two options have figures and they differ (a tie gives it to each
 * tied option).
 */
export function badgesFor(options: QuoteOption[], figures: Map<string, OptionFigures>): Map<string, QuoteBadge[]> {
  const out = new Map<string, QuoteBadge[]>(options.map((o) => [o.id, o.recommended ? ['recommended'] : []]))
  const priced = options.filter((o) => o.onQuote && figures.has(o.id)).map((o) => figures.get(o.id)!)
  if (priced.length < 2) return out
  const award = (badge: QuoteBadge, value: (f: OptionFigures) => number) => {
    const values = priced.map(value)
    const min = Math.min(...values)
    if (values.every((v) => Math.abs(v - min) < 0.005)) return
    for (const f of priced) if (Math.abs(value(f) - min) < 0.005) out.get(f.id)!.push(badge)
  }
  award('lowest_payment', (f) => f.totalMonthly)
  award('least_cash', (f) => f.cashToClose)
  return out
}

/** Only one option is recommended at a time: marking one clears the others. */
export const recommendOnly = (options: QuoteOption[], id: string, on: boolean): QuoteOption[] => options.map((o) => ({ ...o, recommended: o.id === id ? on : on ? false : o.recommended }))

export type QuoteSortKey = 'payment' | 'cash' | 'rate'

/** Options in sort order; ones without figures (or a rate) keep their place at the end. */
export function sortOptions(options: QuoteOption[], figures: Map<string, OptionFigures>, by: QuoteSortKey): QuoteOption[] {
  const key = (o: QuoteOption) => {
    const f = figures.get(o.id)
    if (by === 'rate') return o.ratePct
    if (!f) return null
    return by === 'payment' ? f.totalMonthly : f.cashToClose
  }
  const indexed = options.map((o, i) => ({ o, i, k: key(o) }))
  return indexed
    .sort((a, b) => (a.k == null ? (b.k == null ? a.i - b.i : 1) : b.k == null ? -1 : a.k - b.k || a.i - b.i))
    .map((x) => x.o)
}

// ---------------------------------------------------------------------------
// Labels and dates
// ---------------------------------------------------------------------------

export const MORTGAGE_TYPE_LABEL: Record<MortgageType, string> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA', other: 'Other' }

/** "30-yr fixed" for whole years, else "n-month". */
export const termLabel = (months: number) => (months % 12 === 0 ? `${months / 12}-yr fixed` : `${months}-month`)

/** "Conventional 30-yr fixed". */
export const optionTitle = (o: Pick<QuoteOption, 'mortgageType' | 'termMonths'>) => `${MORTGAGE_TYPE_LABEL[o.mortgageType]} ${termLabel(o.termMonths)}`

/** "Option A", "Option B"… by position. */
export const optionLetter = (index: number) => String.fromCharCode(65 + index)

/** The default valid-through date: 7 days after the quote is prepared. */
export function validThroughFrom(preparedIso: string, days = DEFAULT_VALID_DAYS): string {
  const d = new Date(`${preparedIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** A note rate between 1% and 15%; anything else is almost surely a typo (63.52 for 6.352). */
export const rateLooksRight = (ratePct: number) => ratePct >= 1 && ratePct <= 15

/** What a quote needs before it can print or send. */
export function quoteProblems(s: QuoteScenario, options: QuoteOption[], figures: Map<string, OptionFigures>): string[] {
  const problems: string[] = []
  if (!s.borrower.name.trim()) problems.push("Add the borrower's name.")
  const onQuote = options.filter((o) => o.onQuote)
  if (onQuote.length === 0) problems.push('Put at least one option on the quote.')
  const unpriced = onQuote.filter((o) => !figures.has(o.id)).length
  if (unpriced) problems.push(unpriced === 1 ? 'One option on the quote is missing its rate or loan amount.' : `${unpriced} options on the quote are missing a rate or loan amount.`)
  onQuote.forEach((o, i) => {
    if (o.ratePct != null && !rateLooksRight(o.ratePct)) problems.push(`Option ${optionLetter(i)}'s rate of ${o.ratePct}% looks like a typo.`)
  })
  return problems
}

/** First and last name from one typed name ("Jordan Reyes" → Jordan, Reyes; a single word is the first name). */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

/** A booking link is saved as https://… (a bare "calendly.com/x" gets https:// added); null when blank, 'invalid' when it isn't a web address. */
export function cleanBookingUrl(text: string): string | null | 'invalid' {
  const t = text.trim()
  if (!t) return null
  const withScheme = /^https?:\/\//i.test(t) ? t.replace(/^http:\/\//i, 'https://') : `https://${t}`
  return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(withScheme) ? withScheme : 'invalid'
}
