import { round } from '../round'
import type { IncomeLine, IncomeResult } from './types'

// Self-employed cash flow, following the Fannie Mae Form 1084 approach:
// start from taxable income, add back non-cash and one-time deductions,
// subtract non-deductible expenses, then apply the two-year rule.

const n = (v: number | null | undefined) => v ?? 0

export interface ScheduleCYear {
  netProfit: number | null
  /** Non-recurring other income (line 6), subtracted. */
  nonrecurringIncome: number | null
  depletion: number | null
  depreciation: number | null
  /** Non-deductible meals, subtracted. */
  nonDeductibleMeals: number | null
  businessUseOfHome: number | null
  amortizationCasualty: number | null
  /** Business miles × the IRS depreciation rate for that year. */
  mileageDepreciation: number | null
}

export interface SCorpYear {
  /** Borrower's K-1: ordinary business income (box 1). */
  k1OrdinaryIncome: number | null
  /** Borrower's K-1: net rental real estate and other rental income (boxes 2-3). */
  k1RentalIncome: number | null
  /** From the 1120S: added back × ownership. */
  depreciation: number | null
  depletion: number | null
  amortizationCasualty: number | null
  /** Mortgages, notes or bonds payable in less than 1 year (Schedule L), subtracted × ownership. */
  notesPayableUnder1Yr: number | null
  /** Non-deductible travel and meals (Schedule M-1), subtracted × ownership. */
  nonDeductibleTravelMeals: number | null
  ownershipPct: number | null
}

export interface PartnershipYear extends SCorpYear {
  /** Borrower's K-1 guaranteed payments (box 4), counted at 100%. */
  k1GuaranteedPayments: number | null
}

export interface YearCashFlow {
  total: number
  lines: IncomeLine[]
}

export function scheduleCCashFlow(y: ScheduleCYear): YearCashFlow {
  const lines: IncomeLine[] = [
    { label: 'Net profit or loss', amount: n(y.netProfit) },
    { label: 'Non-recurring other income', amount: -n(y.nonrecurringIncome), kind: 'subtract' },
    { label: 'Depletion', amount: n(y.depletion), kind: 'add' },
    { label: 'Depreciation', amount: n(y.depreciation), kind: 'add' },
    { label: 'Non-deductible meals', amount: -n(y.nonDeductibleMeals), kind: 'subtract' },
    { label: 'Business use of home', amount: n(y.businessUseOfHome), kind: 'add' },
    { label: 'Amortization / casualty loss', amount: n(y.amortizationCasualty), kind: 'add' },
    { label: 'Mileage depreciation', amount: n(y.mileageDepreciation), kind: 'add' },
  ]
  return { total: round(lines.reduce((s, l) => s + l.amount, 0)), lines }
}

function businessCashFlow(y: SCorpYear, extraK1: IncomeLine[]): YearCashFlow {
  const share = (y.ownershipPct ?? 100) / 100
  const business = n(y.depreciation) + n(y.depletion) + n(y.amortizationCasualty) - n(y.notesPayableUnder1Yr) - n(y.nonDeductibleTravelMeals)
  const lines: IncomeLine[] = [
    { label: 'K-1 ordinary income', amount: n(y.k1OrdinaryIncome) },
    { label: 'K-1 rental income', amount: n(y.k1RentalIncome) },
    ...extraK1,
    { label: 'Depreciation', amount: n(y.depreciation), kind: 'add' },
    { label: 'Depletion', amount: n(y.depletion), kind: 'add' },
    { label: 'Amortization / casualty loss', amount: n(y.amortizationCasualty), kind: 'add' },
    { label: 'Notes payable < 1 year', amount: -n(y.notesPayableUnder1Yr), kind: 'subtract' },
    { label: 'Non-deductible travel & meals', amount: -n(y.nonDeductibleTravelMeals), kind: 'subtract' },
    { label: `Business adjustments × ${round(share * 100, 2)}% ownership`, amount: round(business * share), kind: 'subtotal' },
  ]
  const k1 = n(y.k1OrdinaryIncome) + n(y.k1RentalIncome) + extraK1.reduce((s, l) => s + l.amount, 0)
  return { total: round(k1 + business * share), lines }
}

/** S corporation: borrower's K-1 income plus their share of the 1120S adjustments. W-2 wages from the company go on a wage worksheet. */
export function sCorpCashFlow(y: SCorpYear): YearCashFlow {
  return businessCashFlow(y, [])
}

/** Partnership: like an S corp, plus guaranteed payments at 100%. */
export function partnershipCashFlow(y: PartnershipYear): YearCashFlow {
  return businessCashFlow(y, [{ label: 'K-1 guaranteed payments', amount: n(y.k1GuaranteedPayments) }])
}

/**
 * The two-year rule: average both years when income held steady or grew;
 * use the most recent year alone when it declined (and flag it).
 */
export function twoYearMonthly(older: number | null, recent: number | null): { monthly: number; lines: IncomeLine[]; warnings: string[] } {
  const warnings: string[] = []
  if (recent === null && older === null) return { monthly: 0, lines: [], warnings: ['Enter at least the most recent year.'] }
  if (older === null || recent === null) {
    const only = (recent ?? older)!
    warnings.push('Only one year entered: most programs need two years of self-employment history.')
    return { monthly: round(only / 12), lines: [{ label: 'One year ÷ 12', amount: round(only / 12), kind: 'result' }], warnings }
  }
  const change = older !== 0 ? (recent - older) / Math.abs(older) : 0
  if (recent < older) {
    const drop = Math.round(-change * 100)
    warnings.push(`Income declined ${drop}% year over year: using the most recent year only. The underwriter will want an explanation.`)
    if (drop >= 20) warnings.push('A drop of 20% or more may make this income unusable without proof it has stabilized.')
    return {
      monthly: round(recent / 12),
      lines: [
        { label: 'Two years ago', amount: older },
        { label: 'Most recent year', amount: recent },
        { label: 'Most recent year ÷ 12 (declining)', amount: round(recent / 12), kind: 'result' },
      ],
      warnings,
    }
  }
  return {
    monthly: round((older + recent) / 24),
    lines: [
      { label: 'Two years ago', amount: older },
      { label: 'Most recent year', amount: recent },
      { label: '2-year average ÷ 24', amount: round((older + recent) / 24), kind: 'result' },
    ],
    warnings,
  }
}

export type SelfEmployedKind = 'schedule_c' | 's_corp' | 'partnership'

/** Full self-employed worksheet: each year's cash flow, then the two-year rule. */
export function selfEmployedIncome(
  kind: SelfEmployedKind,
  older: ScheduleCYear | SCorpYear | PartnershipYear | null,
  recent: ScheduleCYear | SCorpYear | PartnershipYear | null,
): IncomeResult & { olderTotal: number | null; recentTotal: number | null } {
  const flow = (y: ScheduleCYear | SCorpYear | PartnershipYear) =>
    kind === 'schedule_c' ? scheduleCCashFlow(y as ScheduleCYear) : kind === 's_corp' ? sCorpCashFlow(y as SCorpYear) : partnershipCashFlow(y as PartnershipYear)
  const olderTotal = older ? flow(older).total : null
  const recentTotal = recent ? flow(recent).total : null
  const rule = twoYearMonthly(olderTotal, recentTotal)
  const warnings = [...rule.warnings]
  if (kind !== 'schedule_c') warnings.push('K-1 income counts only if distributions or business liquidity support it; document one or the other.')
  if (rule.monthly < 0) warnings.push('This is a loss: it reduces qualifying income.')
  return { monthly: rule.monthly, lines: rule.lines, warnings, olderTotal, recentTotal }
}
