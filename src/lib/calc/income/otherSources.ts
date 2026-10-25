import { RENTAL_INCOME_FACTOR } from '../qualifying'
import { round } from '../round'
import type { IncomeResult } from './types'

const n = (v: number | null | undefined) => v ?? 0

export interface BankStatementInput {
  totalDeposits: number | null
  /** Transfers, refunds and other non-income deposits taken out. */
  excludedDeposits: number | null
  months: 12 | 24
  accountType: 'business' | 'personal'
  /** Business accounts only: share of deposits treated as business expenses. */
  expenseRatioPct: number | null
  ownershipPct: number | null
}

/** Bank-statement income: eligible deposits, less the expense factor (business accounts), × ownership, ÷ months. */
export function bankStatementIncome(input: BankStatementInput): IncomeResult {
  const eligible = round(n(input.totalDeposits) - n(input.excludedDeposits))
  const expense = input.accountType === 'business' ? (input.expenseRatioPct ?? 50) / 100 : 0
  const afterExpenses = round(eligible * (1 - expense))
  const share = (input.ownershipPct ?? 100) / 100
  const net = round(afterExpenses * share)
  const monthly = round(net / input.months)
  const warnings: string[] = []
  if (input.accountType === 'business' && (input.expenseRatioPct ?? 50) < 50) {
    warnings.push('Expense factor under 50% usually needs a CPA letter or P&L to support it.')
  }
  if (n(input.excludedDeposits) === 0 && n(input.totalDeposits) > 0) warnings.push('No deposits excluded: make sure transfers and one-off deposits are taken out.')
  return {
    monthly,
    lines: [
      { label: `Total deposits (${input.months} months)`, amount: n(input.totalDeposits) },
      { label: 'Excluded deposits', amount: -n(input.excludedDeposits), kind: 'subtract' },
      { label: 'Eligible deposits', amount: eligible, kind: 'subtotal' },
      ...(input.accountType === 'business' ? [{ label: `Less ${round(expense * 100, 2)}% expense factor`, amount: round(afterExpenses - eligible), kind: 'subtract' as const }] : []),
      ...(share !== 1 ? [{ label: `× ${round(share * 100, 2)}% ownership`, amount: net, kind: 'subtotal' as const }] : []),
      { label: `Monthly (÷ ${input.months})`, amount: monthly, kind: 'result' },
    ],
    warnings,
  }
}

/** 75% of the gross monthly lease rent (25% vacancy and maintenance factor), before the property's payment. */
export function leaseIncome(monthlyRent: number | null): IncomeResult {
  const monthly = round((monthlyRent ?? 0) * RENTAL_INCOME_FACTOR)
  return {
    monthly,
    lines: [
      { label: 'Gross monthly rent (lease)', amount: monthlyRent ?? 0 },
      { label: `× ${RENTAL_INCOME_FACTOR * 100}% before the property's payment`, amount: monthly, kind: 'result' },
    ],
    warnings: monthlyRent ? [] : ['Enter the monthly rent from the lease.'],
  }
}

export interface ScheduleEInput {
  rentsReceived: number | null
  totalExpenses: number | null
  depreciation: number | null
  insurance: number | null
  mortgageInterest: number | null
  taxes: number | null
  /** HOA dues included in other expenses. */
  hoa: number | null
  /** One-time, extraordinary expense that won't recur. */
  oneTimeExpense: number | null
  /** Months the property was in service that year (usually 12). */
  monthsInService: number | null
}

/**
 * Schedule E rental income before the property's payment: rents less
 * expenses, adding back depreciation and the costs the payment already
 * covers (interest, taxes, insurance, HOA). The property's full payment is
 * then subtracted when net rental income is figured.
 */
export function scheduleEIncome(input: ScheduleEInput): IncomeResult {
  const months = input.monthsInService && input.monthsInService > 0 ? input.monthsInService : 12
  const adjusted = round(
    n(input.rentsReceived) - n(input.totalExpenses) + n(input.depreciation) + n(input.insurance) + n(input.mortgageInterest) + n(input.taxes) + n(input.hoa) + n(input.oneTimeExpense),
  )
  const monthly = round(adjusted / months)
  const warnings = months < 12 ? [`In service ${months} months: averaged over those months only.`] : []
  return {
    monthly,
    lines: [
      { label: 'Rents received', amount: n(input.rentsReceived) },
      { label: 'Total expenses', amount: -n(input.totalExpenses), kind: 'subtract' },
      { label: 'Depreciation', amount: n(input.depreciation), kind: 'add' },
      { label: 'Insurance', amount: n(input.insurance), kind: 'add' },
      { label: 'Mortgage interest', amount: n(input.mortgageInterest), kind: 'add' },
      { label: 'Taxes', amount: n(input.taxes), kind: 'add' },
      { label: 'HOA dues', amount: n(input.hoa), kind: 'add' },
      { label: 'One-time expense', amount: n(input.oneTimeExpense), kind: 'add' },
      { label: 'Adjusted annual', amount: adjusted, kind: 'subtotal' },
      { label: `Monthly (÷ ${months}) before the property's payment`, amount: monthly, kind: 'result' },
    ],
    warnings,
  }
}
