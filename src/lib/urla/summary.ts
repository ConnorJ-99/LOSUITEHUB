import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { borrowerMonthlyIncome, computeScenario, proposedHousingPayment, qualifying, type QualifyingResult, type ScenarioResult } from '@/lib/calc'
import { ownedProperties, propertyNetRental } from './realEstate'

export interface ApplicationSummary {
  subject: Property | null
  isPurchase: boolean
  scenario: ScenarioResult
  /** Proposed housing payment on the subject property. */
  housing: number | null
  /** Each borrower's monthly income from the 1003, in borrower order. */
  borrowerIncomes: number[]
  qualifying: QualifyingResult
}

/** The key figures shown under the 1003 and Income tabs: income, housing, debts and DTI. */
export function applicationSummary(loan: LoanProfile, app: Application, properties: Property[] | undefined): ApplicationSummary {
  const subject = properties?.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const isPurchase = loan.purpose === 'purchase' || (loan.purpose === 'investment_dscr' && loan.details.purchasePrice !== null)
  const scenarioInput = {
    purpose: loan.purpose,
    purchasePrice: loan.details.purchasePrice,
    loanAmount: loan.details.loanAmount,
    noteRatePct: loan.details.noteRate,
    termMonths: loan.details.termMonths,
    property: subject,
    liens: subject?.liens ?? [],
  }
  const scenario = computeScenario(scenarioInput)
  const housing = proposedHousingPayment(scenarioInput, scenario)
  const rentalNets = ownedProperties(properties)
    .filter((p) => p.id !== loan.details.subjectPropertyId && p.reoDisposition === 'retain')
    .map(propertyNetRental)
  const borrowerIncomes = app.borrowers.map((b) => borrowerMonthlyIncome(b.employments, b.otherIncomes.map((i) => i.monthlyAmount)).total)
  return {
    subject,
    isPurchase,
    scenario,
    housing,
    borrowerIncomes,
    qualifying: qualifying({ borrowerIncomes, housingPayment: housing ?? 0, debts: app.liabilities, rentalNets }),
  }
}
