// Pricing scenarios: saved what-if options on one file (Pricing tab). A
// scenario starts from the loan, or from one of its homes ("Push to pricer"),
// and "Use for this loan" copies its numbers back into the loan and the home,
// which stay the one source of truth. Pure functions; the math is in
// '@/lib/calc'.

import {
  feeSheet,
  firstMortgagePayment,
  mortgageInsurance,
  pct,
  pointsAmount,
  pointsPct,
  prepaidInterestDays,
  round,
  sectionTotals,
  toMonthly,
  totalClosingCosts,
  totalPitia,
  type Factor,
  type FeeContext,
  type FeeOverride,
  type FeeTemplate,
  type PaymentLines,
} from '@/lib/calc'
import type { AmortizationType, Buydown, ImpoundWaiver, LoanDetails, MortgageType, Property } from '@/lib/api/types'
import type { LoanPurpose } from '@/lib/pipeline/stages'

export interface PricingScenario {
  id: string
  loanId: string
  propertyId: string | null
  name: string
  lenderName: string | null
  programName: string | null
  mortgageType: MortgageType | null
  amortizationType: AmortizationType
  interestOnly: boolean
  termMonths: number | null
  noteRate: number | null
  qualifyingRate: number | null
  buydown: Buydown | null
  lockDays: number | null
  /** Base loan amount (before any financed FHA/VA/USDA fee). */
  loanAmount: number | null
  purchasePrice: number | null
  propertyValue: number | null
  /** Typed in the unit the factor says (annual dollars, monthly dollars or % of value). */
  taxesValue: number | null
  taxesFactor: Factor
  insuranceValue: number | null
  insuranceFactor: Factor
  supplementalInsuranceMonthly: number | null
  monthlyHoa: number | null
  /** Null = calculated from the loan type and LTV. */
  monthlyMi: number | null
  otherPaymentMonthly: number | null
  otherPaymentLabel: string | null
  impoundWaiver: ImpoundWaiver
  estimatedFundingDate: string | null
  firstPaymentDate: string | null
  pointsPct: number
  lenderCredit: number
  /** Null = from the funding date. */
  prepaidInterestDays: number | null
  /** Null = the default for the loan purpose. */
  hoiPrepaidMonths: number | null
  taxPrepaidMonths: number | null
  hoiReserveMonths: number | null
  taxReserveMonths: number | null
  miReserveMonths: number | null
  aggregateAdjustment: number
  notes: string | null
}

export type ScenarioDraft = Omit<PricingScenario, 'id'>

/** The loan as the Pricing tab needs it. */
export interface PricingLoan {
  id: string
  purpose: LoanPurpose
  details: LoanDetails
}

const isPurchase = (purpose: LoanPurpose) => purpose === 'purchase'

/** A new scenario from the loan, or from one of its homes. */
export function scenarioFrom(loan: PricingLoan, property: Property | null, name: string): ScenarioDraft {
  const d = loan.details
  const purchase = isPurchase(loan.purpose)
  const isSubject = !property || property.id === d.subjectPropertyId
  const price = purchase ? (isSubject ? (d.purchasePrice ?? property?.listPrice ?? null) : (property!.listPrice ?? d.purchasePrice)) : null
  const value = property?.estimatedValue ?? price
  // Another house keeps the same down payment percent.
  const loanAmount =
    !isSubject && purchase && price && d.loanAmount && d.purchasePrice ? round((price * d.loanAmount) / d.purchasePrice, 0) : d.loanAmount
  const taxes: [number | null, Factor] =
    property?.annualTaxes != null ? [property.annualTaxes, 'annual'] : d.estimatedTaxRatePct != null ? [d.estimatedTaxRatePct, 'pct_of_value'] : [null, 'annual']
  return {
    loanId: loan.id,
    propertyId: property?.id ?? null,
    name,
    lenderName: null,
    programName: null,
    mortgageType: d.mortgageType,
    amortizationType: d.amortizationType,
    interestOnly: d.hasInterestOnly,
    termMonths: d.termMonths,
    noteRate: d.noteRate,
    qualifyingRate: d.qualifyingRate,
    buydown: d.buydown,
    lockDays: null,
    loanAmount,
    purchasePrice: price,
    propertyValue: value,
    taxesValue: taxes[0],
    taxesFactor: taxes[1],
    insuranceValue: property?.annualInsurance ?? d.estimatedAnnualInsurance,
    insuranceFactor: 'annual',
    supplementalInsuranceMonthly: d.supplementalInsuranceMonthly,
    monthlyHoa: property?.monthlyHoa ?? d.estimatedMonthlyHoa,
    monthlyMi: null,
    otherPaymentMonthly: d.otherPaymentMonthly,
    otherPaymentLabel: d.otherPaymentLabel,
    impoundWaiver: d.impoundWaiver,
    estimatedFundingDate: d.estimatedFundingDate ?? d.closingDate,
    firstPaymentDate: d.firstPaymentDate,
    pointsPct: d.discountPointsAmount && d.loanAmount ? pointsPct(d.discountPointsAmount, d.loanAmount) : 0,
    lenderCredit: d.lenderCredits ?? 0,
    prepaidInterestDays: null,
    hoiPrepaidMonths: null,
    taxPrepaidMonths: null,
    hoiReserveMonths: null,
    taxReserveMonths: null,
    miReserveMonths: null,
    aggregateAdjustment: 0,
    notes: null,
  }
}

/** A name for a new scenario: the home's street, else "Option n". */
export const scenarioName = (property: Property | null, existing: number) => property?.addressLine ?? `Option ${existing + 1}`

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** Prepaid and reserve months when the scenario doesn't set them. A purchase prepays a year of insurance; a refi keeps the current policy. */
export function defaultMonths(purpose: LoanPurpose) {
  return { hoiPrepaid: isPurchase(purpose) ? 12 : 0, taxPrepaid: 0, hoiReserve: 3, taxReserve: 3, miReserve: 0 }
}

export interface ScenarioFigures {
  ltvPct: number | null
  /** Base loan plus any financed FHA/VA/USDA fee: payment, points and interest use it. */
  totalLoanAmount: number
  financedFee: number
  payment: PaymentLines
  pitia: number
  miCalculated: boolean
}

/** LTV, loan amount with financed fees, and the monthly payment lines. */
export function scenarioFigures(s: ScenarioDraft, otherFinancing = 0): ScenarioFigures {
  const base = s.loanAmount ?? 0
  const value = s.propertyValue ?? s.purchasePrice
  // LTV is on the lower of price and value.
  const basis = s.purchasePrice && value ? Math.min(s.purchasePrice, value) : value
  const ltvPct = basis ? pct(base, basis) : null
  const mi = mortgageInsurance({ mortgageType: s.mortgageType, baseLoanAmount: base, ltvPct })
  const payment: PaymentLines = {
    principalAndInterest: s.noteRate != null && s.termMonths ? firstMortgagePayment(mi.totalLoanAmount, s.noteRate, s.termMonths, s.interestOnly) : 0,
    otherFinancing,
    hoi: toMonthly(s.insuranceValue, s.insuranceFactor, value),
    supplemental: s.supplementalInsuranceMonthly ?? 0,
    taxes: toMonthly(s.taxesValue, s.taxesFactor, value),
    mi: s.monthlyMi ?? mi.monthly,
    hoa: s.monthlyHoa ?? 0,
    other: s.otherPaymentMonthly ?? 0,
  }
  return { ltvPct, totalLoanAmount: mi.totalLoanAmount, financedFee: mi.financedFee, payment, pitia: totalPitia(payment), miCalculated: s.monthlyMi == null }
}

/** What the fee engine needs from a scenario. */
export function feeContextFor(s: ScenarioDraft, purpose: LoanPurpose, figures: ScenarioFigures): FeeContext {
  const m = defaultMonths(purpose)
  return {
    purpose,
    mortgageType: s.mortgageType,
    loanAmount: figures.totalLoanAmount,
    propertyValue: s.propertyValue ?? s.purchasePrice,
    ratePct: s.noteRate ?? 0,
    pointsPct: s.pointsPct,
    lenderCredit: s.lenderCredit,
    prepaidInterestDays: s.prepaidInterestDays ?? (s.estimatedFundingDate ? prepaidInterestDays(s.estimatedFundingDate) : 0),
    monthlyHoi: figures.payment.hoi,
    monthlyTaxes: figures.payment.taxes,
    monthlyMi: figures.payment.mi,
    hoiPrepaidMonths: s.hoiPrepaidMonths ?? m.hoiPrepaid,
    taxPrepaidMonths: s.taxPrepaidMonths ?? m.taxPrepaid,
    hoiReserveMonths: s.hoiReserveMonths ?? m.hoiReserve,
    taxReserveMonths: s.taxReserveMonths ?? m.taxReserve,
    miReserveMonths: s.miReserveMonths ?? m.miReserve,
    aggregateAdjustment: s.aggregateAdjustment,
    impoundWaiver: s.impoundWaiver,
  }
}

/** The whole worksheet for a scenario: payment, fee lines, section totals and closing costs. */
export function priceScenario(s: ScenarioDraft, purpose: LoanPurpose, templates: FeeTemplate[], overrides: FeeOverride[], otherFinancing = 0) {
  const figures = scenarioFigures(s, otherFinancing)
  const lines = feeSheet(templates, overrides, feeContextFor(s, purpose, figures))
  const totals = sectionTotals(lines)
  return { figures, lines, totals, closingCosts: totalClosingCosts(totals, s.lenderCredit) }
}

// ---------------------------------------------------------------------------
// "Use for this loan"
// ---------------------------------------------------------------------------

export interface LoanChanges {
  loan: Partial<LoanDetails>
  /** Changes to the scenario's home, or null when it has none. */
  property: Partial<Property> | null
}

/** What "Use for this loan" writes: the loan terms to the loan, and taxes, insurance and HOA to the home (or the loan's estimates when there's no home). */
export function loanChangesFrom(s: PricingScenario, purpose: LoanPurpose, closingCosts: number, prepaids: number): LoanChanges {
  const value = s.propertyValue ?? s.purchasePrice
  const annualTaxes = s.taxesValue == null ? null : round(toMonthly(s.taxesValue, s.taxesFactor, value) * 12)
  const annualInsurance = s.insuranceValue == null ? null : round(toMonthly(s.insuranceValue, s.insuranceFactor, value) * 12)
  const points = s.loanAmount ? pointsAmount(s.pointsPct, s.loanAmount) : 0
  const loan: Partial<LoanDetails> = {
    loanAmount: s.loanAmount,
    noteRate: s.noteRate,
    termMonths: s.termMonths,
    mortgageType: s.mortgageType,
    amortizationType: s.amortizationType,
    hasInterestOnly: s.interestOnly,
    qualifyingRate: s.qualifyingRate,
    buydown: s.buydown,
    supplementalInsuranceMonthly: s.supplementalInsuranceMonthly,
    otherPaymentMonthly: s.otherPaymentMonthly,
    otherPaymentLabel: s.otherPaymentLabel,
    impoundWaiver: s.impoundWaiver,
    estimatedFundingDate: s.estimatedFundingDate,
    firstPaymentDate: s.firstPaymentDate,
    discountPointsAmount: points || null,
    lenderCredits: s.lenderCredit || null,
    estimatedClosingCosts: round(closingCosts - prepaids) || null,
    prepaidItemsAmount: prepaids || null,
    pricingScenarioId: s.id,
    ...(isPurchase(purpose) && { purchasePrice: s.purchasePrice }),
    ...(s.propertyId && { subjectPropertyId: s.propertyId }),
  }
  if (!s.propertyId) {
    return {
      loan: {
        ...loan,
        estimatedAnnualInsurance: annualInsurance,
        estimatedMonthlyHoa: s.monthlyHoa,
        estimatedTaxRatePct: annualTaxes != null && value ? round((annualTaxes / value) * 100, 3) : null,
      },
      property: null,
    }
  }
  return {
    loan,
    property: { annualTaxes, annualInsurance, monthlyHoa: s.monthlyHoa, ...(!isPurchase(purpose) && { estimatedValue: s.propertyValue }) },
  }
}
