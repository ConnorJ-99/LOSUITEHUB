// Estimated APR for a quote option (Connor, 2026-10-30): the actuarial method
// in Regulation Z Appendix J, from the rate, the fees marked "APR" in the fee
// list (points and prepaid interest are) and mortgage insurance for as long as
// it is likely to last. An estimate only: Arive's Loan Estimate is the
// official APR.

import { monthlyPrincipalAndInterest, round } from '@/lib/calc'
import type { MortgageType } from '@/lib/api/types'

export interface AprInput {
  /** Total loan, with any financed FHA/VA/USDA fee. */
  loanAmount: number
  /** The financed fee inside loanAmount (a finance charge, so it isn't financed credit). */
  financedFee: number
  /** Borrower-paid fees marked APR: points, prepaid interest and the fee list's APR fees. */
  aprFees: number
  ratePct: number
  termMonths: number
  monthlyMi: number
  mortgageType: MortgageType
  ltvPct: number | null
  /** Price (purchase) or value (refinance), for when conventional MI drops off. */
  value: number | null
}

/** Conventional MI drops off at 78% of the original value (scheduled balance); the month it gets there, or the full term. */
function monthsTo78(loan: number, ratePct: number, termMonths: number, value: number | null): number {
  if (!value) return termMonths
  const r = ratePct / 100 / 12
  const payment = monthlyPrincipalAndInterest(loan, ratePct, termMonths)
  let balance = loan
  for (let k = 1; k <= termMonths; k++) {
    balance = balance * (1 + r) - payment
    if (balance <= value * 0.78) return k
  }
  return termMonths
}

/**
 * Months of mortgage insurance in the payment stream: conventional to 78% LTV;
 * FHA for the life of the loan over 90% LTV, else 11 years; USDA for the life
 * of the loan; VA none.
 */
export function miMonths(i: Pick<AprInput, 'loanAmount' | 'ratePct' | 'termMonths' | 'monthlyMi' | 'mortgageType' | 'ltvPct' | 'value'>): number {
  if (i.monthlyMi <= 0) return 0
  if (i.mortgageType === 'fha') return (i.ltvPct ?? 100) > 90 ? i.termMonths : Math.min(132, i.termMonths)
  if (i.mortgageType === 'usda_rural') return i.termMonths
  if (i.mortgageType === 'va') return 0
  return monthsTo78(i.loanAmount, i.ratePct, i.termMonths, i.value)
}

/** The estimated APR as a percent (3 decimals), or null when it can't be figured. */
export function estimatedApr(i: AprInput): number | null {
  if (!(i.loanAmount > 0) || !(i.termMonths > 0) || !(i.ratePct >= 0)) return null
  const amountFinanced = i.loanAmount - i.financedFee - i.aprFees
  if (!(amountFinanced > 0)) return null
  const pi = monthlyPrincipalAndInterest(i.loanAmount, i.ratePct, i.termMonths)
  const mi = miMonths(i)
  const presentValue = (monthly: number) => {
    // Level P&I as an annuity, plus MI for the months it's paid.
    if (monthly === 0) return pi * i.termMonths + i.monthlyMi * mi
    const annuity = (n: number) => (1 - (1 + monthly) ** -n) / monthly
    return pi * annuity(i.termMonths) + i.monthlyMi * annuity(mi)
  }
  if (presentValue(0) <= amountFinanced) return round(i.ratePct, 3)
  let low = 0
  let high = 1
  for (let n = 0; n < 200; n++) {
    const mid = (low + high) / 2
    if (presentValue(mid) > amountFinanced) low = mid
    else high = mid
  }
  return round(((low + high) / 2) * 12 * 100, 3)
}
