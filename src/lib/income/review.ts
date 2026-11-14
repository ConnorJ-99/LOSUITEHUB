// Checking an AI income draft's figures (Stage 4d-2): every input filled from
// a document is listed with where it came from; each must be ticked Checked,
// or changed (changing a figure counts as checking it), before the draft can
// be accepted. Pure, tested.

import type { InputSource, InputSources } from './fromDocuments'
import { inputAt } from './edits'

/** Plain names for the inputs a draft fills. */
const LABELS: Record<string, string> = {
  amount: 'Pay amount',
  frequency: 'Pay frequency',
  ytdAmount: 'Year to date',
  ytdMonths: 'Months covered by YTD',
  totalDeposits: 'Total deposits',
  recentYear: 'Most recent tax year',
  netProfit: 'Net profit (line 31)',
  nonrecurringIncome: 'Non-recurring other income (line 6)',
  depletion: 'Depletion',
  depreciation: 'Depreciation',
  nonDeductibleMeals: 'Non-deductible meals',
  businessUseOfHome: 'Business use of home',
  k1OrdinaryIncome: 'K-1 ordinary income',
  k1RentalIncome: 'K-1 rental income',
  k1GuaranteedPayments: 'K-1 guaranteed payments',
  amortizationCasualty: 'Amortization / casualty loss',
  notesPayableUnder1Yr: 'Notes payable < 1 year',
  nonDeductibleTravelMeals: 'Non-deductible travel & meals',
  ownershipPct: 'Ownership',
}

/** "Net profit (line 31), 2025" for recent.netProfit with the recent year. */
export function figureLabel(path: string, recentYear?: number | null): string {
  const [head, tail] = path.split('.')
  if (!tail) return LABELS[head] ?? head
  const year = recentYear ? (head === 'recent' ? recentYear : recentYear - 1) : head === 'recent' ? 'recent year' : 'older year'
  return `${LABELS[tail] ?? tail}, ${year}`
}

export interface Figure {
  path: string
  source: InputSource
  /** The value in the worksheet now. */
  current: unknown
  changed: boolean
  checked: boolean
}

const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b)

/** Each figure from a document, with whether it was changed or ticked. */
export function figures(sources: InputSources, inputs: unknown): Figure[] {
  return Object.entries(sources).map(([path, source]) => {
    const current = inputAt(inputs, path)
    const changed = !same(current, source.value)
    return { path, source, current, changed, checked: changed || !!source.checkedAt }
  })
}

/** "3 of 5 figures checked", and whether Accept can go ahead. */
export function checkProgress(list: Figure[]): { done: number; total: number; ready: boolean } {
  const done = list.filter((f) => f.checked).length
  return { done, total: list.length, ready: done === list.length }
}

/** The sources with one figure ticked (or unticked) by someone. */
export function withChecked(sources: InputSources, path: string, checked: boolean, by: string, at: string): InputSources {
  const s = sources[path]
  if (!s) return sources
  const { checkedBy: _b, checkedAt: _a, ...rest } = s
  return { ...sources, [path]: checked ? { ...rest, checkedBy: by, checkedAt: at } : rest }
}
