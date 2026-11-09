// Pricing scenarios: saved what-if options on one file (Pricing tab). A
// scenario starts from the loan, or from one of its homes ("Push to pricer"),
// and "Use for this loan" copies its numbers back into the loan and the home,
// which stay the one source of truth. Pure functions; the math is in
// '@/lib/calc'.

import {
  cashToClose,
  collateralHomes,
  feeSheet,
  firstMortgagePayment,
  mortgageInsurance,
  otherCollateral,
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
  /** The FHA/VA/USDA upfront fee is paid in cash instead of financed (the fee line marked paid by the borrower). Not saved on its own. */
  financedFeeInCash?: boolean
  /** The loan's MI and upfront fee overrides (e.g. VA exempt = 0), carried in when priced. Not saved on its own. */
  upfrontFeePct?: number | null
  miRatePct?: number | null
}

export type ScenarioDraft = Omit<PricingScenario, 'id'>

/** The loan as the Pricing tab needs it. */
export interface PricingLoan {
  id: string
  purpose: LoanPurpose
  details: LoanDetails
}

const isPurchase = (purpose: LoanPurpose) => purpose === 'purchase'

/** The other homes securing a cross-collateralized loan, added together (null when there are none or the loan isn't cross-collateralized). */
export function otherCollateralFor(details: Pick<LoanDetails, 'crossCollateral' | 'subjectPropertyId'>, homes: Property[]) {
  return otherCollateral(collateralHomes(details.crossCollateral, details.subjectPropertyId, homes))
}

const plus = (a: number | null, b: number) => (a === null ? (b ? b : null) : round(a + b))

/**
 * A new scenario from the loan, or from one of its homes. Pass the loan's
 * homes so a cross-collateralized loan's estimate on the subject property
 * counts every collateral home's value, taxes, insurance and HOA.
 */
export function scenarioFrom(loan: PricingLoan, property: Property | null, name: string, homes: Property[] = []): ScenarioDraft {
  const d = loan.details
  const purchase = isPurchase(loan.purpose)
  const isSubject = !property || property.id === d.subjectPropertyId
  const other = isSubject && property ? otherCollateralFor(d, homes) : null
  const price = purchase ? (isSubject ? (d.purchasePrice ?? property?.listPrice ?? null) : (property!.listPrice ?? d.purchasePrice)) : null
  const ownValue = property?.estimatedValue ?? price
  const value = other && ownValue !== null ? round(ownValue + other.estimatedValue) : ownValue
  // Another house keeps the same down payment percent.
  const loanAmount =
    !isSubject && purchase && price && d.loanAmount && d.purchasePrice ? round((price * d.loanAmount) / d.purchasePrice, 0) : d.loanAmount
  const taxes: [number | null, Factor] =
    property?.annualTaxes != null ? [plus(property.annualTaxes, other?.annualTaxes ?? 0), 'annual'] : d.estimatedTaxRatePct != null ? [d.estimatedTaxRatePct, 'pct_of_value'] : [null, 'annual']
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
    insuranceValue: plus(property?.annualInsurance ?? d.estimatedAnnualInsurance, other?.annualInsurance ?? 0),
    insuranceFactor: 'annual',
    supplementalInsuranceMonthly: d.supplementalInsuranceMonthly,
    monthlyHoa: plus(property?.monthlyHoa ?? d.estimatedMonthlyHoa, other?.monthlyHoa ?? 0),
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

export type HomeFigures = Pick<Property, 'annualTaxes' | 'annualInsurance' | 'monthlyHoa'>

/**
 * When a home's taxes, insurance or HOA change, its scenarios follow: a figure
 * the scenario still had from the home (or left blank) takes the new value. A
 * figure changed on purpose in the scenario (a different amount, or monthly or
 * % of value) stays.
 */
export function followHome(s: Pick<ScenarioDraft, 'taxesValue' | 'taxesFactor' | 'insuranceValue' | 'insuranceFactor' | 'monthlyHoa'>, before: HomeFigures, after: HomeFigures): Partial<ScenarioDraft> {
  const follows = (value: number | null, factor: Factor, old: number | null) => factor === 'annual' && (value == null || value === old)
  return {
    ...(after.annualTaxes !== before.annualTaxes && follows(s.taxesValue, s.taxesFactor, before.annualTaxes) && { taxesValue: after.annualTaxes }),
    ...(after.annualInsurance !== before.annualInsurance && follows(s.insuranceValue, s.insuranceFactor, before.annualInsurance) && { insuranceValue: after.annualInsurance }),
    ...(after.monthlyHoa !== before.monthlyHoa && (s.monthlyHoa == null || s.monthlyHoa === before.monthlyHoa) && { monthlyHoa: after.monthlyHoa }),
  }
}

/** Where a scenario's yearly taxes, insurance or HOA differ from its home's (for "Use the home's numbers"). */
export function homeDifferences(s: Pick<ScenarioDraft, 'taxesValue' | 'taxesFactor' | 'insuranceValue' | 'insuranceFactor' | 'monthlyHoa'>, home: HomeFigures): { label: string; field: 'taxesValue' | 'insuranceValue' | 'monthlyHoa'; scenario: number | null; home: number }[] {
  const out: ReturnType<typeof homeDifferences> = []
  if (home.annualTaxes != null && s.taxesFactor === 'annual' && s.taxesValue !== home.annualTaxes) out.push({ label: 'Taxes / yr', field: 'taxesValue', scenario: s.taxesValue, home: home.annualTaxes })
  if (home.annualInsurance != null && s.insuranceFactor === 'annual' && s.insuranceValue !== home.annualInsurance) out.push({ label: 'Insurance / yr', field: 'insuranceValue', scenario: s.insuranceValue, home: home.annualInsurance })
  if (home.monthlyHoa != null && s.monthlyHoa !== home.monthlyHoa) out.push({ label: 'HOA / mo', field: 'monthlyHoa', scenario: s.monthlyHoa, home: home.monthlyHoa })
  return out
}

/** The fields of a draft that differ from the saved scenario. */
export function scenarioChanges(saved: PricingScenario, draft: ScenarioDraft): Partial<ScenarioDraft> {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => saved[key as keyof ScenarioDraft] !== value)) as Partial<ScenarioDraft>
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
  /** The FHA/VA/USDA upfront fee, financed or paid in cash, and its rate. */
  upfrontFee: number
  upfrontFeePct: number
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
  const mi = mortgageInsurance({ mortgageType: s.mortgageType, baseLoanAmount: base, ltvPct, annualRatePct: s.miRatePct, upfrontFeePct: s.upfrontFeePct })
  // Paid in cash: the loan stays the base loan, and the fee is a closing cost.
  const totalLoanAmount = s.financedFeeInCash ? base : mi.totalLoanAmount
  const payment: PaymentLines = {
    principalAndInterest: s.noteRate != null && s.termMonths ? firstMortgagePayment(totalLoanAmount, s.noteRate, s.termMonths, s.interestOnly) : 0,
    otherFinancing,
    hoi: toMonthly(s.insuranceValue, s.insuranceFactor, value),
    supplemental: s.supplementalInsuranceMonthly ?? 0,
    taxes: toMonthly(s.taxesValue, s.taxesFactor, value),
    mi: s.monthlyMi ?? mi.monthly,
    hoa: s.monthlyHoa ?? 0,
    other: s.otherPaymentMonthly ?? 0,
  }
  return { ltvPct, totalLoanAmount, financedFee: s.financedFeeInCash ? 0 : mi.financedFee, upfrontFee: mi.financedFee, upfrontFeePct: mi.upfrontFeePct, payment, pitia: totalPitia(payment), miCalculated: s.monthlyMi == null }
}

/** What the fee engine needs from a scenario. */
export function feeContextFor(s: ScenarioDraft, purpose: LoanPurpose, figures: ScenarioFigures, extra: Partial<FeeContext> = {}): FeeContext {
  const m = defaultMonths(purpose)
  return {
    ...extra,
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
    taxReserveMonths: s.taxReserveMonths ?? extra.taxReserveMonths ?? m.taxReserve,
    miReserveMonths: s.miReserveMonths ?? m.miReserve,
    aggregateAdjustment: s.aggregateAdjustment,
    impoundWaiver: s.impoundWaiver,
    purchasePrice: extra.purchasePrice ?? s.purchasePrice,
    baseLoanAmount: s.loanAmount ?? 0,
    financedFee: figures.upfrontFee,
    financedFeeName: extra.financedFeeName ?? upfrontFeeName(s.mortgageType, figures.upfrontFeePct, s.financedFeeInCash),
  }
}

/** "FHA upfront MIP (1.75%) · financed", for the fee line. */
export function upfrontFeeName(type: ScenarioDraft['mortgageType'], pct: number, inCash?: boolean): string {
  const what = type === 'fha' ? 'FHA upfront MIP' : type === 'va' ? 'VA funding fee' : type === 'usda_rural' ? 'USDA guarantee fee' : 'Upfront fee'
  return `${what} (${pct}%)${inCash ? '' : ' · financed'}`
}

/** The whole worksheet for a scenario: payment, fee lines, section totals and closing costs. */
export function priceScenario(s: ScenarioDraft, purpose: LoanPurpose, templates: FeeTemplate[], overrides: FeeOverride[], otherFinancing = 0, extra: Partial<FeeContext> = {}) {
  // Marking the financed-fee line paid by the borrower pays it in cash instead of financing it.
  const inCash = overrides.some((o) => o.key === 'financed_fee' && o.paidBy === 'B')
  const priced = inCash ? { ...s, financedFeeInCash: true } : s
  const figures = scenarioFigures(priced, otherFinancing)
  const lines = feeSheet(templates, overrides, feeContextFor(priced, purpose, figures, extra))
  const totals = sectionTotals(lines)
  return { figures, lines, totals, closingCosts: totalClosingCosts(totals, s.lenderCredit) }
}

// ---------------------------------------------------------------------------
// Existing mortgages and cash to close
// ---------------------------------------------------------------------------

const isSecondLien = (purpose: LoanPurpose) => purpose === 'heloc' || purpose === 'heloan'

/** Which of the home's mortgages the new loan pays off: a refinance pays off the first lien and anything marked paid off; a HELOC/HELOAN only what's marked. */
function paidOff(purpose: LoanPurpose, lien: Property['liens'][number]) {
  if (isPurchase(purpose)) return false
  return lien.toBePaidOff || (!isSecondLien(purpose) && lien.position === 'first')
}

/** Mortgage balances paid off at closing. */
export function payoffsFor(purpose: LoanPurpose, property: Property | null): number {
  return round((property?.liens ?? []).filter((l) => paidOff(purpose, l)).reduce((sum, l) => sum + (l.balance ?? 0), 0))
}

/** Monthly payments on mortgages that stay (e.g. the first lien behind a HELOC). */
export function otherFinancingFor(purpose: LoanPurpose, property: Property | null): number {
  if (isPurchase(purpose)) return 0
  return round((property?.liens ?? []).filter((l) => !paidOff(purpose, l)).reduce((sum, l) => sum + (l.monthlyPayment ?? 0), 0))
}

/** Balances of mortgages that stay on the home, for CLTV. */
export function remainingLiensFor(purpose: LoanPurpose, property: Property | null): number {
  if (isPurchase(purpose)) return 0
  return round((property?.liens ?? []).filter((l) => !paidOff(purpose, l)).reduce((sum, l) => sum + (l.balance ?? 0), 0))
}

export interface CashFigure {
  /** "Cash to borrower" when money comes back, else "Cash to close". */
  label: 'Cash to borrower' | 'Cash to close'
  amount: number
}

/**
 * Purchase: price − loan + closing costs − earnest money − seller credits. Refinance: loan − closing costs − payoffs.
 * The loan here is the base loan: a financed FHA/VA/USDA fee goes to the agency, so it is never cash.
 */
export function cashFigure(input: { purpose: LoanPurpose; purchasePrice: number | null; totalLoanAmount: number; financedFee: number; closingCosts: number; payoffs: number; earnestMoney: number; sellerCredits: number }): CashFigure {
  const purchase = isPurchase(input.purpose)
  const brings = cashToClose({
    isPurchase: purchase,
    purchasePrice: input.purchasePrice,
    baseLoanAmount: round(input.totalLoanAmount - input.financedFee),
    closingCosts: input.closingCosts,
    ...(purchase ? { earnestMoney: input.earnestMoney, sellerCredits: input.sellerCredits } : { mortgagePayoffs: input.payoffs }),
  }).cashToClose
  return brings > 0 ? { label: 'Cash to close', amount: brings } : { label: 'Cash to borrower', amount: round(-brings) }
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
  const points = pointsAmount(s.pointsPct, scenarioFigures(s).totalLoanAmount)
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
