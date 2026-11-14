// The fee worksheet math: fees from the company's fee list, prepaids,
// escrows, section totals and cash to close. Pure functions; the Fees
// screen and the PDF show what they return. Rates are percents (7.625).

import { cashToClose } from './cashToClose'
import { monthlyInterestOnly, monthlyPrincipalAndInterest } from './payment'
import { round } from './round'
import { texasLenderPolicy, texasOwnerPolicy } from './texasTitle'

export type FeeSection = 'A' | 'B' | 'C' | 'E' | 'F' | 'G' | 'H'
export type PaidBy = 'B' | 'S' | 'L' | 'O'
export type ImpoundWaiver = 'none' | 'taxes' | 'insurance' | 'all'

/**
 * Title insurance when the fee list has no title policy that applies: a
 * percent of the loan amount (Connor, 2026-11-14: $650 per $100,000). It can
 * be split with the seller like any fee.
 */
export const TITLE_INSURANCE_PCT = 0.65

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

export type AmountType = 'fixed' | 'pct_loan' | 'pct_value' | 'tiered' | 'formula'

/** Named calculators a fee can use (Smart Fees). Prepaid interest and escrow reserves are always calculated by the engine. */
export type FeeFormula = 'title_owner_tx' | 'title_lender_tx' | 'ufmip' | 'va_funding_fee' | 'usda_guarantee'

export const FEE_FORMULA_LABEL: Record<FeeFormula, string> = {
  title_owner_tx: "Texas owner's title policy (TDI rate on the price)",
  title_lender_tx: "Texas lender's title policy (TDI rate; $100 with an owner's policy)",
  ufmip: 'FHA upfront MIP (financed)',
  va_funding_fee: 'VA funding fee (financed)',
  usda_guarantee: 'USDA guarantee fee (financed)',
}

/** A bracket table: the first bracket whose limit covers the loan amount (or price) gives the amount; null = no limit. */
export interface FeeTiers {
  basis: 'loan' | 'value'
  brackets: { upTo: number | null; amount: number }[]
}

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
  // Smart Fees "Applies when" (null or missing = any).
  states?: string[] | null
  /** County names, e.g. "Dallas" (matched without "County", any case). */
  counties?: string[] | null
  lenderId?: string | null
  /** Optional label for where the lender rule came from ("Lender: UWM"). */
  lenderName?: string | null
  minLoanAmount?: number | null
  maxLoanAmount?: number | null
  occupancies?: string[] | null
  tiers?: FeeTiers | null
  formula?: FeeFormula | null
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
  /** The seller's share of a borrower fee, in dollars (a split); null or missing = none. */
  sellerPaid?: number | null
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
  /** Where the amount came from ("Fee list: Appraisal (FHA)", "TDI rate · $385,000"). */
  source?: string
  /** The seller's share of a borrower fee (a split), never more than the fee. */
  sellerPaid?: number
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
  // Smart Fees (optional; missing = not known).
  state?: string | null
  county?: string | null
  /** The estimate's lender. Undefined = don't filter on lender (the rules were already picked for it). */
  lenderId?: string | null
  occupancy?: string | null
  /** Purchase price (an owner's title policy is issued on a purchase). */
  purchasePrice?: number | null
  /** Base loan (before a financed FHA/VA/USDA fee), for loan-amount ranges and tiers. */
  baseLoanAmount?: number
  /** The financed FHA/VA/USDA fee and its name, shown as a line that isn't paid in cash. */
  financedFee?: number
  financedFeeName?: string
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+county$/, '')

/** Does a fee-list rule apply to this loan? */
export function ruleApplies(t: FeeTemplate, c: FeeContext): boolean {
  const base = c.baseLoanAmount ?? c.loanAmount
  return (
    t.active &&
    (!t.purposes || t.purposes.includes(c.purpose)) &&
    (!t.mortgageTypes || !c.mortgageType || t.mortgageTypes.includes(c.mortgageType)) &&
    (!t.occupancies?.length || !c.occupancy || t.occupancies.includes(c.occupancy)) &&
    (!t.states?.length || (!!c.state && t.states.map((x) => x.toUpperCase()).includes(c.state.toUpperCase()))) &&
    (!t.counties?.length || (!!c.county && t.counties.map(norm).includes(norm(c.county)))) &&
    (t.minLoanAmount == null || base >= t.minLoanAmount) &&
    (t.maxLoanAmount == null || base <= t.maxLoanAmount) &&
    (!t.lenderId || c.lenderId === undefined || t.lenderId === c.lenderId)
  )
}

/** How specific a rule is: lender + county > lender > county > state > default. */
export function ruleRank(t: FeeTemplate): number {
  const lender = !!t.lenderId
  const county = !!t.counties?.length
  if (lender && county) return 4
  if (lender) return 3
  if (county) return 2
  if (t.states?.length) return 1
  return 0
}

/** One rule per fee: the most specific one that applies (ties go to the lower sort order). */
export function matchingRules(templates: FeeTemplate[], c: FeeContext): FeeTemplate[] {
  const best = new Map<string, FeeTemplate>()
  for (const t of templates) {
    if (!ruleApplies(t, c)) continue
    const have = best.get(t.key)
    // Same level: the narrower rule (loan amount, occupancy, loan type or purpose) wins, then the lower sort order.
    const narrow = (x: FeeTemplate) => [x.minLoanAmount != null || x.maxLoanAmount != null, !!x.occupancies?.length, !!x.mortgageTypes?.length, !!x.purposes?.length].filter(Boolean).length
    const better = !have || ruleRank(t) > ruleRank(have) || (ruleRank(t) === ruleRank(have) && (narrow(t) > narrow(have) || (narrow(t) === narrow(have) && t.sortOrder < have.sortOrder)))
    if (better) best.set(t.key, t)
  }
  return [...best.values()].sort((a, b) => a.sortOrder - b.sortOrder)
}

/** The amount from a bracket table. */
export function tieredAmount(tiers: FeeTiers, basisAmount: number): number {
  const sorted = [...tiers.brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
  return round((sorted.find((b) => b.upTo == null || basisAmount <= b.upTo) ?? sorted.at(-1))?.amount ?? 0)
}

function formulaAmount(f: FeeFormula, c: FeeContext): number {
  const price = c.purchasePrice ?? null
  switch (f) {
    case 'title_owner_tx':
      return c.purpose === 'purchase' && price ? texasOwnerPolicy(price) : 0
    case 'title_lender_tx':
      return texasLenderPolicy(c.loanAmount, c.purpose === 'purchase' ? price : null)
    case 'ufmip':
      return c.mortgageType === 'fha' ? (c.financedFee ?? 0) : 0
    case 'va_funding_fee':
      return c.mortgageType === 'va' ? (c.financedFee ?? 0) : 0
    case 'usda_guarantee':
      return c.mortgageType === 'usda_rural' ? (c.financedFee ?? 0) : 0
  }
}

export function templateAmount(t: FeeTemplate, c: FeeContext): number {
  if (t.amountType === 'pct_loan') return round((c.loanAmount * t.amount) / 100)
  if (t.amountType === 'pct_value') return c.propertyValue ? round((c.propertyValue * t.amount) / 100) : 0
  if (t.amountType === 'tiered' && t.tiers) return tieredAmount(t.tiers, t.tiers.basis === 'value' ? (c.propertyValue ?? 0) : (c.baseLoanAmount ?? c.loanAmount))
  if (t.amountType === 'formula' && t.formula) return formulaAmount(t.formula, c)
  return round(t.amount)
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const FORMULA_FINANCED = new Set<FeeFormula>(['ufmip', 'va_funding_fee', 'usda_guarantee'])

/** Where a fee-list rule's amount came from, for the hover. */
export function ruleSource(t: FeeTemplate, c: FeeContext): string {
  if (t.amountType === 'formula' && (t.formula === 'title_owner_tx' || t.formula === 'title_lender_tx')) {
    const on = t.formula === 'title_owner_tx' ? (c.purchasePrice ?? 0) : c.loanAmount
    return t.formula === 'title_lender_tx' && c.purpose === 'purchase' && c.purchasePrice && c.loanAmount <= c.purchasePrice ? 'TDI rate · simultaneous issue' : `TDI rate · ${money(on)}`
  }
  if (t.amountType === 'formula' && t.formula && FORMULA_FINANCED.has(t.formula)) return 'Calculated · financed'
  const when = [t.lenderId ? `Lender${t.lenderName ? `: ${t.lenderName}` : ''}` : null, t.counties?.length ? `County: ${t.counties.join(', ')}` : t.states?.length ? `State: ${t.states.join(', ')}` : null].filter(Boolean)
  return when.length ? when.join(' · ') : `Fee list${t.amountType === 'tiered' ? ' (tiered)' : ''}`
}

/**
 * A fee-list rule that is title insurance (then the built-in title insurance
 * line isn't added): a Texas title formula, or a fee named for title that
 * isn't a settlement, escrow, closing, search, exam, endorsement, courier,
 * wire or tax certificate fee.
 */
export const isTitlePolicyRule = (t: FeeTemplate) => {
  if (t.amountType === 'formula' && (t.formula === 'title_owner_tx' || t.formula === 'title_lender_tx')) return true
  const words = `${t.key} ${t.name}`.toLowerCase()
  return words.includes('title') && !/(settle|escrow|closing|search|exam|endorse|courier|wire|tax|notary|recording|cpl|protection letter)/.test(words)
}

/** The engine's own lines: points, fee list, prepaids and escrows (before any edits). */
export function calculatedLines(templates: FeeTemplate[], c: FeeContext): Omit<FeeLine, 'edited' | 'calculated'>[] {
  const line = (key: string, section: FeeSection, name: string, atClosing: number, paidBy: PaidBy = 'B', apr = false, source?: string) => ({ key, section, name, atClosing: round(atClosing), beforeClosing: 0, paidBy, apr, paidTo: null, custom: false, source })
  const hoiWaived = c.impoundWaiver === 'all' || c.impoundWaiver === 'insurance'
  const taxWaived = c.impoundWaiver === 'all' || c.impoundWaiver === 'taxes'
  const rules = matchingRules(templates, c)
  // A financed FHA/VA/USDA fee shows as its own line, paid by "Other" (the loan), so it isn't cash. A fee-list formula for it takes its place.
  const financedRule = rules.some((t) => t.amountType === 'formula' && t.formula && FORMULA_FINANCED.has(t.formula) && templateAmount(t, c) > 0)
  const titleRule = rules.some(isTitlePolicyRule)
  return [
    line('points', 'A', `${c.pointsPct.toFixed(3)}% of Loan Amount (Points)`, pointsAmount(c.pointsPct, c.loanAmount), 'B', true),
    ...(c.financedFee && !financedRule ? [line('financed_fee', 'B', c.financedFeeName ?? 'Upfront fee (financed)', c.financedFee, 'O', true, 'Calculated · financed into the loan')] : []),
    ...rules.map((t) => {
      const financed = t.amountType === 'formula' && !!t.formula && FORMULA_FINANCED.has(t.formula)
      return { key: t.key, section: t.section as FeeSection, name: t.name, atClosing: templateAmount(t, c), beforeClosing: 0, paidBy: financed ? ('O' as PaidBy) : t.paidBy, apr: t.apr, paidTo: t.paidTo, custom: false, source: ruleSource(t, c) }
    }),
    ...(titleRule || c.loanAmount <= 0 ? [] : [line('title_insurance', 'C', 'Title insurance', round((c.loanAmount * TITLE_INSURANCE_PCT) / 100), 'B', false, `${TITLE_INSURANCE_PCT}% of ${money(c.loanAmount)} loan`)]),
    line('prepaid_interest', 'F', `Prepaid interest (${c.prepaidInterestDays} days)`, prepaidInterest(c.loanAmount, c.ratePct, c.prepaidInterestDays), 'B', true, `${c.prepaidInterestDays} days · ${INTEREST_DAYS_IN_YEAR}-day year`),
    line('prepaid_hoi', 'F', `Homeowner's insurance (${c.hoiPrepaidMonths} months)`, c.monthlyHoi * c.hoiPrepaidMonths),
    line('prepaid_taxes', 'F', `Property taxes (${c.taxPrepaidMonths} months)`, c.monthlyTaxes * c.taxPrepaidMonths),
    line('escrow_hoi', 'G', `Homeowner's insurance (${c.hoiReserveMonths} months)`, hoiWaived ? 0 : c.monthlyHoi * c.hoiReserveMonths),
    line('escrow_taxes', 'G', `Property taxes (${c.taxReserveMonths} months)`, taxWaived ? 0 : c.monthlyTaxes * c.taxReserveMonths, 'B', false, c.county ? `${c.county} Co. · taxes due Jan 31` : 'Taxes due Jan 31'),
    line('escrow_mi', 'G', `Mortgage insurance (${c.miReserveMonths} months)`, c.monthlyMi * c.miReserveMonths),
    line('aggregate_adjustment', 'G', 'Aggregate adjustment', c.impoundWaiver === 'all' ? 0 : c.aggregateAdjustment),
  ]
}

/** Texas property taxes are due January 31 (paid from escrow in January). */
export const TX_TAX_DUE_MONTH = 1
/** The most RESPA allows as a cushion: two months of the yearly bill. */
export const ESCROW_CUSHION_MONTHS = 2

/**
 * Months of property taxes to collect at closing, from the first payment date
 * and the January 31 due date. The escrow pays the first January bill at
 * least two months after the first payment (an earlier one is the closing
 * year's bill, prorated with the seller at closing). Monthly deposits from the
 * first payment through that January cover part of the bill; the rest plus a
 * two-month cushion is collected up front.
 */
export function taxReserveMonths(firstPaymentIso: string): number {
  const d = at(firstPaymentIso)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  // First January bill on or after the first payment month, unless it's within 2 months.
  let dueYear = m <= TX_TAX_DUE_MONTH ? y : y + 1
  const monthsToDue = (dueYear - y) * 12 + (TX_TAX_DUE_MONTH - m)
  if (monthsToDue < 2) dueYear += 1
  const deposits = (dueYear - y) * 12 + (TX_TAX_DUE_MONTH - m) + 1
  return Math.min(Math.max(12 - deposits, 0) + ESCROW_CUSHION_MONTHS, 12 + ESCROW_CUSHION_MONTHS)
}

/** A split: the seller's share of a borrower fee, capped at the fee. */
function sellerShare(o: FeeOverride, amount: number): { sellerPaid?: number } {
  if (o.paidBy !== 'B' || !o.sellerPaid || o.sellerPaid <= 0) return {}
  return { sellerPaid: round(Math.min(o.sellerPaid, amount)) }
}

/** What the borrower pays of a line (all of it, less the seller's share of a split; nothing when someone else pays). */
export const borrowerPart = (l: Pick<FeeLine, 'paidBy' | 'atClosing' | 'beforeClosing' | 'sellerPaid'>) => (l.paidBy !== 'B' ? 0 : l.sellerPaid ? round(Math.max(l.atClosing + l.beforeClosing - l.sellerPaid, 0)) : round(l.atClosing + l.beforeClosing))

/** The fee sheet: engine lines with this file's edits applied, plus custom fees, in section order. */
export function feeSheet(templates: FeeTemplate[], overrides: FeeOverride[], c: FeeContext): FeeLine[] {
  const byKey = new Map(overrides.map((o) => [o.key, o]))
  const lines: FeeLine[] = calculatedLines(templates, c).map((l) => {
    const o = byKey.get(l.key)
    if (!o) return { ...l, edited: false, calculated: l.atClosing }
    const atClosing = o.atClosing ?? l.atClosing
    const beforeClosing = o.beforeClosing ?? 0
    return { ...l, name: o.name || l.name, atClosing, beforeClosing, paidBy: o.paidBy, apr: o.apr, paidTo: o.paidTo, edited: true, calculated: l.atClosing, ...sellerShare(o, atClosing + beforeClosing) }
  })
  for (const o of overrides.filter((x) => x.custom)) {
    lines.push({ key: o.key, section: o.section, name: o.name, atClosing: o.atClosing ?? 0, beforeClosing: o.beforeClosing ?? 0, paidBy: o.paidBy, apr: o.apr, paidTo: o.paidTo, edited: false, custom: true, calculated: null, ...sellerShare(o, (o.atClosing ?? 0) + (o.beforeClosing ?? 0)) })
  }
  const order: FeeSection[] = ['A', 'B', 'C', 'E', 'F', 'G', 'H']
  return lines.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section))
}

export type SectionTotals = Record<FeeSection, number>

/** Totals of what the borrower pays, by section (seller-, lender- and other-paid fees, and the seller's share of a split, don't count against the borrower). */
export function sectionTotals(lines: FeeLine[]): SectionTotals {
  const totals: SectionTotals = { A: 0, B: 0, C: 0, E: 0, F: 0, G: 0, H: 0 }
  for (const l of lines) if (l.paidBy === 'B') totals[l.section] = round(totals[l.section] + borrowerPart(l))
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
export const cashToBorrower = (r: RefinanceCash) => -cashToClose({ isPurchase: false, purchasePrice: null, baseLoanAmount: r.loanAmount, closingCosts: r.closingCosts, mortgagePayoffs: r.payoffs }).cashToClose

export interface PurchaseCash {
  purchasePrice: number
  loanAmount: number
  closingCosts: number
  earnestMoney: number
  sellerCredits: number
}

/** Purchase: price − loan + closing costs − earnest money − seller credits (lender credits are already in closing costs). */
export const purchaseCashToClose = (p: PurchaseCash) =>
  cashToClose({ isPurchase: true, purchasePrice: p.purchasePrice, baseLoanAmount: p.loanAmount, closingCosts: p.closingCosts, earnestMoney: p.earnestMoney, sellerCredits: p.sellerCredits }).cashToClose
