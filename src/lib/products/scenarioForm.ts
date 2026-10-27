// The search form's scenario: a blank search, a search pre-filled from a
// borrower file, down payment as % or $, and the chips that describe it.
// Pre-filling never changes the file.

import { round } from '@/lib/calc'
import type { CreditEvent } from '@/lib/api/creditEvents'
import type { LoanProfile, MortgageType, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { formatCurrency, formatPercent } from '@/lib/format'
import { applicationSummary } from '@/lib/urla/summary'
import { purchasePriceOf, ratios } from './engine'
import { citizenshipFor, DOC_TYPES, docTypeFor, FEATURES, LIENS, lienFor, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, matrixPropertyTypeFor, matrixPurposeFor, OCCUPANCIES, PRODUCT_FAMILIES, type ProductFamily } from './taxonomy'
import type { Scenario } from './types'

export function blankScenario(): Scenario {
  return {
    lien: 'first',
    family: 'conventional',
    docType: 'full_doc',
    features: [],
    purpose: 'purchase',
    occupancy: 'primary',
    propertyType: 'sfr_pud',
    units: 1,
    state: 'TX',
    county: null,
    purchasePrice: null,
    value: 0,
    loanAmount: 0,
    firstLienBalance: 0,
    fico: null,
    dti: null,
    reservesMonths: null,
    dscr: null,
    citizenship: 'us_citizen',
    mortgageLates12: null,
    mortgageLates24: null,
    bkSeasoningMonths: null,
    fcSeasoningMonths: null,
    selfEmployedYears: null,
    firstTimeBuyer: false,
    incomeVsAmiPct: null,
    homestead: false,
  }
}

const FAMILY_FOR: Record<MortgageType, ProductFamily | 'any'> = { conventional: 'conventional', fha: 'fha', va: 'va', usda_rural: 'usda', other: 'any' }

/** Whole months from one ISO date to another. */
const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T12:00:00Z`)
  const b = new Date(`${to}T12:00:00Z`)
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0))
}

/** Months since the latest event of these types; null = none; 'unknown' = one with no date. */
function seasoning(events: CreditEvent[], types: CreditEvent['eventType'][], today: string): number | 'unknown' | null {
  const hits = events.filter((e) => types.includes(e.eventType))
  if (hits.length === 0) return null
  if (hits.some((e) => !e.eventDate)) return 'unknown'
  return Math.min(...hits.map((e) => monthsBetween(e.eventDate!, today)))
}

/** Mortgage lates of 30+ days within N months; null when a mortgage late has no date. */
function mortgageLates(events: CreditEvent[], months: number, today: string): number | null {
  const lates = events.filter((e) => e.eventType === 'late_payment' && e.isMortgage)
  if (lates.some((e) => !e.eventDate)) return null
  return lates.filter((e) => monthsBetween(e.eventDate!, today) < months).length
}

export interface FileInput {
  loan: LoanProfile
  app: Application
  properties: Property[]
  creditEvents: CreditEvent[]
  /** YYYY-MM-DD. */
  today: string
}

/** A search pre-filled from the borrower file (the file itself is never changed here). */
export function scenarioFromFile({ loan, app, properties, creditEvents, today }: FileInput): Scenario {
  const d = loan.details
  const subject = properties.find((p) => p.id === d.subjectPropertyId) ?? null
  const lien = lienFor(loan.purpose)
  const docType = loan.purpose === 'investment_dscr' && !d.incomeDocType ? 'dscr' : docTypeFor(d.incomeDocType)
  const nonQm = docType !== 'full_doc' && docType !== 'wvoe'
  const family: Scenario['family'] = nonQm ? 'non_qm' : d.mortgageType ? FAMILY_FOR[d.mortgageType] : lien === 'first' ? 'conventional' : 'any'
  const summary = applicationSummary(loan, app, properties)
  const scores = app.borrowers.map((b) => b.estimatedCreditScore).filter((s): s is number => s != null)
  const primary = app.borrowers[0]
  const first = subject?.liens.find((l) => l.position === 'first')
  const price = loan.purpose === 'purchase' ? d.purchasePrice : null
  return {
    ...blankScenario(),
    lien,
    family,
    docType,
    purpose: matrixPurposeFor(loan.purpose),
    occupancy: d.occupancy,
    propertyType: matrixPropertyTypeFor(subject?.propertyType ?? null, subject?.unitCount ?? null) ?? 'sfr_pud',
    units: subject?.unitCount ?? 1,
    state: subject?.state ?? 'TX',
    county: subject?.county ?? null,
    purchasePrice: price,
    value: subject?.estimatedValue ?? price ?? subject?.listPrice ?? 0,
    loanAmount: d.loanAmount ?? 0,
    firstLienBalance: lien === 'first' ? 0 : (first?.balance ?? 0),
    fico: scores.length ? Math.min(...scores) : null,
    dti: summary.qualifying.dti.back != null ? round(summary.qualifying.dti.back, 2) : null,
    citizenship: citizenshipFor(primary?.person.citizenship ?? null),
    mortgageLates12: mortgageLates(creditEvents, 12, today),
    mortgageLates24: mortgageLates(creditEvents, 24, today),
    bkSeasoningMonths: seasoning(creditEvents, ['bankruptcy_ch7', 'bankruptcy_ch13'], today),
    fcSeasoningMonths: seasoning(creditEvents, ['foreclosure', 'short_sale', 'deed_in_lieu'], today),
    firstTimeBuyer: loan.purpose === 'purchase' && app.borrowers.some((b) => b.declarations.ownedPropertyPast3Years === false),
    homestead: subject?.isHomestead ?? (d.occupancy === 'primary' && loan.purpose !== 'purchase'),
  }
}

// ---------------------------------------------------------------------------
// Down payment
// ---------------------------------------------------------------------------

export function downPayment(s: Scenario): { amount: number; pct: number } | null {
  const price = purchasePriceOf(s)
  if (!price) return null
  const amount = round(price - s.loanAmount)
  return { amount, pct: round((amount / price) * 100, 3) }
}

/** New price, keeping the same down payment percent (5% stays 5%). */
export function withPrice(s: Scenario, price: number | null): Scenario {
  const pct = downPayment(s)?.pct ?? 5
  if (!price) return { ...s, purchasePrice: price }
  const valueFollows = !s.value || s.value === s.purchasePrice
  return { ...s, purchasePrice: price, value: valueFollows ? price : s.value, loanAmount: round(price * (1 - pct / 100)) }
}

export const withDownPct = (s: Scenario, pct: number): Scenario => (s.purchasePrice ? { ...s, loanAmount: round(s.purchasePrice * (1 - pct / 100)) } : s)
export const withDownAmount = (s: Scenario, amount: number): Scenario => (s.purchasePrice ? { ...s, loanAmount: round(s.purchasePrice - amount) } : s)

// ---------------------------------------------------------------------------
// Describing a search
// ---------------------------------------------------------------------------

/** The loan type chips: "1st lien", "Conventional", "Full doc", and any must-haves. */
export function typeChips(s: Scenario): string[] {
  return [LIENS.label[s.lien], s.family === 'any' ? 'Any product' : PRODUCT_FAMILIES.label[s.family], DOC_TYPES.label[s.docType], ...s.features.map((f) => FEATURES.label[f])]
}

/** The scenario chips, as in the results bar. */
export function scenarioChips(s: Scenario): string[] {
  const { ltv, cltv } = ratios(s)
  const down = downPayment(s)
  const chips = [
    MATRIX_PURPOSES.label[s.purpose],
    OCCUPANCIES.label[s.occupancy],
    s.units > 1 ? `${s.units} units` : MATRIX_PROPERTY_TYPES.label[s.propertyType],
    s.county ? `${s.county}, ${s.state}` : s.state,
  ]
  if (down) chips.push(formatCurrency(s.purchasePrice), `${formatPercent(down.pct, 2)} down`)
  else chips.push(`Value ${formatCurrency(s.value)}`)
  if (s.lien !== 'first') chips.push(`1st lien ${formatCurrency(s.firstLienBalance)}`, `${s.lien === 'heloc' ? 'HELOC' : '2nd'} ${formatCurrency(s.loanAmount)}`, `CLTV ${formatPercent(cltv, 2)}`)
  else chips.push(formatCurrency(s.loanAmount), `LTV ${formatPercent(ltv, 2)}`)
  if (s.fico != null) chips.push(`${s.fico} FICO`)
  if (s.dti != null) chips.push(`DTI ${formatPercent(s.dti, 2)}`)
  if (s.dscr != null) chips.push(`DSCR ${s.dscr.toFixed(2)}`)
  if (s.firstTimeBuyer) chips.push('First-time buyer')
  if (s.homestead && s.state === 'TX') chips.push('Homestead')
  return chips
}

/** A one-line label for Recent searches: "Closed-end 2nd · Non-QM · 4 units · 704 · CLTV 67.19%". */
export function scenarioLabel(s: Scenario): string {
  const { ltv, cltv } = ratios(s)
  const parts = [LIENS.label[s.lien], s.family === 'any' ? 'Any' : PRODUCT_FAMILIES.label[s.family], DOC_TYPES.label[s.docType]]
  parts.push(s.units > 1 ? `${s.units} units` : OCCUPANCIES.label[s.occupancy])
  if (s.fico != null) parts.push(String(s.fico))
  parts.push(s.lien === 'first' ? `LTV ${formatPercent(ltv, 2)}` : `CLTV ${formatPercent(cltv, 2)}`)
  return parts.join(' · ')
}
