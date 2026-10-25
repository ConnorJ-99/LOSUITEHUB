import { mortgageInsurance, type MortgageInsurance, type MortgageTypeKind } from './mortgageInsurance'
import { piti, type PitiResult } from './payment'
import { pct, round } from './round'

// Phone prequal math: what the borrower can afford, and quick guideline
// checks. These are estimates for a conversation, not an approval; Product
// Search and the AUS decide eligibility.

/** Default maximum back-end DTI for the max-price figure, by loan type (Connor's choice). */
export const DEFAULT_MAX_DTI: Record<MortgageTypeKind, number> = {
  conventional: 45,
  fha: 50,
  va: 50,
  usda_rural: 41,
  other: 45,
}

export const maxDtiFor = (type: MortgageTypeKind | null) => DEFAULT_MAX_DTI[type ?? 'conventional']

/** Usual minimum down payment by loan type, as a percent of the price. */
export const DEFAULT_DOWN_PCT: Record<MortgageTypeKind, number> = {
  conventional: 5,
  fha: 3.5,
  va: 0,
  usda_rural: 0,
  other: 10,
}

/** Closing costs and prepaids as a percent of the price, when nothing better is entered. */
export const DEFAULT_CLOSING_COST_PCT = 3

export type DownPaymentChoice = { kind: 'percent'; pct: number } | { kind: 'amount'; amount: number }

export interface PurchaseTerms {
  downPayment: DownPaymentChoice
  noteRatePct: number
  termMonths: number
  /** Yearly property tax as a percent of the price. */
  taxRatePct: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  mortgageType: MortgageTypeKind | null
  miRatePct?: number | null
  upfrontFeePct?: number | null
}

export interface PurchasePayment {
  price: number
  /** Base loan amount (before any financed fee). */
  loanAmount: number
  downPayment: number
  ltv: number | null
  mi: MortgageInsurance
  payment: PitiResult
}

/** The base loan for a price and down payment choice. */
export function loanForPrice(price: number, down: DownPaymentChoice): number {
  const downAmount = down.kind === 'percent' ? (price * down.pct) / 100 : down.amount
  return round(Math.max(price - downAmount, 0))
}

/** Full monthly payment (PITI + HOA + MI) on a purchase at a given price. */
export function purchasePayment(price: number, terms: PurchaseTerms): PurchasePayment {
  const loanAmount = loanForPrice(price, terms.downPayment)
  const ltv = pct(loanAmount, price)
  const mi = mortgageInsurance({ mortgageType: terms.mortgageType, baseLoanAmount: loanAmount, ltvPct: ltv, annualRatePct: terms.miRatePct, upfrontFeePct: terms.upfrontFeePct })
  const payment = piti({
    principal: mi.totalLoanAmount,
    annualRatePct: terms.noteRatePct,
    termMonths: terms.termMonths,
    annualTaxes: terms.taxRatePct ? (price * terms.taxRatePct) / 100 : 0,
    annualInsurance: terms.annualInsurance ?? 0,
    monthlyHoa: terms.monthlyHoa ?? 0,
    monthlyMortgageInsurance: mi.monthly,
  })
  return { price, loanAmount, downPayment: round(price - loanAmount), ltv, mi, payment }
}

export interface MaxPurchaseInput extends PurchaseTerms {
  monthlyIncome: number
  /** Monthly debts that stay after closing, including rental losses. */
  otherMonthlyDebts: number
  maxDtiPct: number
}

export interface MaxPurchaseResult extends PurchasePayment {
  /** Most the housing payment can be: income × max DTI − other debts. */
  housingBudget: number
}

const PRICE_CEILING = 20_000_000

/**
 * Highest purchase price (to the nearest $1,000 below) whose full payment
 * keeps back-end DTI at or under the maximum. Null when there's no room for
 * a payment, or the rate or term is missing.
 */
export function maxPurchasePrice(input: MaxPurchaseInput): MaxPurchaseResult | null {
  if (!input.monthlyIncome || input.monthlyIncome <= 0 || !input.termMonths || input.noteRatePct == null) return null
  const housingBudget = round((input.monthlyIncome * input.maxDtiPct) / 100 - input.otherMonthlyDebts)
  if (housingBudget <= 0) return null
  const fits = (price: number) => purchasePayment(price, input).payment.total <= housingBudget
  if (!fits(1_000)) return null
  // The payment only goes up as the price goes up, so a binary search finds the limit.
  let low = 1_000
  let high = PRICE_CEILING
  if (fits(high)) low = high
  while (high - low > 1) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  const maxPrice = Math.floor(low / 1_000) * 1_000
  return { ...purchasePayment(maxPrice, input), housingBudget }
}

export interface CashToCloseEstimate {
  downPayment: number
  closingCosts: number
  /** True when closing costs are the default percent, not an entered figure. */
  closingCostsEstimated: boolean
  total: number
}

/** Cash needed at closing for a purchase: down payment plus closing costs (entered, or 3% of price). */
export function estimatedCashToClose(price: number, loanAmount: number, closingCosts: number | null): CashToCloseEstimate {
  const closingCostsEstimated = closingCosts === null
  const costs = closingCostsEstimated ? round((price * DEFAULT_CLOSING_COST_PCT) / 100) : closingCosts
  const downPayment = round(price - loanAmount)
  return { downPayment, closingCosts: costs, closingCostsEstimated, total: round(downPayment + costs) }
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export interface PrequalCheck {
  label: string
  status: CheckStatus
  detail: string
}

export interface PrequalCheckInput {
  mortgageType: MortgageTypeKind | null
  /** Lowest estimated score among the borrowers. */
  creditScore: number | null
  ltvPct: number | null
  backDtiPct: number | null
  maxDtiPct: number
  cashNeeded: number | null
  funds: number | null
  /** Purchase loans only: checks down payment and cash. */
  isPurchase: boolean
}

/** Typical minimum credit score by loan type (lenders can be stricter). */
export const MIN_CREDIT_SCORE: Record<MortgageTypeKind, number | null> = {
  conventional: 620,
  fha: 580,
  va: 580,
  usda_rural: 640,
  other: null,
}

/** Typical maximum LTV on a purchase by loan type. */
export const MAX_PURCHASE_LTV: Record<MortgageTypeKind, number | null> = {
  conventional: 97,
  fha: 96.5,
  va: 100,
  usda_rural: 100,
  other: null,
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** Quick guideline checks for the call: credit, down payment, DTI and cash. */
export function prequalChecks(input: PrequalCheckInput): PrequalCheck[] {
  const type = input.mortgageType ?? 'conventional'
  const checks: PrequalCheck[] = []

  const minScore = MIN_CREDIT_SCORE[type]
  if (input.creditScore === null) checks.push({ label: 'Credit score', status: 'unknown', detail: 'Ask for an estimated score.' })
  else if (minScore === null) checks.push({ label: 'Credit score', status: 'pass', detail: `${input.creditScore}; check the program's minimum.` })
  else if (type === 'fha' && input.creditScore >= 500 && input.creditScore < 580)
    checks.push({ label: 'Credit score', status: 'warn', detail: `${input.creditScore}: FHA allows 500–579 only with 10% down.` })
  else
    checks.push({
      label: 'Credit score',
      status: input.creditScore >= minScore ? 'pass' : 'fail',
      detail: input.creditScore >= minScore ? `${input.creditScore} meets the usual ${minScore} minimum.` : `${input.creditScore} is under the usual ${minScore} minimum.`,
    })

  if (input.isPurchase) {
    const fhaLowScore = type === 'fha' && input.creditScore !== null && input.creditScore < 580
    const maxLtv = fhaLowScore ? 90 : MAX_PURCHASE_LTV[type]
    if (input.ltvPct === null || maxLtv === null) checks.push({ label: 'Down payment', status: 'unknown', detail: 'Enter a price and down payment.' })
    else if (input.ltvPct > maxLtv) checks.push({ label: 'Down payment', status: 'fail', detail: `LTV ${input.ltvPct}% is over the ${maxLtv}% maximum.` })
    else if (type === 'conventional' && input.ltvPct > 95)
      checks.push({ label: 'Down payment', status: 'warn', detail: `LTV ${input.ltvPct}%: over 95% needs a first-time buyer or HomeReady / Home Possible.` })
    else checks.push({ label: 'Down payment', status: 'pass', detail: `LTV ${input.ltvPct}% is within the ${maxLtv}% maximum.` })
  }

  if (input.backDtiPct === null) checks.push({ label: 'DTI', status: 'unknown', detail: 'Enter income and a price or loan amount.' })
  else
    checks.push({
      label: 'DTI',
      status: input.backDtiPct <= input.maxDtiPct ? 'pass' : 'fail',
      detail: `${round(input.backDtiPct, 1)}% against a ${input.maxDtiPct}% maximum.`,
    })

  if (input.isPurchase) {
    if (input.cashNeeded === null) checks.push({ label: 'Cash to close', status: 'unknown', detail: 'Enter a price.' })
    else if (input.funds === null) checks.push({ label: 'Cash to close', status: 'unknown', detail: `About ${money(input.cashNeeded)} needed; ask what they have saved.` })
    else if (input.funds >= input.cashNeeded) checks.push({ label: 'Cash to close', status: 'pass', detail: `${money(input.funds)} covers about ${money(input.cashNeeded)} needed.` })
    else checks.push({ label: 'Cash to close', status: 'fail', detail: `Short about ${money(input.cashNeeded - input.funds)} (needs ${money(input.cashNeeded)}).` })
  }
  return checks
}
