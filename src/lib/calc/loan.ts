import { pct, round } from './round'

export interface DownPayment {
  amount: number
  /** Percent of the purchase price, or null with no price. */
  percent: number | null
}

/** Down payment on a purchase: price minus loan amount. */
export function downPayment(purchasePrice: number, loanAmount: number): DownPayment {
  const amount = round(purchasePrice - loanAmount)
  return { amount, percent: pct(amount, purchasePrice) }
}

/**
 * Debt service coverage ratio for an investment property: monthly rent over
 * the full monthly payment (PITIA). 1.00 means rent exactly covers it.
 */
export function dscr(monthlyRent: number, monthlyPitia: number): number | null {
  if (!monthlyPitia || monthlyPitia <= 0 || !Number.isFinite(monthlyRent)) return null
  return round(monthlyRent / monthlyPitia, 2)
}

export interface RefinanceBenefitInput {
  currentPayment: number
  currentRatePct: number
  newPayment: number
  newRatePct: number
  /** Closing costs paid, for the breakeven estimate. */
  closingCosts?: number
}

export interface RefinanceBenefit {
  /** Positive when the new principal and interest payment is lower. */
  monthlySavings: number
  /** Percentage points, positive when the new rate is lower. */
  rateReduction: number
  /** Months to recover closing costs from the savings; null if there are no savings. */
  breakevenMonths: number | null
}

/** Payment savings and rate reduction for a refinance (net tangible benefit). */
export function refinanceBenefit(input: RefinanceBenefitInput): RefinanceBenefit {
  const monthlySavings = round(input.currentPayment - input.newPayment)
  const rateReduction = round(input.currentRatePct - input.newRatePct, 3)
  const breakevenMonths =
    monthlySavings > 0 && input.closingCosts !== undefined
      ? Math.ceil(input.closingCosts / monthlySavings)
      : null
  return { monthlySavings, rateReduction, breakevenMonths }
}

export type LoanPurposeKind =
  | 'purchase'
  | 'refinance_rate_term'
  | 'refinance_cash_out'
  | 'heloc'
  | 'heloan'
  | 'investment_dscr'

export interface ExistingLien {
  position: 'first' | 'second'
  balance: number
  /** Liens marked to be paid off at closing don't count toward CLTV. */
  toBePaidOff?: boolean
}

/**
 * Which lien amounts count toward CLTV for a scenario.
 * - Purchase: just the new loan.
 * - Refinance: the new loan replaces the 1st lien; an existing 2nd stays unless it's being paid off.
 * - HELOC / HELOAN: the existing 1st stays (unless paid off) and the new loan sits behind it.
 * - DSCR: treated as a purchase when there is a purchase price, else a refinance.
 */
export function combinedLienAmounts(
  purpose: LoanPurposeKind,
  loanAmount: number,
  liens: ExistingLien[],
  hasPurchasePrice = false,
): number[] {
  const remaining = liens.filter((l) => !l.toBePaidOff)
  const first = remaining.filter((l) => l.position === 'first').map((l) => l.balance)
  const seconds = remaining.filter((l) => l.position === 'second').map((l) => l.balance)
  switch (purpose) {
    case 'purchase':
      return [loanAmount]
    case 'heloc':
    case 'heloan':
      return [...first, loanAmount]
    case 'investment_dscr':
      return hasPurchasePrice ? [loanAmount] : [loanAmount, ...seconds]
    default:
      return [loanAmount, ...seconds]
  }
}
