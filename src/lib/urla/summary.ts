import type { LoanDetails, LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { assetDepletionIncome, borrowerMonthlyIncome, computeScenario, proposedHousingPayment, qualifying, type LoanPurposeKind, type QualifyingResult, type ScenarioInput, type ScenarioResult } from '@/lib/calc'
import { ownedProperties, propertyNetRental } from './realEstate'

export type ScenarioDetails = Pick<
  LoanDetails,
  'purchasePrice' | 'loanAmount' | 'noteRate' | 'termMonths' | 'mortgageType' | 'miRatePct' | 'upfrontFeePct' | 'estimatedTaxRatePct' | 'estimatedAnnualInsurance' | 'estimatedMonthlyHoa'
>

/** Everything the payment math needs from a loan: deal facts, subject property, loan type, MI settings and estimates. */
export function loanScenarioInput(purpose: LoanPurposeKind, d: ScenarioDetails, subject: Property | null): ScenarioInput {
  return {
    purpose,
    purchasePrice: d.purchasePrice,
    loanAmount: d.loanAmount,
    noteRatePct: d.noteRate,
    termMonths: d.termMonths,
    property: subject,
    liens: subject?.liens ?? [],
    mortgageType: d.mortgageType,
    miRatePct: d.miRatePct,
    upfrontFeePct: d.upfrontFeePct,
    estimates: { taxRatePct: d.estimatedTaxRatePct, annualInsurance: d.estimatedAnnualInsurance, monthlyHoa: d.estimatedMonthlyHoa },
  }
}

export interface ApplicationSummary {
  subject: Property | null
  isPurchase: boolean
  scenario: ScenarioResult
  /** Proposed housing payment on the subject property. */
  housing: number | null
  /** Each borrower's monthly income from the 1003, in borrower order. */
  borrowerIncomes: number[]
  /** Asset-depletion income from accounts marked for it (all borrowers). */
  depletionIncome: number
  qualifying: QualifyingResult
}

/** The key figures shown under the 1003 and Income tabs: income, housing, debts and DTI. */
export function applicationSummary(loan: LoanProfile, app: Application, properties: Property[] | undefined): ApplicationSummary {
  const subject = properties?.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const isPurchase = loan.purpose === 'purchase' || (loan.purpose === 'investment_dscr' && loan.details.purchasePrice !== null)
  const scenarioInput = loanScenarioInput(loan.purpose, loan.details, subject)
  const scenario = computeScenario(scenarioInput)
  const housing = proposedHousingPayment(scenarioInput, scenario)
  const rentalNets = ownedProperties(properties)
    .filter((p) => p.id !== loan.details.subjectPropertyId && p.reoDisposition === 'retain')
    .map(propertyNetRental)
  const borrowerIncomes = app.borrowers.map((b) => borrowerMonthlyIncome(b.employments, b.otherIncomes.map((i) => i.monthlyAmount)).total)
  const depletionIncome = assetDepletionIncome(app.assets)
  return {
    subject,
    isPurchase,
    scenario,
    housing,
    borrowerIncomes,
    depletionIncome,
    qualifying: qualifying({ borrowerIncomes, housingPayment: housing ?? 0, debts: app.liabilities, rentalNets, otherIncome: depletionIncome }),
  }
}
