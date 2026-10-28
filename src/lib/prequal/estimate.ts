// The Pre-Qual tool's results (docs/plans/prequal-tool.md): the headline max
// price, a "stretch" line, the comfortable search range and payment range,
// cash to close, funds left and the ratios at the max. Built on the tested
// max-price math in '@/lib/calc' (mortgage insurance always counts, per
// Connor's decision). Pure.

import { estimatedCashToClose, maxPurchasePrice, pct, purchasePayment, round, type DownPaymentChoice, type MaxPurchaseResult, type MortgageTypeKind } from '@/lib/calc'

/**
 * The DTI behind the headline max price, by loan type (Connor, 2026-10-27:
 * FHA at 45% on a pre-qual; 50% only as a stretch). Others keep LOSuite's
 * defaults.
 */
export const HEADLINE_DTI: Record<MortgageTypeKind, number> = { conventional: 45, fha: 45, va: 50, usda_rural: 41, other: 45 }
/** The "stretch" line: possible with a strong file and an AUS approval. Null = no stretch shown. */
export const STRETCH_DTI: Record<MortgageTypeKind, number | null> = { conventional: 50, fha: 50, va: null, usda_rural: null, other: null }
/** The comfortable search range: total DTI from 38% to 42% (Connor, 2026-10-27). */
export const COMFORTABLE_DTI = { low: 38, high: 42 } as const

export interface EstimateInput {
  /** Every borrower's gross monthly income. */
  monthlyIncome: number
  /** Monthly debts that stay after closing. */
  monthlyDebts: number
  mortgageType: MortgageTypeKind | null
  downPayment: DownPaymentChoice
  noteRatePct: number
  termMonths: number
  /** Yearly property tax as a percent of the price (from the county). */
  taxRatePct: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  /** Savings, checking and gift funds for closing. Null = not asked yet. */
  funds: number | null
  /** Entered closing costs; null = 3% of the price. */
  closingCosts: number | null
}

export interface Estimate {
  headlineDtiPct: number
  /** The max price and its payment at the headline DTI. Null = no room for a payment (or missing rate/term/income). */
  max: MaxPurchaseResult | null
  stretch: { dtiPct: number; price: number } | null
  /** Prices at 38% and 42% total DTI, and the payments at those prices. */
  comfortable: { low: number; high: number; paymentLow: number; paymentHigh: number } | null
  cashToClose: number | null
  /** Funds minus cash to close at the max. Negative = short. Null when funds aren't known. */
  leftAfterClosing: number | null
  /** Housing payment and total debts as a percent of income, at the max price. */
  housingRatioPct: number | null
  totalRatioPct: number | null
}

const at = (input: EstimateInput, dtiPct: number) => maxPurchasePrice({ ...input, otherMonthlyDebts: input.monthlyDebts, maxDtiPct: dtiPct })

/** Everything the results panel shows, from what the borrower said. */
export function prequalEstimate(input: EstimateInput): Estimate {
  const type = input.mortgageType ?? 'conventional'
  const headlineDtiPct = HEADLINE_DTI[type]
  const max = at(input, headlineDtiPct)
  const stretchDti = STRETCH_DTI[type]
  const stretchMax = stretchDti ? at(input, stretchDti) : null
  const low = at(input, COMFORTABLE_DTI.low)
  const high = at(input, COMFORTABLE_DTI.high)
  const cash = max ? estimatedCashToClose(max.price, max.loanAmount, input.closingCosts).total : null
  return {
    headlineDtiPct,
    max,
    stretch: stretchDti && stretchMax && max && stretchMax.price > max.price ? { dtiPct: stretchDti, price: stretchMax.price } : null,
    comfortable: low && high ? { low: low.price, high: high.price, paymentLow: low.payment.total, paymentHigh: high.payment.total } : null,
    cashToClose: cash,
    leftAfterClosing: cash !== null && input.funds !== null ? round(input.funds - cash) : null,
    housingRatioPct: max ? pct(max.payment.total, input.monthlyIncome, 1) : null,
    totalRatioPct: max ? pct(max.payment.total + input.monthlyDebts, input.monthlyIncome, 1) : null,
  }
}

/** The payment at one price with the same terms (for a target price the borrower names). */
export const paymentAt = (price: number, input: EstimateInput) => purchasePayment(price, input).payment.total

const LOAN_TYPE: Record<MortgageTypeKind, string> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA', other: 'Non-QM' }

/** "Assumes FHA, 5% down, 6.75% rate, 30-year term, Tarrant County taxes and $175/mo insurance. Estimate only, not a loan approval." */
export function assumptionsLine(input: EstimateInput, county: string | null): string {
  const down = input.downPayment.kind === 'percent' ? `${input.downPayment.pct}% down` : `$${Math.round(input.downPayment.amount).toLocaleString('en-US')} down`
  const years = input.termMonths % 12 === 0 ? `${input.termMonths / 12}-year` : `${input.termMonths}-month`
  const taxes = county ? `${county} County taxes` : input.taxRatePct != null ? `${input.taxRatePct}% property taxes` : 'estimated taxes'
  const insurance = input.annualInsurance ? `$${Math.round(input.annualInsurance / 12).toLocaleString('en-US')}/mo insurance` : 'estimated insurance'
  return `Assumes ${LOAN_TYPE[input.mortgageType ?? 'conventional']}, ${down}, ${input.noteRatePct}% rate, ${years} term, ${taxes} and ${insurance}. Estimate only, not a loan approval.`
}
