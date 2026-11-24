// The MyHome tab's three asset columns (nurture goals Phase 2, Connor's spec
// 2026-11-24): what the borrower reports in MyHome, what the 1003 has
// (verified by the file), and what counts for qualifying (the same split Max
// Approval uses: own funds, and cash gifts / grants on their own; gift of
// equity and depletion-only assets are left out). Reported numbers never count
// as verified. Pure.
import { approvalFunds } from './maxApproval'
import { round } from './round'

export interface AssetColumns {
  /** The borrower's own accounts in MyHome. */
  reported: number
  /** Every asset on the 1003. */
  verified: number
  /** Own funds Max Approval counts toward cash to close. */
  eligibleOwn: number
  /** Cash gifts and grants it counts. */
  eligibleGift: number
  eligible: number
  /** Reported less the 1003 (positive = they say they have more than the file shows). */
  gap: number
}

export function assetColumns(reported: { balance: number }[], verified: { assetType: string; amount: number | null; useAs: string }[]): AssetColumns {
  const r = round(reported.reduce((s, a) => s + a.balance, 0))
  const v = round(verified.reduce((s, a) => s + (a.amount ?? 0), 0))
  const funds = approvalFunds(verified)
  return { reported: r, verified: v, eligibleOwn: funds.own, eligibleGift: funds.gift, eligible: round(funds.own + funds.gift), gap: round(r - v) }
}
