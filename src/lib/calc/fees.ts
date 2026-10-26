// The fee worksheet math: fees from the company's fee list, prepaids,
// escrows, section totals and cash to close. Pure functions; the Fees
// screen and the PDF show what they return. Rates are percents (7.625).

import { monthlyInterestOnly, monthlyPrincipalAndInterest } from './payment'
import { round } from './round'

export type FeeSection = 'A' | 'B' | 'C' | 'E' | 'F' | 'G' | 'H'
export type PaidBy = 'B' | 'S' | 'L' | 'O'
export type ImpoundWaiver = 'none' | 'taxes' | 'insurance' | 'all'

/** Prepaid interest uses a 360-day year (Connor's choice, 2026-10-26). */
export const INTEREST_DAYS_IN_YEAR = 360

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const at = (iso: string) => new Date(`${iso}T12:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Days of interest paid at closing: from the funding (or closing) date through the end of that month, both days counted. */
export function prepaidInterestDays(fromDate: string): number {
  const d = at(fromDate)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).getUTCDate()
  return lastDay - d.getUTCDate() + 1
}

/** The usual first payment: the 1st of the second month after funding (funds Oct 26 → first payment Dec 1). */
export function firstPaymentDateFor(fromDate: string): string {
  const d = at(fromDate)
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 1, 12)))
}

export function prepaidInterest(loanAmount: number, ratePct: number, days: number): number {
  if (loanAmount <= 0 || ratePct <= 0 || days <= 0) return 0
  return round(((loanAmount * ratePct) / 100 / INTEREST_DAYS_IN_YEAR) * days)
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** Points in dollars from a percent of the loan amount. */
export const pointsAmount = (pct: number, loanAmount: number) => round((loanAmount * pct) / 100)
/** Points as a percent (3 decimals) from dollars. */
export const pointsPct = (amount: number, loanAmount: number) => (loanAmount > 0 ? round((amount / loanAmount) * 100, 3) : 0)

// ---------------------------------------------------------------------------
// Monthly payment (PITIA)
// ---------------------------------------------------------------------------

export type Factor = 'monthly' | 'annual' | 'pct_of_value'

/** A value entered as monthly, annual or % of value, as a monthly amount. */
export function toMonthly(value: number | null, factor: Factor, propertyValue: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0
  if (factor === 'monthly') return round(value)
  if (factor === 'annual') return round(value / 12)
  return propertyValue ? round((propertyValue * value) / 100 / 12) : 0
}

export interface PaymentLines {
  principalAndInterest: number
  otherFinancing: number
  hoi: number
  supplemental: number
  taxes: number
  mi: number
  hoa: number
  other: number
}

export function firstMortgagePayment(loanAmount: number, ratePct: number, termMonths: number, interestOnly: boolean): number {
  return interestOnly ? monthlyInterestOnly(loanAmount, ratePct) : monthlyPrincipalAndInterest(loanAmount, ratePct, termMonths)
}

export const totalPitia = (p: PaymentLines) => round(p.principalAndInterest + p.otherFinancing + p.hoi + p.supplemental + p.taxes + p.mi + p.hoa + p.other)

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export type AmountType = 'fixed' | 'pct_loan' | 'pct_value'

/** One line of the company fee list (Settings). */
export interface FeeTemplate {
  key: string
  section: 'A' | 'B' | 'C' | 'E' | 'H'
  name: string
  amountType: AmountType
  amount: number
  /** Null = every purpose / loan type. */
  purposes: string[] | null
  mortgageTypes: string[] | null
  paidBy: PaidBy
  apr: boolean
  paidTo: string | null
  sortOrder: number
  active: boolean
}

/** What Connor changed on this file for one fee, or a fee he added. */
export interface FeeOverride {
  key: string
  section: FeeSection
  name: string
  atClosing: number | null
  beforeClosing: number | null
  paidBy: PaidBy
  apr: boolean
  paidTo: string | null
  custom: boolean
}

export interface FeeLine {
  key: string
  section: FeeSection
  name: string
  atClosing: number
  beforeClosing: number
  paidBy: PaidBy
  apr: boolean
  paidTo: string | null
  /** Edited on this file (shows the dot and the reset button). */
  edited: boolean
  custom: boolean
  /** What the engine would use without the edit (for reset). */
  calculated: number | null
}

export interface FeeContext {
  purpose: string
  mortgageType: string | null
  loanAmount: number
  propertyValue: number | null
  ratePct: number
  /** File-level settings. */
  pointsPct: number
  lenderCredit: number
  prepaidInterestDays: number
  /** Monthly HOI and taxes (from the payment card) and how many months are prepaid or reserved. */
  monthlyHoi: number
  monthlyTaxes: number
  monthlyMi: number
  hoiPrepaidMonths: number
  taxPrepaidMonths: number
  hoiReserveMonths: number
  taxReserveMonths: number
  miReserveMonths: number
  aggregateAdjustment: number
  impoundWaiver: ImpoundWaiver
}

const applies = (t: FeeTemplate, c: FeeContext) => t.active && (!t.purposes || t.purposes.includes(c.purpose)) && (!t.mortgageTypes || !c.mortgageType || t.mortgageTypes.includes(c.mortgageType))

export function templateAmount(t: FeeTemplate, c: FeeContext): number {
  if (t.amountType === 'pct_loan') return round((c.loanAmount * t.amount) / 100)
  if (t.amountType === 'pct_value') return c.propertyValue ? round((c.propertyValue * t.amount) / 100) : 0
  return round(t.amount)
}

/** The engine's own lines: points, fee list, prepaids and escrows (before any edits). */
export function calculatedLines(templates: FeeTemplate[], c: FeeContext): Omit<FeeLine, 'edited' | 'calculated'>[] {
  const line = (key: string, section: FeeSection, name: string, atClosing: number, paidBy: PaidBy = 'B', apr = false) => ({ key, section, name, atClosing: round(atClosing), beforeClosing: 0, paidBy, apr, paidTo: null, custom: false })
  const hoiWaived = c.impoundWaiver === 'all' || c.impoundWaiver === 'insurance'
  const taxWaived = c.impoundWaiver === 'all' || c.impoundWaiver === 'taxes'
  return [
    line('points', 'A', `${c.pointsPct.toFixed(3)}% of Loan Amount (Points)`, pointsAmount(c.pointsPct, c.loanAmount), 'B', true),
    ...templates
      .filter((t) => applies(t, c))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => ({ key: t.key, section: t.section as FeeSection, name: t.name, atClosing: templateAmount(t, c), beforeClosing: 0, paidBy: t.paidBy, apr: t.apr, paidTo: t.paidTo, custom: false })),
    line('prepaid_interest', 'F', `Prepaid interest (${c.prepaidInterestDays} days)`, prepaidInterest(c.loanAmount, c.ratePct, c.prepaidInterestDays), 'B', true),
    line('prepaid_hoi', 'F', `Homeowner's insurance (${c.hoiPrepaidMonths} months)`, c.monthlyHoi * c.hoiPrepaidMonths),
    line('prepaid_taxes', 'F', `Property taxes (${c.taxPrepaidMonths} months)`, c.monthlyTaxes * c.taxPrepaidMonths),
    line('escrow_hoi', 'G', `Homeowner's insurance (${c.hoiReserveMonths} months)`, hoiWaived ? 0 : c.monthlyHoi * c.hoiReserveMonths),
    line('escrow_taxes', 'G', `Property taxes (${c.taxReserveMonths} months)`, taxWaived ? 0 : c.monthlyTaxes * c.taxReserveMonths),
    line('escrow_mi', 'G', `Mortgage insurance (${c.miReserveMonths} months)`, c.monthlyMi * c.miReserveMonths),
    line('aggregate_adjustment', 'G', 'Aggregate adjustment', c.impoundWaiver === 'all' ? 0 : c.aggregateAdjustment),
  ]
}

/** The fee sheet: engine lines with this file's edits applied, plus custom fees, in section order. */
export function feeSheet(templates: FeeTemplate[], overrides: FeeOverride[], c: FeeContext): FeeLine[] {
  const byKey = new Map(overrides.map((o) => [o.key, o]))
  const lines: FeeLine[] = calculatedLines(templates, c).map((l) => {
    const o = byKey.get(l.key)
    if (!o) return { ...l, edited: false, calculated: l.atClosing }
    return { ...l, name: o.name || l.name, atClosing: o.atClosing ?? l.atClosing, beforeClosing: o.beforeClosing ?? 0, paidBy: o.paidBy, apr: o.apr, paidTo: o.paidTo, edited: true, calculated: l.atClosing }
  })
  for (const o of overrides.filter((x) => x.custom)) {
    lines.push({ key: o.key, section: o.section, name: o.name, atClosing: o.atClosing ?? 0, beforeClosing: o.beforeClosing ?? 0, paidBy: o.paidBy, apr: o.apr, paidTo: o.paidTo, edited: false, custom: true, calculated: null })
  }
  const order: FeeSection[] = ['A', 'B', 'C', 'E', 'F', 'G', 'H']
  return lines.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section))
}

export type SectionTotals = Record<FeeSection, number>

/** Totals of what the borrower pays, by section (seller-, lender- and other-paid fees don't count against the borrower). */
export function sectionTotals(lines: FeeLine[]): SectionTotals {
  const totals: SectionTotals = { A: 0, B: 0, C: 0, E: 0, F: 0, G: 0, H: 0 }
  for (const l of lines) if (l.paidBy === 'B') totals[l.section] = round(totals[l.section] + l.atClosing + l.beforeClosing)
  return totals
}

export function totalClosingCosts(totals: SectionTotals, lenderCredit: number): number {
  return round(totals.A + totals.B + totals.C + totals.E + totals.F + totals.G + totals.H - lenderCredit)
}

// ---------------------------------------------------------------------------
// Cash to close
// ---------------------------------------------------------------------------

export interface RefinanceCash {
  loanAmount: number
  closingCosts: number
  payoffs: number
}

/** Refinance: loan − closing costs − payoffs. Positive = cash to the borrower; negative = they bring it. */
export const cashToBorrower = (r: RefinanceCash) => round(r.loanAmount - r.closingCosts - r.payoffs)

export interface PurchaseCash {
  purchasePrice: number
  loanAmount: number
  closingCosts: number
  earnestMoney: number
  sellerCredits: number
}

/** Purchase: price − loan + closing costs − earnest money − seller credits (lender credits are already in closing costs). */
export const purchaseCashToClose = (p: PurchaseCash) => round(p.purchasePrice - p.loanAmount + p.closingCosts - p.earnestMoney - p.sellerCredits)
