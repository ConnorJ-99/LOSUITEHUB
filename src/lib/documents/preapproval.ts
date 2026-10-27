// Pre-approval letters (Letters tab, template preapproval-letter.hbs): the
// first "up to" letter from the file, new versions for an offer on a home,
// the checks against the approved maximum on the loan, and what the PDF
// shows. Pure.

import { pct, round } from '@/lib/calc'
import type { AmortizationType, MortgageType, Occupancy } from '@/lib/api/types'
import { MORTGAGE_TYPE_OPTIONS, OCCUPANCY_OPTIONS } from '@/components/profile/options'
import { formatCurrency, formatPercent } from '@/lib/format'
import { formatIsoDate } from '@/lib/dates'
import { joinNames } from './feeWorksheet'

export const PREAPPROVAL_TEMPLATE = 'preapproval-letter v1'
/** A new letter expires this many days after it's issued (Connor, 2026-10-27). */
export const PREAPPROVAL_DAYS = 90

/** The approved maximum on the loan: every letter is checked against it. */
export interface ApprovedMax {
  maxPrice: number | null
  maxLoanAmount: number | null
  expiresOn: string | null
}

export interface LetterDraft {
  propertyId: string | null
  /** One line, e.g. "100 Main St, Frisco, TX 75034"; null = an "up to" letter. */
  propertyAddress: string | null
  purchasePrice: number | null
  loanAmount: number | null
  mortgageType: MortgageType | null
  termMonths: number | null
  amortizationType: AmortizationType
  occupancy: Occupancy
  sellerCredits: number | null
  earnestMoney: number | null
  showSellerCredits: boolean
  showEarnestMoney: boolean
  showDownPayment: boolean
  reviewed: string[]
  extraConditions: string[]
  issuedOn: string
  expiresOn: string
}

export interface SavedLetter extends LetterDraft {
  id: string
  referenceNumber: string
  version: number
  documentId: string | null
  createdAt: string
}

/** The four conditions on every letter (template wording). */
export const STANDARD_CONDITIONS = [
  'a satisfactory appraisal and an eligible property;',
  "clear and marketable title and acceptable homeowner's insurance;",
  'final underwriting review and approval;',
  'no material change in your income, employment, assets, debts or credit before closing.',
]

/** "What we have reviewed" choices, in the order shown. */
export const REVIEWED_OPTIONS = ['Credit report', 'Pay stubs', 'W-2s', 'Tax returns', 'Bank statements', 'Investment or retirement statements', 'Award letters', 'Verification of employment'] as const

const REVIEWED_FROM_KIND: Record<string, (typeof REVIEWED_OPTIONS)[number]> = {
  paystub: 'Pay stubs',
  w2: 'W-2s',
  tax_return: 'Tax returns',
  business_return: 'Tax returns',
  bank_statement: 'Bank statements',
  investment_statement: 'Investment or retirement statements',
  award_letter: 'Award letters',
}

/** What the letter says was reviewed: the credit report, plus each kind of document on file. */
export function reviewedFromFile(documentKinds: string[]): string[] {
  const found = new Set<string>(['Credit report', ...documentKinds.map((k) => REVIEWED_FROM_KIND[k]).filter(Boolean)])
  return REVIEWED_OPTIONS.filter((o) => found.has(o))
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "PA-20261027-3F9A": the date and the loan. One per pre-approval; versions share it. */
export function newReference(loanId: string, issuedOn: string): string {
  return `PA-${issuedOn.replaceAll('-', '')}-${loanId.replace(/-/g, '').slice(0, 4).toUpperCase()}`
}

/** The next version under a reference (v1 for a new one). */
export function nextVersion(letters: Pick<SavedLetter, 'referenceNumber' | 'version'>[], referenceNumber: string): number {
  return Math.max(0, ...letters.filter((l) => l.referenceNumber === referenceNumber).map((l) => l.version)) + 1
}

export interface LetterFile {
  mortgageType: MortgageType | null
  termMonths: number | null
  amortizationType: AmortizationType
  occupancy: Occupancy
  purchasePrice: number | null
  loanAmount: number | null
  sellerCredits: number | null
  earnestMoney: number
  documentKinds: string[]
}

/** The first letter: "up to" the approved maximum, terms from the loan. */
export function firstLetter(file: LetterFile, max: ApprovedMax, today: string): LetterDraft {
  return {
    propertyId: null,
    propertyAddress: null,
    purchasePrice: max.maxPrice ?? file.purchasePrice,
    loanAmount: max.maxLoanAmount ?? file.loanAmount,
    mortgageType: file.mortgageType,
    termMonths: file.termMonths ?? 360,
    amortizationType: file.amortizationType,
    occupancy: file.occupancy,
    sellerCredits: file.sellerCredits,
    earnestMoney: file.earnestMoney || null,
    showSellerCredits: false,
    showEarnestMoney: false,
    showDownPayment: false,
    reviewed: reviewedFromFile(file.documentKinds),
    extraConditions: [],
    issuedOn: today,
    expiresOn: defaultExpiry(max, today),
  }
}

/** 90 days out, but never after the approval itself expires. */
function defaultExpiry(max: ApprovedMax, today: string): string {
  const days = addDays(today, PREAPPROVAL_DAYS)
  return max.expiresOn && max.expiresOn < days ? max.expiresOn : days
}

/** A new version for an offer: the same terms, this home's address and the offer price, keeping the same down payment percent (and never over the maximum loan). */
export function offerLetter(base: LetterDraft, home: { id: string; address: string; price: number | null }, max: ApprovedMax, today: string): LetterDraft {
  const price = home.price ?? base.purchasePrice
  const keepPercent = price && base.purchasePrice && base.loanAmount ? round((price * base.loanAmount) / base.purchasePrice, 0) : base.loanAmount
  const loanAmount = keepPercent != null && max.maxLoanAmount != null ? Math.min(keepPercent, max.maxLoanAmount) : keepPercent
  return { ...base, propertyId: home.id, propertyAddress: home.address, purchasePrice: price, loanAmount, issuedOn: today, expiresOn: defaultExpiry(max, today) }
}

/** Why the letter can't be issued yet, in plain words. Empty = ready. */
export function letterProblems(d: LetterDraft, max: ApprovedMax, today: string): string[] {
  const problems: string[] = []
  if (max.maxPrice == null || max.maxLoanAmount == null) problems.push('Set the approved maximum price and loan amount first.')
  const missing = [...(d.purchasePrice ? [] : ['purchase price']), ...(d.loanAmount ? [] : ['loan amount']), ...(d.mortgageType ? [] : ['loan type']), ...(d.termMonths ? [] : ['term'])]
  if (missing.length) problems.push(`Fill in the ${joinNames(missing)}.`)
  if (d.purchasePrice && d.loanAmount && d.loanAmount > d.purchasePrice) problems.push('The loan amount is more than the price.')
  if (max.maxPrice != null && d.purchasePrice && d.purchasePrice > max.maxPrice)
    problems.push(`The price is ${formatCurrency(d.purchasePrice - max.maxPrice)} over the approved maximum of ${formatCurrency(max.maxPrice)}.`)
  if (max.maxLoanAmount != null && d.loanAmount && d.loanAmount > max.maxLoanAmount)
    problems.push(`The loan amount is ${formatCurrency(d.loanAmount - max.maxLoanAmount)} over the approved maximum of ${formatCurrency(max.maxLoanAmount)}.`)
  if (max.expiresOn && max.expiresOn < today) problems.push(`The pre-approval expired on ${formatIsoDate(max.expiresOn)}. Update the approved maximum to issue new letters.`)
  if (d.expiresOn < d.issuedOn) problems.push('The letter expires before it is issued.')
  else if (max.expiresOn && d.expiresOn > max.expiresOn) problems.push(`The letter can't expire after the pre-approval does (${formatIsoDate(max.expiresOn)}).`)
  return problems
}

/** What the PDF shows. */
export interface LetterView {
  referenceNumber: string
  version: number
  issuedOn: string
  expiresOn: string
  borrowers: string
  greeting: string
  property: string
  terms: { label: string; value: string }[]
  reviewed: string[]
  conditions: string[]
}

const labelOf = <T extends string>(options: readonly { value: T; label: string }[], value: T | null) => options.find((o) => o.value === value)?.label ?? '—'

/** "Dear Marcus and Dana," from full names. */
export function greeting(names: string[]): string {
  const first = names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean)
  return first.length ? `Dear ${joinNames(first)}` : 'Hello'
}

export function letterView(d: LetterDraft, referenceNumber: string, version: number, borrowerNames: string[], place: string | null): LetterView {
  const price = d.purchasePrice ?? 0
  const loan = d.loanAmount ?? 0
  const years = d.termMonths ? (d.termMonths % 12 === 0 ? `${d.termMonths / 12}-year` : `${d.termMonths}-month`) : ''
  return {
    referenceNumber,
    version,
    issuedOn: formatIsoDate(d.issuedOn),
    expiresOn: formatIsoDate(d.expiresOn),
    borrowers: joinNames(borrowerNames),
    greeting: greeting(borrowerNames),
    property: d.propertyAddress ?? (place ? `${place} (to be determined)` : 'To be determined'),
    terms: [
      { label: d.propertyAddress ? 'Purchase price' : 'Purchase price up to', value: formatCurrency(price) },
      { label: 'Loan amount up to', value: formatCurrency(loan) },
      { label: 'Financing', value: `${formatPercent(pct(loan, price), 2)} of price` },
      { label: 'Loan type', value: labelOf(MORTGAGE_TYPE_OPTIONS, d.mortgageType) },
      { label: 'Term', value: `${years} ${d.amortizationType === 'arm' ? 'ARM' : 'fixed'}`.trim() },
      { label: 'Occupancy', value: labelOf(OCCUPANCY_OPTIONS, d.occupancy) },
      ...(d.showSellerCredits && d.sellerCredits ? [{ label: 'Seller credits', value: formatCurrency(d.sellerCredits) }] : []),
      ...(d.showEarnestMoney && d.earnestMoney ? [{ label: 'Earnest money', value: formatCurrency(d.earnestMoney) }] : []),
      ...(d.showDownPayment ? [{ label: 'Down payment', value: formatCurrency(round(price - loan)) }] : []),
    ],
    reviewed: d.reviewed,
    conditions: [...STANDARD_CONDITIONS, ...d.extraConditions.map((c) => c.trim()).filter(Boolean)],
  }
}
