// Government loan fees, in one place. Each figure names its source and the
// date it was checked; look the figures up again before changing them.
// Verified on 2026-11-03.

/**
 * FHA upfront MIP: 1.75% of the base loan, financed into the loan.
 * Annual MIP for most 30-year loans: 0.55% above 95% LTV, 0.50% at 95% or less.
 * Source: HUD Mortgagee Letter 2023-05 (annual MIP cut, March 2023) and
 * ML 2015-01 (upfront 1.75%); no 2026 letter changed them (checked 2026-11-03).
 */
export const FHA = { upfrontPct: 1.75, annualPctOver95: 0.55, annualPctAtOrUnder95: 0.5 } as const

/**
 * VA funding fee, percent of the loan. Purchase by down payment; cash-out
 * refinance by use; IRRRL flat. Exempt veterans (service-connected
 * disability, surviving spouses…) pay 0.
 * Source: VA funding fee chart (Blue Water Navy Vietnam Veterans Act rates,
 * effective April 7, 2023 through June 9, 2034), as published for 2026
 * (checked 2026-11-03).
 */
export const VA_FUNDING_FEE = {
  purchase: [
    { minDownPct: 10, firstUse: 1.25, subsequentUse: 1.25 },
    { minDownPct: 5, firstUse: 1.5, subsequentUse: 1.5 },
    { minDownPct: 0, firstUse: 2.15, subsequentUse: 3.3 },
  ],
  cashOut: { firstUse: 2.15, subsequentUse: 3.3 },
  irrrl: 0.5,
} as const

/**
 * USDA guarantee fees: 1.00% upfront (financed) and 0.35% a year of the
 * unpaid balance, purchase and refinance.
 * Source: USDA Rural Development lender notice for FY 2026 (Oct 1, 2025 –
 * Sep 30, 2026). The fee year is set by the Conditional Commitment date;
 * no FY 2027 notice was found on 2026-11-03, so these stand until one is.
 */
export const USDA = { upfrontPct: 1, annualPct: 0.35 } as const

export interface VaFeeInput {
  /** Percent down (purchase). */
  downPct: number
  kind: 'purchase' | 'cash_out' | 'irrrl'
  subsequentUse?: boolean
  exempt?: boolean
}

/** The VA funding fee percent for a loan. */
export function vaFundingFeePct(v: VaFeeInput): number {
  if (v.exempt) return 0
  if (v.kind === 'irrrl') return VA_FUNDING_FEE.irrrl
  if (v.kind === 'cash_out') return v.subsequentUse ? VA_FUNDING_FEE.cashOut.subsequentUse : VA_FUNDING_FEE.cashOut.firstUse
  const tier = VA_FUNDING_FEE.purchase.find((t) => v.downPct >= t.minDownPct)!
  return v.subsequentUse ? tier.subsequentUse : tier.firstUse
}
