import { round } from './round'

// How savings and real estate feed qualifying: down payment funds,
// asset-depletion income, reserves and sale proceeds.

export type AssetUse = 'down_payment' | 'depletion' | 'reserves'

export interface UsableAsset {
  assetType: string
  amount: number | null
  useAs: AssetUse
}

/** Months an asset is spread over for depletion income. */
export const DEPLETION_MONTHS = 360

/** Share of an account counted for depletion: retirement accounts at 70%, everything else in full. */
export const depletionEligiblePct = (assetType: string) => (assetType === 'retirement' ? 70 : 100)

/** Monthly asset-depletion income from accounts marked "depletion". */
export function assetDepletionIncome(assets: UsableAsset[]): number {
  return round(
    assets.filter((a) => a.useAs === 'depletion').reduce((s, a) => s + ((a.amount ?? 0) * depletionEligiblePct(a.assetType)) / 100, 0) / DEPLETION_MONTHS,
  )
}

export interface FundsByUse {
  downPayment: number
  reserves: number
  depletion: number
}

/** Savings totals by how each account is used. */
export function fundsByUse(assets: UsableAsset[]): FundsByUse {
  const sum = (use: AssetUse) => round(assets.filter((a) => a.useAs === use).reduce((s, a) => s + (a.amount ?? 0), 0))
  return { downPayment: sum('down_payment'), reserves: sum('reserves'), depletion: sum('depletion') }
}

/** Default selling costs (commissions, title, concessions) as a percent of the sale price. */
export const DEFAULT_SELLING_COST_PCT = 8

/** Net proceeds from selling a home: value, less selling costs and the mortgages paid off. Can be negative. */
export function saleProceeds(value: number | null, lienBalances: number[], sellingCostPct = DEFAULT_SELLING_COST_PCT): number {
  const v = value ?? 0
  return round(v - (v * sellingCostPct) / 100 - lienBalances.reduce((s, b) => s + b, 0))
}

export interface Reserves {
  /** Money left after closing, plus reserve-only accounts. */
  amount: number
  /** Months of the new housing payment that covers. */
  months: number | null
}

/** Reserves after closing: closing funds left over plus reserve-only accounts, in months of payment. */
export function reservesAfterClosing(closingFunds: number, cashNeeded: number, reserveAccounts: number, monthlyPayment: number | null): Reserves {
  const amount = round(Math.max(closingFunds - cashNeeded, 0) + reserveAccounts)
  return { amount, months: monthlyPayment && monthlyPayment > 0 ? round(amount / monthlyPayment, 1) : null }
}
