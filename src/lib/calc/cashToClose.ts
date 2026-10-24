import { round } from './round'

export interface CashToCloseInput {
  purchasePrice: number
  loanAmount: number
  closingCosts?: number
  prepaidsAndEscrows?: number
  earnestMoney?: number
  sellerCredits?: number
  lenderCredits?: number
  otherCredits?: number
}

export interface CashToCloseResult {
  downPayment: number
  totalCosts: number
  totalCredits: number
  cashToClose: number
}

/**
 * Estimated cash the borrower brings to closing on a purchase.
 * A negative cashToClose means cash back to the borrower.
 */
export function cashToClose(input: CashToCloseInput): CashToCloseResult {
  const downPayment = round(input.purchasePrice - input.loanAmount)
  const totalCosts = round((input.closingCosts ?? 0) + (input.prepaidsAndEscrows ?? 0))
  const totalCredits = round(
    (input.earnestMoney ?? 0) +
      (input.sellerCredits ?? 0) +
      (input.lenderCredits ?? 0) +
      (input.otherCredits ?? 0),
  )
  return {
    downPayment,
    totalCosts,
    totalCredits,
    cashToClose: round(downPayment + totalCosts - totalCredits),
  }
}
