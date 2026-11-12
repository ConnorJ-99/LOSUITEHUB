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

export const LOAN_TYPE_SHORT: Record<string, string> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda_rural: 'USDA', other: 'Other' }

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
    { label: 'Loan type', value: d.mortgageType ? LOAN_TYPE_SHORT[d.mortgageType] : '—' },
    // The estimate Selected for the file (Scenarios & Estimate) names the program, lender and rate.
    ...(d.pricingScenarioId && (d.programName || d.lenderName)
      ? [{ label: 'Selected', value: [d.programName, d.lenderName, d.noteRate != null ? formatPercent(d.noteRate, 3) : null].filter(Boolean).join(' · ') }]
      : []),
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

/** Where a header figure is edited: the file tab to open. */
export type FigureTab = 'overview' | 'prequal' | 'income' | 'estimates' | 'properties' | 'contract'

export interface KeyFigureData {
  label: string
  value: string
  tab: FigureTab | null
  title?: string
  note?: string
  tone?: 'green' | 'amber' | 'red'
}

/**
 * The compact header's key figures (Arive style): loan amount, LTV / CLTV,
 * credit, rate, DTI front / back, cash to close (the Selected estimate's saved
 * figure), estimated closing and the property. Picked and formatted only.
 */
export function keyFigures(loan: LoanProfile, summary: ApplicationSummary | null, creditScore: number | null, cashToClose: number | null): KeyFigureData[] {
  const d = loan.details
  const isSecond = loan.purpose === 'heloc' || loan.purpose === 'heloan'
  const tier = creditTier(creditScore)
  const pct = (v: number | null | undefined) => (v == null ? '—' : formatPercent(v, 2))
  const subject = summary?.subject ?? null
  const address = subject ? [subject.addressLine, subject.city, subject.state].filter(Boolean).join(', ') : null
  const ltv = isSecond ? pct(summary?.scenario.cltv) : `${pct(summary?.scenario.ltv)} / ${pct(summary?.scenario.cltv)}`
  const dti = summary ? `${pct(summary.qualifying.dti.front)} / ${pct(summary.qualifying.dti.back)}` : '—'
  return [
    { label: 'Loan amount', value: d.loanAmount === null ? '—' : formatCurrency(d.loanAmount), tab: 'overview' },
    { label: isSecond ? 'CLTV' : 'LTV / CLTV', value: ltv, tab: 'overview' },
    { label: 'Credit', value: creditScore === null ? '—' : String(creditScore), note: tier?.label, tone: tier?.tone, tab: 'prequal' },
    { label: 'Rate', value: d.noteRate === null ? '—' : formatPercent(d.noteRate, 3), tab: 'estimates' },
    { label: 'DTI front / back', value: dti, tab: 'prequal' },
    { label: 'Cash to close', value: cashToClose === null ? '—' : formatCurrency(Math.abs(cashToClose)), title: cashToClose === null ? 'Select an estimate on Scenarios & Estimate' : cashToClose < 0 ? 'Cash back to the borrower (Selected estimate)' : 'From the Selected estimate', tab: 'estimates' },
    { label: 'Est. closing', value: d.closingDate ? usDate(d.closingDate) : '—', tab: loan.purpose === 'purchase' ? 'contract' : 'overview' },
    { label: 'Property', value: address ?? 'TBD', title: address ?? 'No subject property yet', tab: 'properties' },
  ]
}

const usDate = (iso: string) => {
  const [y, m, day] = iso.split('-')
  return `${Number(m)}/${Number(day)}/${y.slice(2)}`
}
