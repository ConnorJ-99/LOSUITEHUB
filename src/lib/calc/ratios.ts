import { pct } from './round'

/** Loan-to-value: this loan only, over appraised value (or price if lower). */
export function ltv(loanAmount: number, propertyValue: number): number | null {
  return pct(loanAmount, propertyValue)
}

/**
 * Combined loan-to-value: every lien on the property over its value.
 * For a HELOC/HELOAN pass the 1st lien balance plus the new 2nd lien amount.
 */
export function cltv(lienAmounts: number[], propertyValue: number): number | null {
  const total = lienAmounts.reduce((sum, amount) => sum + amount, 0)
  return pct(total, propertyValue)
}

/**
 * Value used for LTV on a purchase: the lower of price and appraised value.
 * Refinances have no price, so the appraised value is used.
 */
export function qualifyingValue(appraisedValue: number, purchasePrice?: number): number {
  if (purchasePrice && purchasePrice > 0 && appraisedValue > 0) {
    return Math.min(purchasePrice, appraisedValue)
  }
  return purchasePrice && purchasePrice > 0 ? purchasePrice : appraisedValue
}

export interface DtiResult {
  /** Housing payment over income (front-end ratio). */
  front: number | null
  /** Housing payment plus all other monthly debts over income (back-end ratio). */
  back: number | null
}

/** Debt-to-income ratios from monthly figures. */
export function dti(
  monthlyHousingPayment: number,
  otherMonthlyDebts: number,
  grossMonthlyIncome: number,
): DtiResult {
  return {
    front: pct(monthlyHousingPayment, grossMonthlyIncome),
    back: pct(monthlyHousingPayment + otherMonthlyDebts, grossMonthlyIncome),
  }
}
