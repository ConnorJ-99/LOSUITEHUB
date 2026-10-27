// Lender quotes on a pricing scenario (Loan · Pricing, mockups 06 and 07):
// each quote's closing costs (typed, or the scenario's fee sheet run at the
// quote's rate and points), and the deal every quote prices. The payment,
// cash to close, cost over time, sorting and break-even are in
// '@/lib/calc/quotes'. Pure.

import { quoteFigures, type QuoteDeal, type QuoteFigures, type QuoteInput } from '@/lib/calc'
import type { FeeOverride, FeeTemplate } from '@/lib/calc'
import type { Property } from '@/lib/api/types'
import type { LoanPurpose } from '@/lib/pipeline/stages'
import { payoffsFor, priceScenario, scenarioFigures, type ScenarioDraft } from './scenario'

export interface SavedQuote {
  id: string
  optionId: string
  pricingScenarioId: string
  rate: number
  lockDays: number | null
  /** Points (+) or credit (−) as a percent of the loan. */
  pointsPct: number
  lenderCredit: number
  /** Total closing costs including points, as typed; null when worked out from the fee sheet. */
  closingCosts: number | null
  closingCostsFromFeeSheet: boolean
  /** Null = calculated from the loan type and LTV. */
  monthlyMi: number | null
  quoteDate: string
  notes: string | null
}

export interface CompareContext {
  purpose: LoanPurpose
  scenario: ScenarioDraft
  property: Property | null
  templates: FeeTemplate[]
  overrides: FeeOverride[]
  earnestMoney: number
  sellerCredits: number
}

/** The scenario at a quote's rate and points (lender credit is counted separately). */
const atQuote = (s: ScenarioDraft, q: Pick<SavedQuote, 'rate' | 'pointsPct'>): ScenarioDraft => ({ ...s, noteRate: q.rate, pointsPct: Math.max(0, q.pointsPct), lenderCredit: 0 })

/** Closing costs including points: as typed, or the fee sheet run at the quote's rate and points. */
export function quoteClosingCosts(q: Pick<SavedQuote, 'rate' | 'pointsPct' | 'closingCosts' | 'closingCostsFromFeeSheet'>, ctx: CompareContext): number {
  if (!q.closingCostsFromFeeSheet && q.closingCosts != null) return q.closingCosts
  return priceScenario(atQuote(ctx.scenario, q), ctx.purpose, ctx.templates, ctx.overrides).closingCosts
}

/** What every quote on this scenario prices: the loan, the term, the price or payoffs, and the monthly taxes, insurance and HOA. */
export function quoteDeal(ctx: CompareContext): QuoteDeal {
  const f = scenarioFigures(ctx.scenario)
  return {
    loanAmount: f.totalLoanAmount,
    termMonths: ctx.scenario.termMonths ?? 360,
    purchasePrice: ctx.purpose === 'purchase' ? ctx.scenario.purchasePrice : null,
    payoffs: payoffsFor(ctx.purpose, ctx.property),
    monthlyTaxesInsurance: Math.round((f.payment.hoi + f.payment.taxes + f.payment.supplemental) * 100) / 100,
    monthlyHoa: f.payment.hoa + f.payment.other,
    earnestMoney: ctx.earnestMoney,
    sellerCredits: ctx.sellerCredits,
  }
}

export function quoteInput(q: SavedQuote, ctx: CompareContext): QuoteInput {
  return {
    id: q.id,
    rate: q.rate,
    closingCosts: quoteClosingCosts(q, ctx),
    lenderCredit: q.lenderCredit,
    monthlyMi: q.monthlyMi ?? scenarioFigures(atQuote(ctx.scenario, q)).payment.mi,
  }
}

/** Every quote's figures on one scenario. */
export function compareQuotes(quotes: SavedQuote[], ctx: CompareContext, horizonYears?: number): QuoteFigures[] {
  const deal = quoteDeal(ctx)
  return quotes.map((q) => quoteFigures(quoteInput(q, ctx), deal, horizonYears))
}
