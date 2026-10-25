import { round } from '../round'
import type { IncomeResult } from './types'

export type PayFrequency = 'annual' | 'monthly' | 'semi_monthly' | 'biweekly' | 'weekly' | 'hourly'

export const PERIODS_PER_YEAR: Record<Exclude<PayFrequency, 'hourly'>, number> = {
  annual: 1,
  monthly: 12,
  semi_monthly: 24,
  biweekly: 26,
  weekly: 52,
}

export interface WageInput {
  frequency: PayFrequency
  /** Pay per period, or the hourly rate when frequency is "hourly". */
  amount: number | null
  /** Average hours per week (hourly pay only). */
  hoursPerWeek?: number | null
}

/** Base pay to a monthly figure: annual pay ÷ 12. Hourly = rate × hours × 52 weeks. */
export function wageIncome(input: WageInput): IncomeResult {
  const amount = input.amount ?? 0
  if (input.frequency === 'hourly') {
    const hours = input.hoursPerWeek ?? 0
    const annual = round(amount * hours * 52)
    const warnings = hours > 40 ? ['Over 40 hours a week: the extra hours are usually overtime, which needs its own 2-year history.'] : []
    if (!hours) warnings.push('Enter average hours per week.')
    return {
      monthly: round(annual / 12),
      lines: [
        { label: 'Hourly rate', amount },
        { label: `× ${hours} hours × 52 weeks`, amount: annual, kind: 'subtotal' },
        { label: 'Monthly (÷ 12)', amount: round(annual / 12), kind: 'result' },
      ],
      warnings,
    }
  }
  const periods = PERIODS_PER_YEAR[input.frequency]
  const annual = round(amount * periods)
  return {
    monthly: round(annual / 12),
    lines: [
      { label: 'Pay per period', amount },
      { label: `× ${periods} pay periods`, amount: annual, kind: 'subtotal' },
      { label: 'Monthly (÷ 12)', amount: round(annual / 12), kind: 'result' },
    ],
    warnings: [],
  }
}

export type Trend = 'increasing' | 'stable' | 'declining' | 'unknown'

export interface VariableIncomeInput {
  /** Year-to-date amount from the latest pay stub. */
  ytdAmount: number | null
  /** Months covered by the YTD amount (e.g. 9.5 for mid-October). */
  ytdMonths: number | null
  /** Most recent full year (W-2 / WVOE). */
  priorYear1: number | null
  /** The year before that. */
  priorYear2: number | null
}

/**
 * Overtime, bonus or commission: total of YTD plus prior years ÷ months
 * covered. If the trend is declining, the lower current rate is used and
 * flagged, since underwriters won't average a falling income up.
 */
export function variableIncome(input: VariableIncomeInput): IncomeResult & { trend: Trend } {
  const warnings: string[] = []
  // A YTD figure only counts once we know how many months it covers.
  const ytdMonths = input.ytdAmount !== null && input.ytdMonths ? input.ytdMonths : 0
  const ytd = ytdMonths > 0 ? input.ytdAmount ?? 0 : 0
  if (input.ytdAmount !== null && !ytdMonths) warnings.push('Enter how many months the YTD amount covers.')
  const years = [input.priorYear1, input.priorYear2].filter((y): y is number => y !== null)
  const months = ytdMonths + years.length * 12
  const total = ytd + years.reduce((s, y) => s + y, 0)
  const average = months > 0 ? round(total / months) : 0

  // Compare the current pace with the most recent full year (or that year with the one before).
  const current = ytdMonths > 0 ? (ytd / ytdMonths) * 12 : input.priorYear1
  const previous = ytdMonths > 0 ? input.priorYear1 : input.priorYear2
  let trend: Trend = 'unknown'
  if (current !== null && previous !== null && previous > 0) {
    const change = (current - previous) / previous
    trend = change < -0.005 ? 'declining' : change > 0.005 ? 'increasing' : 'stable'
    if (trend === 'declining') {
      const drop = Math.round(-change * 100)
      warnings.push(`Declining ${drop}% year over year: using the lower current rate. The underwriter will want an explanation.`)
      if (drop >= 20) warnings.push('A drop of 20% or more may make this income unusable.')
    }
  }
  const currentMonthly = current !== null ? round(current / 12) : average
  const monthly = trend === 'declining' ? Math.min(average, currentMonthly) : average

  if (months === 0) warnings.push('Enter YTD and prior-year amounts.')
  else if (months < 12) warnings.push('Less than 12 months of history: usually not enough to use this income.')
  else if (months < 24) warnings.push('Under 24 months of history: allowed only with strong offsetting factors.')

  const lines = [
    ...(ytdMonths > 0 ? [{ label: `YTD (${ytdMonths} months)`, amount: ytd }] : []),
    ...(input.priorYear1 !== null ? [{ label: 'Prior year', amount: input.priorYear1 }] : []),
    ...(input.priorYear2 !== null ? [{ label: 'Two years ago', amount: input.priorYear2 }] : []),
    { label: `Total ÷ ${months} months`, amount: average, kind: 'subtotal' as const },
    ...(trend === 'declining' ? [{ label: 'Current rate (lower, used)', amount: currentMonthly, kind: 'subtotal' as const }] : []),
    { label: 'Qualifying monthly', amount: round(monthly), kind: 'result' as const },
  ]
  return { monthly: round(monthly), lines, warnings, trend }
}
