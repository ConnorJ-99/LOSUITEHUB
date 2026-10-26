import type { MortgageTypeKind } from './mortgageInsurance'
import { pct, round } from './round'
import { qualifyingValue } from './ratios'

export type ConcessionOccupancy = 'primary' | 'second_home' | 'investment'

export interface ConcessionLimit {
  /** Most the seller can pay toward the buyer's costs, as a percent. */
  maxPct: number
  /** Percent of what: the price for FHA; otherwise the lower of price and value (VA uses the appraised value). */
  basis: number
  maxAmount: number
  /** VA's 4% doesn't count normal closing costs, so an amount over it may still be fine. */
  approximate: boolean
}

/**
 * Seller concession (interested-party contribution) limits by loan type:
 * conventional 3% over 90% LTV, 6% at 75.01-90%, 9% at 75% or less, 2% for
 * investment homes; FHA 6%; VA 4% (excluding normal closing costs); USDA 6%.
 * Returns null without a price.
 */
export function concessionLimit(type: MortgageTypeKind | null, occupancy: ConcessionOccupancy, price: number | null, appraisedValue: number | null, loanAmount: number | null): ConcessionLimit | null {
  if (!price || price <= 0) return null
  const basis = appraisedValue && appraisedValue > 0 ? qualifyingValue(appraisedValue, price) : price
  const kind = type ?? 'conventional'
  let maxPct: number
  if (kind === 'fha' || kind === 'usda_rural') maxPct = 6
  else if (kind === 'va') maxPct = 4
  else if (occupancy === 'investment') maxPct = 2
  else {
    const ltv = loanAmount ? pct(loanAmount, basis) : null
    maxPct = ltv === null || ltv > 90 ? 3 : ltv > 75 ? 6 : 9
  }
  const on = kind === 'fha' ? price : basis
  return { maxPct, basis: on, maxAmount: round((on * maxPct) / 100), approximate: kind === 'va' }
}
