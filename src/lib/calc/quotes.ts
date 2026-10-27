// Lender quote comparison (docs/plans/product-search-v2.md §7): payment, cash
// to close, cost over a horizon, sorting with tie-breaks, and break-even
// between two options. Rates are percents (7.5).

import { monthlyPrincipalAndInterest } from './payment'
import { round } from './round'

export interface QuoteInput {
  id: string
  rate: number
  /** Total closing costs including points. */
  closingCosts: number
  lenderCredit: number
  monthlyMi: number
}

/** The deal every quote prices (one pricing scenario: TBD or a home). */
export interface QuoteDeal {
  loanAmount: number
  termMonths: number
  /** Purchase price; null for a refinance. */
  purchasePrice: number | null
  /** Refinance: mortgages paid off. */
  payoffs: number
  monthlyTaxesInsurance: number
  monthlyHoa: number
  earnestMoney: number
  sellerCredits: number
}

export interface QuoteFigures {
  id: string
  rate: number
  principalAndInterest: number
  mi: number
  taxesInsurance: number
  totalPayment: number
  downPayment: number
  /** Positive = the borrower brings it; negative = cash back. */
  cashToClose: number
  /** Cash to close + horizon × (P&I + MI). */
  horizonCost: number
}

/** Default horizon for the cost comparison (Connor can pick 3, 5 or 7 years). */
export const DEFAULT_HORIZON_YEARS = 5

export function quoteFigures(q: QuoteInput, deal: QuoteDeal, horizonYears = DEFAULT_HORIZON_YEARS): QuoteFigures {
  const pi = monthlyPrincipalAndInterest(deal.loanAmount, q.rate, deal.termMonths)
  const downPayment = deal.purchasePrice != null ? round(deal.purchasePrice - deal.loanAmount) : 0
  // Purchase: down payment + costs − credits. Refinance: payoffs + costs − credits − the new loan.
  const base = deal.purchasePrice != null ? downPayment : deal.payoffs - deal.loanAmount
  const cashToClose = round(base + q.closingCosts - q.lenderCredit - deal.sellerCredits - deal.earnestMoney)
  return {
    id: q.id,
    rate: q.rate,
    principalAndInterest: pi,
    mi: q.monthlyMi,
    taxesInsurance: deal.monthlyTaxesInsurance,
    totalPayment: round(pi + q.monthlyMi + deal.monthlyTaxesInsurance + deal.monthlyHoa),
    downPayment,
    cashToClose,
    horizonCost: round(cashToClose + horizonYears * 12 * (pi + q.monthlyMi)),
  }
}

export type QuoteSort = 'rate' | 'cash' | 'payment' | 'cost'
const METRIC: Record<QuoteSort, (f: QuoteFigures) => number> = {
  rate: (f) => f.rate,
  cash: (f) => f.cashToClose,
  payment: (f) => f.totalPayment,
  cost: (f) => f.horizonCost,
}
const ORDER: QuoteSort[] = ['rate', 'cash', 'payment', 'cost']

/** Lowest first by the chosen metric; ties break by the next metric (rate → cash to close → payment → cost). */
export function sortQuotes(figures: QuoteFigures[], by: QuoteSort): QuoteFigures[] {
  const keys = [by, ...ORDER.filter((k) => k !== by)]
  return [...figures].sort((a, b) => {
    for (const k of keys) {
      const d = METRIC[k](a) - METRIC[k](b)
      if (Math.abs(d) > 1e-9) return d
    }
    return 0
  })
}

/** The winner of each category (the first after sorting by it). */
export function categoryWinners(figures: QuoteFigures[]): Record<QuoteSort, string> | null {
  if (figures.length === 0) return null
  return Object.fromEntries(ORDER.map((k) => [k, sortQuotes(figures, k)[0].id])) as Record<QuoteSort, string>
}

export type BreakEven =
  | { kind: 'never'; better: string }
  | { kind: 'same' }
  | { kind: 'breaks_even'; payMoreUpFront: string; payLessUpFront: string; upFrontDifference: number; monthlyDifference: number; months: number; years: number }

/**
 * Break-even between two options on up-front cash and monthly P&I + MI:
 * the extra cash up front ÷ the monthly saving. "Never" when one option is
 * cheaper (or equal) on both.
 */
export function breakEven(a: QuoteFigures, b: QuoteFigures): BreakEven {
  const upFront = a.cashToClose - b.cashToClose
  const monthly = a.principalAndInterest + a.mi - (b.principalAndInterest + b.mi)
  const eq = (n: number) => Math.abs(n) < 0.005
  if (eq(upFront) && eq(monthly)) return { kind: 'same' }
  if (upFront <= 0.005 && monthly <= 0.005) return { kind: 'never', better: a.id }
  if (upFront >= -0.005 && monthly >= -0.005) return { kind: 'never', better: b.id }
  // One costs more up front and less each month.
  const [more, less] = upFront > 0 ? [a, b] : [b, a]
  const up = Math.abs(upFront)
  const mo = Math.abs(monthly)
  const months = up / mo
  return { kind: 'breaks_even', payMoreUpFront: more.id, payLessUpFront: less.id, upFrontDifference: round(up), monthlyDifference: round(mo), months: round(months, 1), years: round(months / 12, 1) }
}
