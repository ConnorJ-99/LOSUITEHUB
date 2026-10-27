// The Fee Worksheet PDF's contents (Fees tab → Save PDF), from a priced
// scenario. Every amount and subtotal is worked out here so the PDF only lays
// out what it's given. It is titled "Fee Worksheet", never "Loan Estimate":
// Arive sends the official TRID Loan Estimate. Pure.

import { cltv, round, type FeeLine, type FeeSection, type SectionTotals } from '@/lib/calc'
import type { CashFigure, ScenarioDraft, ScenarioFigures } from '@/lib/pricing/scenario'
import type { Occupancy, PropertyType } from '@/lib/api/types'
import { purposeLabel, type LoanPurpose } from '@/lib/pipeline/stages'
import { MORTGAGE_TYPE_OPTIONS, OCCUPANCY_OPTIONS, PROPERTY_TYPE_OPTIONS } from '@/components/profile/options'
import { formatCurrency, formatPercent } from '@/lib/format'

/** Saved with each PDF (loan_documents.template_version). Bump it when the wording changes. */
export const FEE_WORKSHEET_TEMPLATE = 'fee-worksheet v1'

/** The line the template README requires on every worksheet. */
export const OFFICIAL_LE_CALLOUT = 'Your actual rate, payment and costs could be higher. Get an official Loan Estimate before choosing a loan.'

export const WORKSHEET_DISCLAIMER =
  'This worksheet is for illustration and information only. It is based on the information provided and current market pricing as of the preparation date, and it is not a Loan Estimate, loan approval or commitment to lend. Rates, fees and terms are not guaranteed until your rate is locked and may change. Taxes, insurance, prepaid interest and escrow amounts are estimates. You will receive an official Loan Estimate after you apply.'

const SECTION_TITLE: Record<FeeSection, string> = {
  A: 'Origination charges',
  B: "Services you can't shop for",
  C: 'Services you can shop for',
  E: 'Taxes and government fees',
  F: 'Prepaids',
  G: 'Initial escrow payment at closing',
  H: 'Other',
}
const PAID_BY_NOTE = { S: 'paid by seller', L: 'paid by lender', O: 'paid by others' } as const

export interface WorksheetRow {
  label: string
  /** "paid by seller" and the like: shown, but not in the borrower's total. */
  note: string | null
  amount: number
}

export interface WorksheetSection {
  letter: FeeSection
  title: string
  total: number
  rows: WorksheetRow[]
}

export interface AmountLine {
  label: string
  amount: number
  /** Shown with a minus sign (subtracted). */
  negative?: boolean
}

export interface FeeWorksheet {
  number: string
  preparedAt: string
  borrowers: string
  facts: { label: string; value: string }[]
  loanCosts: WorksheetSection[]
  otherCosts: WorksheetSection[]
  /** D = A + B + C, I = E + F + G + H, J = D + I (before lender credits). */
  totals: { D: number; I: number; J: number; lenderCredits: number }
  payment: { lines: AmountLine[]; total: number }
  cash: { title: string; lines: AmountLine[]; total: number }
}

export interface WorksheetInput {
  scenarioId: string
  purpose: LoanPurpose
  occupancy: Occupancy
  scenario: ScenarioDraft
  lines: FeeLine[]
  totals: SectionTotals
  figures: ScenarioFigures
  cash: CashFigure
  payoffs: number
  /** Balances of mortgages that stay on the home (e.g. the first lien behind a HELOC), for CLTV. */
  remainingLiens: number
  earnestMoney: number
  sellerCredits: number
  property: { city: string | null; state: string | null; zip: string | null; propertyType: PropertyType | null } | null
  borrowerNames: string[]
  /** ISO timestamp. */
  preparedAt: string
}

const labelOf = <T extends string>(options: readonly { value: T; label: string }[], value: T | null) => options.find((o) => o.value === value)?.label ?? null

/** "Marcus Reed and Dana Reed", "A, B and C". */
export function joinNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean)
  return clean.length <= 1 ? (clean[0] ?? '') : `${clean.slice(0, -1).join(', ')} and ${clean.at(-1)}`
}

/** A short, readable worksheet number: the date (Central time) and the scenario. "20261027-3F9A". */
export function worksheetNumber(scenarioId: string, preparedAt: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(preparedAt)).replaceAll('-', '')
  return `${day}-${scenarioId.replace(/-/g, '').slice(0, 4).toUpperCase()}`
}

/** "Oct 27, 2026, 3:05 PM CT". */
export function preparedLabel(preparedAt: string): string {
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(preparedAt))} CT`
}

/** "Conventional 30-year fixed", "FHA 30-year fixed, interest only". */
export function productLabel(s: Pick<ScenarioDraft, 'mortgageType' | 'termMonths' | 'amortizationType' | 'interestOnly'>): string {
  const term = s.termMonths ? `${s.termMonths % 12 === 0 ? `${s.termMonths / 12}-year` : `${s.termMonths}-month`} ` : ''
  const kind = s.amortizationType === 'arm' ? 'ARM' : 'fixed'
  const product = [labelOf(MORTGAGE_TYPE_OPTIONS, s.mortgageType), `${term}${kind}`].filter(Boolean).join(' ')
  return s.interestOnly ? `${product}, interest only` : product
}

const ESCROWS = { none: 'Taxes & insurance', taxes: 'Insurance only', insurance: 'Taxes only', all: 'None (waived)' } as const

function section(letter: FeeSection, lines: FeeLine[], totals: SectionTotals): WorksheetSection {
  const rows = lines
    .filter((l) => l.section === letter && round(l.atClosing + l.beforeClosing) !== 0)
    .map((l): WorksheetRow => ({ label: l.name, note: l.paidBy === 'B' ? null : PAID_BY_NOTE[l.paidBy], amount: round(l.atClosing + l.beforeClosing) }))
  return { letter, title: SECTION_TITLE[letter], total: totals[letter], rows }
}

/** Everything the Fee Worksheet PDF shows. */
export function feeWorksheet(input: WorksheetInput): FeeWorksheet {
  const { scenario: s, figures: f, totals, purpose } = input
  const isPurchase = purpose === 'purchase'
  const value = s.propertyValue ?? s.purchasePrice
  const cltvPct = value ? cltv([f.totalLoanAmount, input.remainingLiens], value) : null
  const place = input.property ? [input.property.city, [input.property.state, input.property.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : ''
  const propertyType = labelOf(PROPERTY_TYPE_OPTIONS, input.property?.propertyType ?? null)

  const D = round(totals.A + totals.B + totals.C)
  const I = round(totals.E + totals.F + totals.G + totals.H)
  const J = round(D + I)
  const closingCosts = round(J - s.lenderCredit)

  const p = f.payment
  const paymentLines: AmountLine[] = [
    { label: 'Principal and interest', amount: p.principalAndInterest },
    ...(p.mi ? [{ label: 'Mortgage insurance', amount: p.mi }] : []),
    { label: 'Property taxes', amount: p.taxes },
    { label: "Homeowner's insurance", amount: p.hoi },
    ...(p.supplemental ? [{ label: 'Other insurance', amount: p.supplemental }] : []),
    ...(p.hoa ? [{ label: 'HOA dues', amount: p.hoa }] : []),
    ...(p.otherFinancing ? [{ label: 'Other mortgage payments', amount: p.otherFinancing }] : []),
    ...(p.other ? [{ label: s.otherPaymentLabel || 'Other', amount: p.other }] : []),
  ].map((l) => ({ ...l, amount: round(l.amount) }))

  const cashLines: AmountLine[] = isPurchase
    ? [
        { label: 'Purchase price', amount: s.purchasePrice ?? 0 },
        { label: 'Loan amount', amount: f.totalLoanAmount, negative: true },
        { label: 'Closing costs after lender credits', amount: closingCosts },
        ...(input.earnestMoney ? [{ label: 'Earnest money already paid', amount: input.earnestMoney, negative: true }] : []),
        ...(input.sellerCredits ? [{ label: 'Seller credits', amount: input.sellerCredits, negative: true }] : []),
      ]
    : [
        { label: 'Loan amount', amount: f.totalLoanAmount },
        { label: 'Closing costs after lender credits', amount: closingCosts, negative: true },
        ...(input.payoffs ? [{ label: 'Mortgages paid off', amount: input.payoffs, negative: true }] : []),
      ]
  const proceeds = input.cash.label === 'Cash to borrower'

  return {
    number: worksheetNumber(input.scenarioId, input.preparedAt),
    preparedAt: preparedLabel(input.preparedAt),
    borrowers: joinNames(input.borrowerNames),
    facts: [
      { label: 'Loan purpose', value: purposeLabel(purpose) },
      { label: isPurchase ? 'Purchase price' : 'Estimated value', value: formatCurrency(isPurchase ? s.purchasePrice : value) },
      { label: 'Loan amount', value: f.financedFee ? `${formatCurrency(f.totalLoanAmount)} (incl. ${formatCurrency(f.financedFee)} financed fee)` : formatCurrency(f.totalLoanAmount) },
      { label: 'Product', value: productLabel(s) || '—' },
      { label: 'Rate / points', value: `${s.noteRate == null ? '—' : formatPercent(s.noteRate, 3)} / ${s.pointsPct.toFixed(3)}%` },
      { label: 'LTV / CLTV', value: `${formatPercent(f.ltvPct, 2)} / ${formatPercent(cltvPct, 2)}` },
      { label: 'Property', value: [propertyType, labelOf(OCCUPANCY_OPTIONS, input.occupancy)].filter(Boolean).join(' · ') || '—' },
      { label: 'Location', value: place || 'To be determined' },
      { label: 'Escrows / lock', value: `${ESCROWS[s.impoundWaiver]} · ${s.lockDays ? `${s.lockDays}-day lock` : 'lock not set'}` },
    ],
    loanCosts: (['A', 'B', 'C'] as const).map((x) => section(x, input.lines, totals)),
    otherCosts: (['E', 'F', 'G', 'H'] as const).map((x) => section(x, input.lines, totals)),
    totals: { D, I, J, lenderCredits: round(s.lenderCredit) },
    payment: { lines: paymentLines, total: f.pitia },
    cash: { title: proceeds ? 'Estimated cash to you' : 'Estimated cash to close', lines: cashLines, total: input.cash.amount },
  }
}

/** What a scenario needs before it can go to a borrower (without them the payment prints as $0). Quotes bring their own rate, so the comparison skips it. */
export function missingForBorrowerPdf(s: Pick<ScenarioDraft, 'mortgageType' | 'termMonths' | 'noteRate' | 'loanAmount' | 'purchasePrice' | 'propertyValue'>, purpose: LoanPurpose, needsRate = true): string[] {
  return [
    ...(s.mortgageType ? [] : ['loan type']),
    ...(s.termMonths ? [] : ['term']),
    ...(needsRate && s.noteRate == null ? ['rate'] : []),
    ...(s.loanAmount ? [] : ['loan amount']),
    ...(purpose === 'purchase' ? (s.purchasePrice ? [] : ['purchase price']) : s.propertyValue ? [] : ['value']),
  ]
}

/** "Fee Worksheet - Marcus Reed - 2026-10-27.pdf" (no characters storage paths dislike). */
export function worksheetFileName(kind: string, borrowers: string, preparedAt: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(preparedAt))
  const who = borrowers.replace(/[^\w .'-]+/g, '').trim()
  return `${[kind, who, day].filter(Boolean).join(' - ')}.pdf`
}
