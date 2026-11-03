// Prequal results (next build Session 3, decision 7): the one-page PDF a
// borrower gets after the phone prequal, and the follow-up text that goes to
// the Action Queue once it's emailed. Pure. It says "pre-qualified" and never
// shows a rate (rates change daily and nothing is locked).

import type { MortgageType } from '@/lib/api/types'
import type { PitiResult } from '@/lib/calc'
import { MORTGAGE_TYPE_OPTIONS } from '@/components/profile/options'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'
import { formatPhone, phoneDigits } from '@/lib/pipeline/helpers'
import { joinNames } from './feeWorksheet'

export const PREQUAL_RESULTS_TEMPLATE = 'prequal-results v1'

/** What the PDF is made from: the saved prequal's figures. */
export interface PrequalResultsInput {
  borrowerNames: string[]
  isPurchase: boolean
  mortgageType: MortgageType | null
  termMonths: number | null
  /** The price the payment and cash are figured at (purchase). */
  purchasePrice: number | null
  loanAmount: number | null
  /** Highest price at the loan type's DTI limit (purchase); null when there isn't one. */
  maxPrice: number | null
  payment: PitiResult | null
  downPayment: number | null
  closingCosts: number | null
  closingCostsEstimated: boolean
  /** Down payment, closing costs and payoffs together. */
  cashNeeded: number | null
  preparedOn: string
}

export interface PrequalResultsView {
  borrowers: string
  preparedOn: string
  headline: { label: string; value: string; note: string }
  facts: { label: string; value: string }[]
  payment: { label: string; amount: number }[]
  paymentTotal: number
  cash: { label: string; amount: number }[]
  cashTotal: number | null
  nextSteps: string[]
  disclaimer: string
}

const typeLabel = (t: MortgageType | null) => MORTGAGE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? '—'
const termLabel = (months: number | null) => (months ? `${months / 12} years` : '—')

/** Why the results can't be made yet, in words (empty = ready). */
export function prequalResultsProblems(i: PrequalResultsInput): string[] {
  return [
    ...(i.borrowerNames.length ? [] : ['Add a borrower first.']),
    ...(i.mortgageType ? [] : ['Pick a loan type.']),
    ...(i.termMonths ? [] : ['Pick a term.']),
    ...(i.isPurchase && !i.purchasePrice ? ['Enter a purchase price (or click "Use this price").'] : []),
    ...(i.isPurchase && !i.maxPrice ? ['There is no buying power yet: enter income, debts and an interest rate.'] : []),
    ...(!i.isPurchase && !i.loanAmount ? ['Enter a loan amount.'] : []),
    ...(i.payment ? [] : ['There is no payment yet: enter an interest rate.']),
  ]
}

/** What the PDF shows. Call only when prequalResultsProblems() is empty. */
export function prequalResultsView(i: PrequalResultsInput): PrequalResultsView {
  const p = i.payment!
  const payment = [
    { label: 'Principal and interest', amount: p.principalAndInterest },
    { label: 'Property taxes (est.)', amount: p.taxes },
    { label: "Homeowner's insurance (est.)", amount: p.insurance },
    ...(p.hoa ? [{ label: 'HOA dues', amount: p.hoa }] : []),
    ...(p.mortgageInsurance ? [{ label: 'Mortgage insurance', amount: p.mortgageInsurance }] : []),
  ]
  const downPct = i.isPurchase && i.purchasePrice && i.downPayment !== null ? (i.downPayment / i.purchasePrice) * 100 : null
  const facts = [
    { label: 'Loan type', value: typeLabel(i.mortgageType) },
    { label: 'Term', value: termLabel(i.termMonths) },
    ...(i.isPurchase
      ? [
          { label: 'Purchase price', value: formatCurrency(i.purchasePrice) },
          { label: 'Down payment', value: i.downPayment === null ? '—' : `${formatCurrency(i.downPayment)}${downPct === null ? '' : ` (${formatPercent(downPct, 1)})`}` },
        ]
      : []),
    { label: 'Loan amount', value: formatCurrency(i.loanAmount) },
  ]
  const cash = i.isPurchase
    ? [
        ...(i.downPayment !== null ? [{ label: 'Down payment', amount: i.downPayment }] : []),
        ...(i.closingCosts !== null ? [{ label: i.closingCostsEstimated ? 'Closing costs (est. 3% of price)' : 'Closing costs (est.)', amount: i.closingCosts }] : []),
      ]
    : []
  const listed = cash.reduce((sum, c) => sum + c.amount, 0)
  if (i.isPurchase && i.cashNeeded !== null && i.cashNeeded > listed) cash.push({ label: 'Debts paid off at closing', amount: i.cashNeeded - listed })
  return {
    borrowers: joinNames(i.borrowerNames),
    preparedOn: formatIsoDate(i.preparedOn),
    headline: i.isPurchase
      ? { label: 'Estimated buying power', value: `Up to ${formatCurrency(i.maxPrice)}`, note: 'The highest home price that fits your income, debts and savings today.' }
      : { label: 'Estimated loan amount', value: formatCurrency(i.loanAmount), note: 'Based on your home, your income, debts and what you told us about your current loan.' },
    facts,
    payment,
    paymentTotal: p.total,
    cash,
    cashTotal: i.isPurchase ? (i.cashNeeded ?? (cash.length ? listed : null)) : null,
    nextSteps: i.isPurchase
      ? [
          'Send your documents: your last 30 days of pay stubs, your last 2 years of W-2s and your last 2 months of bank statements (all pages).',
          "We'll review your credit and documents and turn this into a pre-approval letter you can make offers with.",
          `Start looking at homes up to ${formatCurrency(i.maxPrice)}. Before you make an offer, send me the address so I can check the numbers for that home.`,
        ]
      : [
          'Send your documents: your last 30 days of pay stubs, your last 2 years of W-2s, your last 2 months of bank statements, your latest mortgage statement and your homeowner\'s insurance declarations page.',
          "We'll review your credit and documents and walk you through your loan options before anything is locked.",
        ],
    disclaimer:
      'You are pre-qualified based on what you told us about your income, debts, savings and credit. None of it has been verified yet, so this is not a pre-approval or a commitment to lend. Taxes, insurance and closing costs are estimates. Programs and terms can change until your rate is locked.',
  }
}

/** The text that goes to the Action Queue once the results are emailed (decision 7, Connor's wording). */
export function prequalFollowUpText(firstName: string | null, personalCell: string | null): string {
  const name = firstName?.trim()
  const cell = phoneDigits(personalCell) ? formatPhone(personalCell) : null
  const start = `Hey${name ? ` ${name}` : ''}, thanks for the phone call today. I just sent your prequalified results to your email.`
  return cell ? `${start} This is our work number, but you're welcome to reach me on my personal cell too: ${cell}.` : start
}
