// Closing costs for the Prequal tab: the Selected estimate's, else a Smart
// Fees estimate from the prequal's numbers, else the 3% default. Pure.

import { round, type FeeTemplate } from '@/lib/calc'
import type { LoanDetails, LoanProfile } from '@/lib/api/types'
import { priceScenario, scenarioFrom } from '@/lib/pricing/scenario'

export type ClosingCostSource = 'selected' | 'smart_fees' | 'default'

/**
 * The Selected estimate's closing costs as written to the loan (fees,
 * prepaids and points, less the lender credit). A figure already on a loan
 * with no estimate (typed or imported) counts as it is. Null when neither.
 */
export function selectedClosingCosts(d: Pick<LoanDetails, 'pricingScenarioId' | 'estimatedClosingCosts' | 'prepaidItemsAmount' | 'discountPointsAmount' | 'lenderCredits'>): number | null {
  if (d.estimatedClosingCosts == null) return null
  if (!d.pricingScenarioId) return d.estimatedClosingCosts
  return round(d.estimatedClosingCosts + (d.prepaidItemsAmount ?? 0) + (d.discountPointsAmount ?? 0) - (d.lenderCredits ?? 0))
}

/**
 * Smart Fees on the prequal's numbers, for before any estimate exists: the
 * company fee list, prepaids and escrows on this price and loan amount at the
 * loan's rate and loan type. Null with no fee list (the 3% default is used).
 */
export function prequalFeeEstimate(loan: Pick<LoanProfile, 'id' | 'purpose' | 'details'>, templates: FeeTemplate[]) {
  if (!templates.length) return undefined
  return (price: number, loanAmount: number, overrides: Partial<LoanDetails> = {}): number => {
    const details = { ...loan.details, ...overrides, purchasePrice: price, loanAmount }
    const s = scenarioFrom({ id: loan.id, purpose: loan.purpose, details }, null, 'Prequal')
    return priceScenario(s, loan.purpose, templates, []).closingCosts
  }
}
