// From a quick quote to a borrower file: what "Save as lead" and "Start
// pre-qual" write into the loan (the loan stays the one source of truth), and
// what a quote opened from a file starts with. Pure.

import { round } from '@/lib/calc'
import { formatCurrency } from '@/lib/format'
import type { LoanDetails, LoanProfile, Property } from '@/lib/api/types'
import { baseLoanAmount, blankOption, blankScenario, bucketFor, countyTaxRate, DEFAULT_ANNUAL_INSURANCE, MORTGAGE_TYPE_LABEL, taxBasis, type QuoteOption, type QuoteScenario } from './quote'

/** The option the file takes: the recommended one, else the first on the quote. */
export const leadOption = (options: QuoteOption[]) => options.find((o) => o.onQuote && o.recommended) ?? options.find((o) => o.onQuote) ?? null

/**
 * Loan facts from the quote: purpose-specific amounts, occupancy, and the lead
 * option's loan type, rate, term and points. Taxes and insurance become the
 * loan's estimates (used where no home has figures): a typed monthly tax is
 * turned back into a percent of the price.
 */
export function loanFactsFromQuote(s: QuoteScenario, option: QuoteOption | null): Partial<LoanDetails> {
  const loan = baseLoanAmount(s, option ?? blankOption('scenario'))
  const basis = taxBasis(s)
  const taxRatePct = s.taxesMonthly != null && basis ? round(((s.taxesMonthly * 12) / basis) * 100, 3) : countyTaxRate(s.county).ratePct
  const facts: Partial<LoanDetails> = {
    occupancy: s.occupancy,
    purchasePrice: s.purpose === 'purchase' ? s.purchasePrice : null,
    loanAmount: loan,
    estimatedTaxRatePct: taxRatePct,
    estimatedAnnualInsurance: s.insuranceMonthly != null ? round(s.insuranceMonthly * 12) : DEFAULT_ANNUAL_INSURANCE,
  }
  if (option) {
    facts.mortgageType = option.mortgageType
    facts.termMonths = option.termMonths
    if (option.ratePct != null) facts.noteRate = option.ratePct
    if (loan) facts.discountPointsAmount = round((loan * option.pointsPct) / 100)
  }
  return facts
}

/** The facts that would change an existing file (figures it already has), for the confirm message. */
export function factChanges(current: LoanDetails, facts: Partial<LoanDetails>): (keyof LoanDetails)[] {
  return (Object.keys(facts) as (keyof LoanDetails)[]).filter((k) => current[k] != null && current[k] !== facts[k])
}

const FACT_LABEL: Partial<Record<keyof LoanDetails, [string, (v: never) => string]>> = {
  occupancy: ['occupancy', (v: string) => v.replace('_', ' ')],
  purchasePrice: ['price', (v: number) => formatCurrency(v)],
  loanAmount: ['loan amount', (v: number) => formatCurrency(v)],
  estimatedTaxRatePct: ['tax estimate', (v: number) => `${v}%`],
  estimatedAnnualInsurance: ['insurance estimate', (v: number) => `${formatCurrency(v)}/yr`],
  mortgageType: ['loan type', (v: string) => MORTGAGE_TYPE_LABEL[v as keyof typeof MORTGAGE_TYPE_LABEL] ?? v],
  termMonths: ['term', (v: number) => `${v / 12} years`],
  noteRate: ['rate', (v: number) => `${v}%`],
  discountPointsAmount: ['points', (v: number) => formatCurrency(v)],
}

/** "rate 6% → 6.875%, points $4,037.50 → $0". */
export function describeChanges(current: LoanDetails, facts: Partial<LoanDetails>): string {
  return factChanges(current, facts)
    .map((k) => {
      const [name, fmt] = FACT_LABEL[k] ?? [String(k), (v: never) => String(v)]
      const show = fmt as (v: unknown) => string
      return `${name} ${show(current[k])} → ${show(facts[k])}`
    })
    .join(', ')
}

/** A quote started from a borrower file: their name and contact details, and the deal as the file has it. */
export function scenarioFromLoan(loan: LoanProfile, creditScore: number | null, home: Property | null): QuoteScenario {
  const d = loan.details
  const b = loan.borrower
  const purpose = loan.purpose === 'refinance_rate_term' || loan.purpose === 'refinance_cash_out' ? loan.purpose : 'purchase'
  const firstLien = home?.liens.find((l) => l.position === 'first') ?? null
  return {
    ...blankScenario(),
    borrower: { name: b ? `${b.firstName} ${b.lastName}`.trim() : '', email: b?.email ?? '', phone: b?.phone ?? '' },
    purpose,
    purchasePrice: purpose === 'purchase' ? d.purchasePrice : null,
    downPayment: purpose === 'purchase' && d.purchasePrice && d.loanAmount != null && d.loanAmount < d.purchasePrice ? round(d.purchasePrice - d.loanAmount) : null,
    value: purpose === 'purchase' ? null : (home?.estimatedValue ?? null),
    loanBalance: purpose === 'purchase' ? null : (firstLien?.balance ?? null),
    cashOut: purpose === 'refinance_cash_out' && d.loanAmount && firstLien?.balance ? Math.max(0, round(d.loanAmount - firstLien.balance)) : null,
    creditBucket: bucketFor(creditScore),
    occupancy: d.occupancy,
    propertyType: home?.propertyType ?? 'single_family',
    county: home?.county ?? null,
    state: home?.state ?? 'TX',
    taxesMonthly: home?.annualTaxes != null ? round(home.annualTaxes / 12) : null,
    insuranceMonthly: home?.annualInsurance != null ? round(home.annualInsurance / 12) : null,
  }
}
