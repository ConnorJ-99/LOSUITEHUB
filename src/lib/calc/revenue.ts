// Revenue on a loan: typed as a percent of the loan amount or as dollars;
// the other figure is worked out here. Pure.

import { pct, round } from './round'

export type RevenueType = 'percent' | 'amount'

/** Both ways of reading the revenue. Whichever wasn't typed needs a loan amount; without one it's null. */
export function loanRevenue(loanAmount: number | null, type: RevenueType | null, value: number | null): { pct: number | null; amount: number | null } {
  if (type === null || value === null) return { pct: null, amount: null }
  const hasLoan = loanAmount !== null && loanAmount > 0
  if (type === 'percent') return { pct: value, amount: hasLoan ? round((loanAmount * value) / 100) : null }
  return { pct: hasLoan ? pct(value, loanAmount) : null, amount: value }
}
