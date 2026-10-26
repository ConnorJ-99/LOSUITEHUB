import type { LoanProfile, Property } from '@/lib/api/types'
import { formatCurrency, formatPercent } from '@/lib/format'
import type { ApplicationSummary } from '@/lib/urla/summary'
import { creditTier } from './display'

export interface HeaderMetric {
  label: string
  value: string
  note?: string
  tone?: 'green' | 'amber' | 'red'
}

const LOAN_TYPE: Record<string, string> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA', other: 'Other' }

/**
 * The metrics strip on a loan file's header. Every figure comes from the
 * shared summary (the same numbers as the 1003 and Overview); nothing is
 * calculated here beyond picking and formatting.
 */
export function headerMetrics(loan: LoanProfile, summary: ApplicationSummary, creditScore: number | null): HeaderMetric[] {
  const d = loan.details
  const isSecond = loan.purpose === 'heloc' || loan.purpose === 'heloan'
  const tier = creditTier(creditScore)
  const subject: Property | null = summary.subject
  const pct = (v: number | null) => (v === null ? '—' : formatPercent(v, 2))
  return [
    { label: 'Loan amount', value: d.loanAmount === null ? '—' : formatCurrency(d.loanAmount) },
    { label: 'Loan type', value: d.mortgageType ? LOAN_TYPE[d.mortgageType] : '—' },
    { label: 'Credit score', value: creditScore === null ? '—' : String(creditScore), note: tier?.label, tone: tier?.tone },
    // A 2nd lien qualifies on CLTV, so LTV of the new lien alone isn't shown.
    ...(isSecond ? [] : [{ label: 'LTV', value: pct(summary.scenario.ltv) }]),
    { label: 'CLTV', value: pct(summary.scenario.cltv) },
    { label: 'DTI', value: pct(summary.qualifying.dti.back) },
    { label: 'Property', value: subject ? [subject.addressLine, subject.city, subject.state].filter(Boolean).join(', ') : 'TBD' },
  ]
}

/** The lowest estimated credit score among the borrowers (the qualifying score). */
export const qualifyingScore = (scores: (number | null)[]) => {
  const known = scores.filter((s): s is number => s !== null)
  return known.length ? Math.min(...known) : null
}
