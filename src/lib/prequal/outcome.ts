// The Pre-Qual tool's status chip (9 outcomes) and "Ask next" questions
// (docs/plans/prequal-tool.md, rule-based). Pure.
//
// The outcome names are Connor's; the rules are proposed from LOSuite's
// readiness rules until the old app's are available.

import { estimatedCashToClose, loanForPrice, MIN_CREDIT_SCORE, round, type MortgageTypeKind } from '@/lib/calc'
import type { Estimate, EstimateInput } from './estimate'

export const OUTCOMES = [
  'Prequalified',
  'Prequalified with DPA',
  'Prequalified with Co-borrower',
  'Credit Improvement Needed',
  'DTI Improvement Needed',
  'Asset Improvement Needed',
  'Multiple Issues',
  'Manual Review',
  'Future Buyer',
] as const
export type Outcome = (typeof OUTCOMES)[number]

export type IncomeKind = 'w2' | 'self_employed' | 'form_1099' | 'retired' | 'other'

/** Good-news outcomes get the green chip; the rest are amber. */
export const POSITIVE_OUTCOMES: readonly Outcome[] = ['Prequalified', 'Prequalified with DPA', 'Prequalified with Co-borrower']

/** Down payment assistance usually wants at least this score. */
export const DPA_MIN_SCORE = 620

/** Cash needed at a price: down payment plus closing costs (entered, or 3%). */
export function cashNeededAt(price: number, input: Pick<EstimateInput, 'downPayment' | 'closingCosts'>): number {
  return estimatedCashToClose(price, loanForPrice(price, input.downPayment), input.closingCosts).total
}

export interface OutcomeInput {
  estimate: Estimate
  /** The same estimate on the main borrower's income alone (only when there's a co-borrower). */
  borrowerOnly: Estimate | null
  input: EstimateInput
  mortgageType: MortgageTypeKind | null
  creditScore: number | null
  incomeKind: IncomeKind | null
  firstTimeBuyer: boolean
  /** The timeline dropdown ("ASAP" … "6+ months", "Just looking"). */
  timeline: string | null
  /** A price they named; otherwise the bottom of the comfortable range is the test. */
  targetPrice: number | null
}

export interface OutcomeResult {
  outcome: Outcome
  /** Why, in a few words each (for Connor, never shown to the borrower). */
  reasons: string[]
}

/** The status chip, or null until there's income, a rate and a term to work with. */
export function prequalOutcome(o: OutcomeInput): OutcomeResult | null {
  const type = o.mortgageType ?? 'conventional'
  if (!o.input.monthlyIncome || !o.input.noteRatePct || !o.input.termMonths) return null
  if (o.incomeKind === 'self_employed' || o.incomeKind === 'form_1099' || type === 'other') {
    return { outcome: 'Manual Review', reasons: [o.incomeKind === 'self_employed' ? 'Self-employed income' : o.incomeKind === 'form_1099' ? '1099 income' : 'Non-QM program'] }
  }
  if (o.timeline === '6+ months' || o.timeline === 'Just looking') return { outcome: 'Future Buyer', reasons: [`Timeline: ${o.timeline}`] }

  const max = o.estimate.max
  const test = o.targetPrice ?? o.estimate.comfortable?.low ?? max?.price ?? null
  const minScore = MIN_CREDIT_SCORE[type]
  const credit = o.creditScore !== null && minScore !== null && o.creditScore < minScore
  const dti = !max || (o.targetPrice !== null && o.targetPrice > max.price)
  const short = test !== null && o.input.funds !== null ? round(cashNeededAt(test, o.input) - o.input.funds) : null
  const assets = short !== null && short > 0

  const reasons = [
    ...(credit ? [`Score ${o.creditScore} is under the usual ${minScore} minimum`] : []),
    ...(dti ? [max ? `$${Math.round(o.targetPrice!).toLocaleString('en-US')} is over the $${max.price.toLocaleString('en-US')} max` : 'Debts leave no room for a payment'] : []),
    ...(assets ? [`Short about $${Math.round(short!).toLocaleString('en-US')} to close`] : []),
  ]
  if (reasons.length > 1) return { outcome: 'Multiple Issues', reasons }
  if (credit) return { outcome: 'Credit Improvement Needed', reasons }
  if (dti) return { outcome: 'DTI Improvement Needed', reasons }
  if (assets) {
    // Short on cash only: a first-time buyer with the score for it can use down payment assistance.
    const dpa = o.firstTimeBuyer && (o.creditScore === null || o.creditScore >= DPA_MIN_SCORE)
    return dpa ? { outcome: 'Prequalified with DPA', reasons: [...reasons, 'Down payment assistance could cover it'] } : { outcome: 'Asset Improvement Needed', reasons }
  }
  // Fits, but only with the co-borrower's income counted.
  const alone = o.borrowerOnly?.max?.price ?? null
  if (o.borrowerOnly && test !== null && (alone === null || alone < test)) return { outcome: 'Prequalified with Co-borrower', reasons: ['Needs the co-borrower\'s income'] }
  return { outcome: 'Prequalified', reasons: [] }
}

export interface AskNextInput {
  creditScore: number | null
  /** Late payments, collections, bankruptcy etc. have been asked about. */
  creditHistoryAsked: boolean
  /** Savings and checking (not gifts). Null = not asked. */
  savings: number | null
  giftFunds: number | null
  monthlyDebts: number | null
  incomeKind: IncomeKind | null
  /** Months at the current job (main borrower). */
  monthsAtJob: number | null
  coBorrowerIncome: number | null
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** 2–4 follow-up questions for the call, most important first, from what's missing or risky. */
export function askNext(a: AskNextInput, limit = 4): string[] {
  const q: string[] = []
  if (a.creditScore === null) q.push('What would you estimate your credit score is?')
  if (!a.creditHistoryAsked) q.push('Any late payments or collections in the last 12 months?')
  if (a.incomeKind === 'self_employed' || a.incomeKind === 'form_1099') q.push('How many years have you filed as self-employed (or on 1099s)?')
  else if (a.monthsAtJob !== null && a.monthsAtJob < 24) q.push('Where did you work before this job? We need a 2-year history.')
  if (a.coBorrowerIncome) q.push(`Is the co-borrower's ${money(a.coBorrowerIncome)} income with a 2-year history?`)
  if (a.savings === null) q.push('How much do you have saved for the down payment and closing?')
  else if (a.savings >= 10_000) q.push(`Where is the ${money(a.savings)} held, and has it been there 60 days?`)
  if (a.giftFunds) q.push('Who is the gift from, and can they sign a gift letter?')
  if (a.monthlyDebts === null || a.monthlyDebts === 0) q.push('Any car payments, student loans or credit cards?')
  return q.slice(0, limit)
}
