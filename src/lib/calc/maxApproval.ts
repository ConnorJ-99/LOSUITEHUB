import { cashToClose } from './cashToClose'
import { concessionLimit, type ConcessionOccupancy } from './concessions'
import type { MortgageInsurance, MortgageTypeKind } from './mortgageInsurance'
import type { PitiResult } from './payment'
import { DEFAULT_CLOSING_COST_PCT, DEFAULT_DOWN_PCT, DEFAULT_MAX_DTI, purchasePayment } from './prequal'
import { dti, type DtiResult } from './ratios'
import { round } from './round'

// Max Approval (the Prequal tab's calculator): the highest purchase price
// where every limit passes at once: DTI, an optional payment cap, cash to
// close (with reserves) and the county loan limit. No specific house is
// needed. These are estimates for a conversation, not an approval.

export type ApprovalLoanType = 'conventional' | 'fha' | 'va' | 'non_qm'

export const APPROVAL_LOAN_TYPES: { value: ApprovalLoanType; label: string }[] = [
  { value: 'conventional', label: 'Conventional' },
  { value: 'fha', label: 'FHA' },
  { value: 'va', label: 'VA' },
  { value: 'non_qm', label: 'Non-QM' },
]

/** The loan's mortgage type for a calculator loan type (Non-QM is saved as "other"). */
export const mortgageTypeFor = (t: ApprovalLoanType): MortgageTypeKind => (t === 'non_qm' ? 'other' : t)

/** The calculator loan type for a saved mortgage type (blank and USDA start as conventional). */
export function approvalTypeFor(t: MortgageTypeKind | null): ApprovalLoanType {
  if (t === 'fha' || t === 'va') return t
  if (t === 'other') return 'non_qm'
  return 'conventional'
}

/** Default max back-end DTI: the prequal defaults, and 50% for Non-QM. */
export const approvalMaxDti = (t: ApprovalLoanType) => (t === 'non_qm' ? 50 : DEFAULT_MAX_DTI[t])

/** Usual minimum down payment: the prequal defaults; conventional investment homes need 15%. */
export function approvalDownPct(t: ApprovalLoanType, occupancy: ConcessionOccupancy): number {
  if (t === 'conventional' && occupancy === 'investment') return 15
  return DEFAULT_DOWN_PCT[mortgageTypeFor(t)]
}

/** Default reserves in months of the new payment, by occupancy. */
export const approvalReserveMonths = (occupancy: ConcessionOccupancy) => (occupancy === 'investment' ? 6 : occupancy === 'second_home' ? 2 : 0)

/** Default homeowner's insurance, as a percent of the price per year. */
export const DEFAULT_INSURANCE_PCT = 1

/** Gift funds: not on investment homes; Non-QM depends on the lender (a switch). */
export function giftAllowed(t: ApprovalLoanType, occupancy: ConcessionOccupancy, nonQmAllowsGift: boolean): boolean {
  if (t === 'non_qm') return nonQmAllowsGift
  return occupancy !== 'investment'
}

/** Own funds and gifts from the 1003's assets (gift of equity isn't cash, so it's left out). */
export function approvalFunds(assets: { assetType: string; amount: number | null; useAs: string }[]): { own: number; gift: number } {
  const isCashGift = (t: string) => t === 'gift_cash' || t === 'grant'
  const sum = (rows: typeof assets) => round(rows.reduce((s, a) => s + (a.amount ?? 0), 0))
  return {
    own: sum(assets.filter((a) => !isCashGift(a.assetType) && a.assetType !== 'gift_equity' && a.useAs !== 'depletion')),
    gift: sum(assets.filter((a) => isCashGift(a.assetType))),
  }
}

export interface ApprovalConcessions {
  /** What was entered, in dollars at this price. */
  entered: number
  /** The loan type's cap, as a percent of the price (VA: 4%, plus normal closing costs on top). */
  maxAllowedPct: number
  maxAllowed: number
  /** Concessions can only pay costs: closing costs and prepaids. */
  maxUsable: number
  /** What counts toward cash to close: the lowest of the three. */
  applied: number
  overAllowed: boolean
  overUsable: boolean
}

/**
 * Seller concession limits at one price: FHA 6%; conventional 3% over 90%
 * LTV, 6% at 75.01–90%, 9% at 75% or less, 2% on investment homes (from
 * `concessionLimit`); VA 4% plus normal closing costs; Non-QM as entered.
 * Usable is capped at the closing costs and prepaids.
 */
export function approvalConcessions(input: {
  loanType: ApprovalLoanType
  occupancy: ConcessionOccupancy
  price: number
  loanAmount: number
  costs: number
  enteredPct: number
  nonQmCapPct: number
}): ApprovalConcessions {
  const { loanType, price, costs } = input
  let maxAllowedPct: number
  let maxAllowed: number
  if (loanType === 'non_qm') {
    maxAllowedPct = input.nonQmCapPct
    maxAllowed = round((price * maxAllowedPct) / 100)
  } else {
    const limit = concessionLimit(loanType, input.occupancy, price, null, input.loanAmount)!
    maxAllowedPct = limit.maxPct
    // VA's 4% doesn't count normal closing costs, so the seller can pay those too.
    maxAllowed = loanType === 'va' ? round(limit.maxAmount + costs) : limit.maxAmount
  }
  const entered = round((price * Math.max(input.enteredPct, 0)) / 100)
  const maxUsable = round(Math.max(costs, 0))
  return {
    entered,
    maxAllowedPct,
    maxAllowed,
    maxUsable,
    applied: round(Math.min(entered, maxAllowed, maxUsable)),
    overAllowed: entered > maxAllowed + 0.5,
    overUsable: entered > maxUsable + 0.5,
  }
}

export interface MaxApprovalInput {
  loanType: ApprovalLoanType
  occupancy: ConcessionOccupancy
  monthlyIncome: number
  /** Monthly debts that stay after closing. */
  monthlyDebts: number
  /** The borrower's own verified funds (not gifts). */
  assets: number
  giftAmount: number
  /** Non-QM only: whether the lender takes gift funds. */
  nonQmAllowsGift: boolean
  noteRatePct: number | null
  termMonths: number | null
  downPaymentPct: number
  maxDtiPct: number
  /** Optional cap on the full monthly payment. */
  maxMonthlyPayment: number | null
  /** Yearly property tax, percent of the price. */
  taxRatePct: number
  /** Yearly homeowner's insurance, percent of the price. */
  insuranceRatePct: number
  monthlyHoa: number
  /** Yearly MI rate: conventional and Non-QM as entered (null = the usual default); FHA always by rule. */
  miRatePct: number | null
  /** VA funding fee override (0 = exempt); null = by rule. */
  upfrontFeePct: number | null
  /** Seller concessions asked for, percent of the price. */
  sellerConcessionPct: number
  /** Non-QM's concession cap (the lender's), percent of the price. */
  nonQmConcessionCapPct: number
  reserveMonths: number
  /** Debts paid off at closing (their balances come out of the funds). */
  payoffs?: number
  /** The county loan limit for this loan type; null = no limit checked. */
  loanLimit: number | null
  /** Closing costs and prepaids at a price, when a fee list can work them out. */
  costsAt?: (price: number, loanAmount: number) => number
  /** Otherwise closing costs and prepaids as a percent of the price. */
  closingCostPct?: number
}

export type ApprovalLimit = 'dti' | 'payment' | 'cash' | 'loan_limit'

export const APPROVAL_LIMIT_LABELS: Record<ApprovalLimit, string> = {
  dti: 'DTI',
  payment: 'Max payment',
  cash: 'Cash to close',
  loan_limit: 'Loan limit',
}

export interface ApprovalAt {
  price: number
  /** Base loan amount (before a financed UFMIP or funding fee). */
  loanAmount: number
  downPayment: number
  ltv: number | null
  mi: MortgageInsurance
  payment: PitiResult
  dti: DtiResult
  /** Closing costs and prepaids. */
  costs: number
  concessions: ApprovalConcessions
  /** Gift entered, and what counts (0 when the loan type doesn't allow it). */
  gift: { entered: number; counted: number; allowed: boolean }
  /** Own funds plus counted gifts. */
  funds: number
  /** Debts paid off at closing. */
  payoffs: number
  /** Down payment + costs + payoffs − concessions. */
  cashToClose: number
  reservesRequired: number
  /** Cash to close plus reserves. */
  cashNeeded: number
  /** Funds left after closing and reserves (negative = short). */
  cashLeft: number
  /** Which limits pass at this price. */
  passes: Record<ApprovalLimit, boolean>
}

/** Every figure at one price. */
export function approvalAt(price: number, input: MaxApprovalInput): ApprovalAt {
  const type = mortgageTypeFor(input.loanType)
  const p = purchasePayment(price, {
    downPayment: { kind: 'percent', pct: input.downPaymentPct },
    noteRatePct: input.noteRatePct ?? 0,
    termMonths: input.termMonths ?? 360,
    taxRatePct: input.taxRatePct,
    annualInsurance: round((price * input.insuranceRatePct) / 100),
    monthlyHoa: input.monthlyHoa,
    mortgageType: type,
    // FHA's MIP always follows HUD's schedule.
    miRatePct: input.loanType === 'fha' ? null : input.miRatePct,
    upfrontFeePct: input.loanType === 'va' ? input.upfrontFeePct : null,
  })
  const costs = round(input.costsAt ? input.costsAt(price, p.loanAmount) : (price * (input.closingCostPct ?? DEFAULT_CLOSING_COST_PCT)) / 100)
  const concessions = approvalConcessions({ loanType: input.loanType, occupancy: input.occupancy, price, loanAmount: p.loanAmount, costs, enteredPct: input.sellerConcessionPct, nonQmCapPct: input.nonQmConcessionCapPct })
  const allowed = giftAllowed(input.loanType, input.occupancy, input.nonQmAllowsGift)
  const gift = { entered: round(Math.max(input.giftAmount, 0)), counted: allowed ? round(Math.max(input.giftAmount, 0)) : 0, allowed }
  const funds = round(Math.max(input.assets, 0) + gift.counted)
  const cash = cashToClose({ isPurchase: true, purchasePrice: price, baseLoanAmount: p.loanAmount, closingCosts: costs, sellerCredits: concessions.applied, debtsPaidAtClosing: input.payoffs ?? 0 })
  const reservesRequired = round(Math.max(input.reserveMonths, 0) * p.payment.total)
  const cashNeeded = round(cash.cashToClose + reservesRequired)
  const ratios = dti(p.payment.total, input.monthlyDebts, input.monthlyIncome)
  return {
    price,
    loanAmount: p.loanAmount,
    downPayment: p.downPayment,
    ltv: p.ltv,
    mi: p.mi,
    payment: p.payment,
    dti: ratios,
    costs,
    concessions,
    gift,
    funds,
    payoffs: cash.debtsPaidAtClosing,
    cashToClose: cash.cashToClose,
    reservesRequired,
    cashNeeded,
    cashLeft: round(funds - cashNeeded),
    passes: {
      dti: ratios.back !== null && ratios.back <= input.maxDtiPct,
      payment: input.maxMonthlyPayment == null || p.payment.total <= input.maxMonthlyPayment,
      cash: funds >= cashNeeded,
      loan_limit: input.loanLimit == null || p.loanAmount <= input.loanLimit,
    },
  }
}

export interface MaxApprovalResult {
  /** The figures at the max price, or null when no price passes. */
  max: ApprovalAt | null
  /** The limit that set the max (or stops any price); null when the search hit its ceiling. */
  limitedBy: ApprovalLimit | null
  /** Why there's no answer yet, in words (missing income, rate…); null when there is one. */
  missing: string | null
}

const STEP = 1_000
const FLOOR = 10_000
const CEILING = 20_000_000
const ORDER: ApprovalLimit[] = ['dti', 'payment', 'cash', 'loan_limit']

const allPass = (a: ApprovalAt) => ORDER.every((k) => a.passes[k])
const firstFailing = (a: ApprovalAt) => ORDER.find((k) => !a.passes[k]) ?? null

/**
 * The highest purchase price (to the $1,000 below) where every limit passes,
 * and which limit set it. Each limit only gets harder as the price goes up,
 * so a binary search finds the edge.
 */
export function maxApproval(input: MaxApprovalInput): MaxApprovalResult {
  if (!(input.monthlyIncome > 0)) return { max: null, limitedBy: null, missing: 'Enter monthly income to see the max approval.' }
  if (input.noteRatePct == null) return { max: null, limitedBy: null, missing: 'Enter an interest rate to see the max approval.' }
  if (!input.termMonths) return { max: null, limitedBy: null, missing: 'Pick a term to see the max approval.' }
  const fits = (price: number) => allPass(approvalAt(price, input))
  const atFloor = approvalAt(FLOOR, input)
  if (!allPass(atFloor)) return { max: null, limitedBy: firstFailing(atFloor), missing: null }
  if (fits(CEILING)) return { max: approvalAt(CEILING, input), limitedBy: null, missing: null }
  let low = FLOOR
  let high = CEILING
  while (high - low > 1) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  let price = Math.max(Math.floor(low / STEP) * STEP, FLOOR)
  // The search stops just under an exact edge; a whole-thousand price right on it still passes.
  while (price + STEP < CEILING && fits(price + STEP)) price += STEP
  return { max: approvalAt(price, input), limitedBy: firstFailing(approvalAt(price + STEP, input)), missing: null }
}
