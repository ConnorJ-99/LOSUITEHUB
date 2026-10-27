// The loan comparison PDF for the borrower (Loan · Pricing → Save PDF): every
// quoted option on one pricing scenario, side by side. The figures come from
// '@/lib/pricing/compare' and '@/lib/calc/quotes'; this only picks and labels
// them. Options are named "Option 1, 2..." with the program, not the lender
// (the borrower picks a loan, and Connor can still move it). Pure.

import { categoryWinners, DEFAULT_HORIZON_YEARS, sortQuotes, type QuoteFigures, type QuoteSort } from '@/lib/calc'
import type { SavedQuote } from '@/lib/pricing/compare'
import { purposeLabel, type LoanPurpose } from '@/lib/pipeline/stages'
import { formatCurrency, formatPercent } from '@/lib/format'
import { joinNames, preparedLabel, worksheetNumber } from './feeWorksheet'

export const LOAN_COMPARISON_TEMPLATE = 'loan-comparison v1'

/** One page holds this many options side by side. */
export const MAX_COMPARISON_OPTIONS = 5

export interface ComparisonOption {
  programName: string
  quote: SavedQuote
  figures: QuoteFigures
  /** Total closing costs including points (before lender credit). */
  closingCosts: number
}

export interface LoanComparison {
  number: string
  preparedAt: string
  borrowers: string
  facts: { label: string; value: string }[]
  columns: { name: string; program: string; best: string[] }[]
  rows: { label: string; values: string[]; strong?: boolean }[]
  horizonYears: number
}

export interface ComparisonInput {
  scenarioId: string
  purpose: LoanPurpose
  scenarioName: string
  hasProperty: boolean
  purchasePrice: number | null
  propertyValue: number | null
  loanAmount: number
  product: string
  options: ComparisonOption[]
  borrowerNames: string[]
  preparedAt: string
  horizonYears?: number
}

const BEST: Record<QuoteSort, string> = { rate: 'Lowest rate', cash: 'Lowest cash to close', payment: 'Lowest payment', cost: 'Lowest cost over time' }

/** Points (+) or credit (−) as a percent, e.g. "0.500 pts" or "0.250 credit". */
const pointsText = (pct: number) => (pct === 0 ? 'None' : pct > 0 ? `${pct.toFixed(3)} pts` : `${(-pct).toFixed(3)} credit`)

/** Everything the loan comparison PDF shows, cheapest rate first. */
export function loanComparison(input: ComparisonInput): LoanComparison {
  const horizonYears = input.horizonYears ?? DEFAULT_HORIZON_YEARS
  const byId = new Map(input.options.map((o) => [o.quote.id, o]))
  const order = sortQuotes(
    input.options.map((o) => o.figures),
    'rate',
  )
    .slice(0, MAX_COMPARISON_OPTIONS)
    .map((f) => byId.get(f.id)!)
  const winners = order.length > 1 ? categoryWinners(order.map((o) => o.figures)) : null
  const isPurchase = input.purpose === 'purchase'
  const col = (fn: (o: ComparisonOption) => string) => order.map(fn)
  const cash = (n: number) => (n < 0 ? `${formatCurrency(-n)} back` : formatCurrency(n))

  return {
    number: worksheetNumber(input.scenarioId, input.preparedAt),
    preparedAt: preparedLabel(input.preparedAt),
    borrowers: joinNames(input.borrowerNames),
    facts: [
      { label: 'Loan purpose', value: purposeLabel(input.purpose) },
      { label: isPurchase ? 'Purchase price' : 'Estimated value', value: formatCurrency(isPurchase ? input.purchasePrice : input.propertyValue) },
      { label: 'Loan amount', value: formatCurrency(input.loanAmount) },
      { label: 'Loan', value: input.product || '—' },
      { label: 'Property', value: input.hasProperty ? input.scenarioName : 'To be determined' },
    ],
    columns: order.map((o, i) => ({
      name: `Option ${i + 1}`,
      program: o.programName,
      best: winners ? (Object.keys(BEST) as QuoteSort[]).filter((k) => winners[k] === o.quote.id).map((k) => BEST[k]) : [],
    })),
    rows: [
      { label: 'Interest rate', values: col((o) => formatPercent(o.quote.rate, 3)), strong: true },
      { label: 'Points or credit', values: col((o) => pointsText(o.quote.pointsPct)) },
      { label: 'Rate lock', values: col((o) => (o.quote.lockDays ? `${o.quote.lockDays} days` : '—')) },
      { label: 'Closing costs', values: col((o) => formatCurrency(o.closingCosts)) },
      { label: 'Lender credit', values: col((o) => (o.quote.lenderCredit ? `-${formatCurrency(o.quote.lenderCredit)}` : '—')) },
      ...(isPurchase ? [{ label: 'Down payment', values: col((o) => formatCurrency(o.figures.downPayment)) }] : []),
      { label: isPurchase ? 'Estimated cash to close' : 'Estimated cash to close (or back)', values: col((o) => cash(o.figures.cashToClose)), strong: true },
      { label: 'Principal and interest', values: col((o) => formatCurrency(o.figures.principalAndInterest)) },
      { label: 'Mortgage insurance', values: col((o) => formatCurrency(o.figures.mi)) },
      { label: 'Taxes, insurance and HOA', values: col((o) => formatCurrency(o.figures.totalPayment - o.figures.principalAndInterest - o.figures.mi)) },
      { label: 'Estimated monthly payment', values: col((o) => formatCurrency(o.figures.totalPayment)), strong: true },
      { label: `Cost over ${horizonYears} years`, values: col((o) => formatCurrency(Math.round(o.figures.horizonCost))) },
    ],
    horizonYears,
  }
}
