import { dti, type DtiResult } from './ratios'
import { round } from './round'

// Qualifying income and debts for the 1003 summary. These are estimates for
// the LO; the Phase 4 income calculator refines the income figures.

export interface EmploymentIncome {
  status: 'current' | 'previous'
  baseIncome: number | null
  overtimeIncome: number | null
  bonusIncome: number | null
  commissionIncome: number | null
  militaryEntitlements: number | null
  otherEmploymentIncome: number | null
  /** Self-employed monthly income or loss; can be negative. */
  selfEmployedIncome: number | null
}

/** Monthly income from one job. Previous jobs don't count toward qualifying income. */
export function employmentMonthlyIncome(e: EmploymentIncome): number {
  if (e.status !== 'current') return 0
  return round(
    (e.baseIncome ?? 0) +
      (e.overtimeIncome ?? 0) +
      (e.bonusIncome ?? 0) +
      (e.commissionIncome ?? 0) +
      (e.militaryEntitlements ?? 0) +
      (e.otherEmploymentIncome ?? 0) +
      (e.selfEmployedIncome ?? 0),
  )
}

export interface BorrowerIncome {
  employment: number
  other: number
  total: number
}

/** One borrower's total monthly income: current jobs plus other sources (section 1e). */
export function borrowerMonthlyIncome(employments: EmploymentIncome[], otherMonthlyAmounts: number[]): BorrowerIncome {
  const employment = round(employments.reduce((sum, e) => sum + employmentMonthlyIncome(e), 0))
  const other = round(otherMonthlyAmounts.reduce((sum, a) => sum + a, 0))
  return { employment, other, total: round(employment + other) }
}

export interface DebtLine {
  monthlyPayment: number
  toBePaidOff: boolean
}

/** Monthly debt payments that remain after closing (anything being paid off is left out). */
export function monthlyDebtPayments(debts: DebtLine[]): number {
  return round(debts.filter((d) => !d.toBePaidOff).reduce((sum, d) => sum + d.monthlyPayment, 0))
}

export interface RentalProperty {
  monthlyRent: number | null
  annualTaxes: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  /** Monthly payments on liens that stay after closing. */
  lienPayments: number[]
  /** "schedule_e" uses the Income tab's Schedule E figure instead of 75% of the lease. */
  rentalMethod?: 'lease' | 'schedule_e'
  /** Schedule E monthly income before the property's payment (Income tab worksheet). */
  scheduleEMonthly?: number | null
}

/** A property's full monthly cost: remaining lien payments, taxes, insurance and HOA. */
export function rentalPropertyCost(p: Pick<RentalProperty, 'lienPayments' | 'annualTaxes' | 'annualInsurance' | 'monthlyHoa'>): number {
  return round(p.lienPayments.reduce((sum, x) => sum + x, 0) + (p.annualTaxes ?? 0) / 12 + (p.annualInsurance ?? 0) / 12 + (p.monthlyHoa ?? 0))
}

/** Share of gross rent counted as income (the usual 25% vacancy and maintenance factor). */
export const RENTAL_INCOME_FACTOR = 0.75

/**
 * Net monthly rental for a retained property: 75% of gross rent (or the
 * Schedule E figure, when that method is chosen) minus its full monthly
 * cost (liens, taxes, insurance, HOA). Negative means a loss.
 */
export function netMonthlyRental(p: RentalProperty): number {
  const costs = rentalPropertyCost(p)
  const income = p.rentalMethod === 'schedule_e' && p.scheduleEMonthly != null ? p.scheduleEMonthly : (p.monthlyRent ?? 0) * RENTAL_INCOME_FACTOR
  return round(income - costs)
}

export interface QualifyingInput {
  /** Each borrower's monthly income. */
  borrowerIncomes: number[]
  /** Proposed housing payment on the subject property (PITI + HOA). */
  housingPayment: number
  debts: DebtLine[]
  /** Net rental results for other retained properties. */
  rentalNets: number[]
  /** Loan-level income not tied to one borrower, such as asset depletion. */
  otherIncome?: number
}

export interface QualifyingResult {
  totalIncome: number
  /** Other monthly debts after closing, including rental losses. */
  otherDebts: number
  dti: DtiResult
}

/**
 * Combined income, debts and DTI for the whole application. Positive net
 * rental adds to income; a rental loss adds to debts.
 */
export function qualifying(input: QualifyingInput): QualifyingResult {
  const rentalGain = input.rentalNets.filter((n) => n > 0).reduce((s, n) => s + n, 0)
  const rentalLoss = input.rentalNets.filter((n) => n < 0).reduce((s, n) => s - n, 0)
  const totalIncome = round(input.borrowerIncomes.reduce((s, n) => s + n, 0) + rentalGain + (input.otherIncome ?? 0))
  const otherDebts = round(monthlyDebtPayments(input.debts) + rentalLoss)
  return { totalIncome, otherDebts, dti: dti(input.housingPayment, otherDebts, totalIncome) }
}
