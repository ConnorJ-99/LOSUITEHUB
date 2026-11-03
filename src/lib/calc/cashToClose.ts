import { round } from './round'

// The one cash-to-close calculation (purchase and refinance). Every screen
// calls it: Scenarios & Estimate, the 1003, Prequal, Quick Quote and the
// quote comparison. Positive cashToClose = the borrower brings money;
// negative = cash back to the borrower.

export interface CashToCloseInput {
  /** Purchase (price − loan) or refinance (payoffs − loan). */
  isPurchase: boolean
  /** Purchase price; ignored on a refinance. */
  purchasePrice: number | null
  /**
   * The base loan amount. A financed UFMIP, VA funding fee or USDA guarantee
   * fee goes to the agency, so it is never cash: leave it out here.
   */
  baseLoanAmount: number
  /** Closing costs A–H the borrower pays (points, fees, prepaids and escrows), before the lender credit. */
  closingCosts: number
  lenderCredit?: number
  earnestMoney?: number
  sellerCredits?: number
  /** Gift of equity and other credits that reduce what the borrower brings (rent credit, lot equity…). */
  otherCredits?: number
  /** Non-mortgage debts paid off at closing (the 1003's "paid off at closing"). */
  debtsPaidAtClosing?: number
  /** Refinance: mortgages paid off. */
  mortgagePayoffs?: number
  /** Cash gifts on the 1003: they don't change cash to close, but reduce what comes from the borrower's own funds. */
  cashGifts?: number
}

export interface CashToCloseResult {
  /** Purchase: price − base loan. Refinance: 0. */
  downPayment: number
  closingCosts: number
  debtsPaidAtClosing: number
  mortgagePayoffs: number
  /** Refinance: the new loan's proceeds (the base loan). Purchase: 0 (it's inside the down payment). */
  loanProceeds: number
  lenderCredit: number
  earnestMoney: number
  sellerCredits: number
  otherCredits: number
  totalCredits: number
  /** Positive = the borrower brings it; negative = cash back. */
  cashToClose: number
  label: 'Cash to close' | 'Cash to borrower'
  /** What the borrower brings from their own funds after cash gifts (never below 0). */
  fromOwnFunds: number
}

export function cashToClose(input: CashToCloseInput): CashToCloseResult {
  const n = (x: number | undefined | null) => x ?? 0
  const downPayment = input.isPurchase ? round(n(input.purchasePrice) - input.baseLoanAmount) : 0
  const loanProceeds = input.isPurchase ? 0 : round(input.baseLoanAmount)
  const mortgagePayoffs = input.isPurchase ? 0 : round(n(input.mortgagePayoffs))
  const credits = {
    lenderCredit: round(n(input.lenderCredit)),
    earnestMoney: round(n(input.earnestMoney)),
    sellerCredits: round(n(input.sellerCredits)),
    otherCredits: round(n(input.otherCredits)),
  }
  const totalCredits = round(credits.lenderCredit + credits.earnestMoney + credits.sellerCredits + credits.otherCredits)
  const debts = round(n(input.debtsPaidAtClosing))
  const cash = round(downPayment + mortgagePayoffs + input.closingCosts + debts - loanProceeds - totalCredits)
  return {
    downPayment,
    closingCosts: round(input.closingCosts),
    debtsPaidAtClosing: debts,
    mortgagePayoffs,
    loanProceeds,
    ...credits,
    totalCredits,
    cashToClose: cash,
    label: cash >= 0 ? 'Cash to close' : 'Cash to borrower',
    fromOwnFunds: round(Math.max(cash - n(input.cashGifts), 0)),
  }
}
