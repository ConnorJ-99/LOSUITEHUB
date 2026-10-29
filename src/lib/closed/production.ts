// Production from closed loans: loans and volume by year, lender, loan
// officer, loan type and purpose. Computed from the loans every time;
// nothing here is stored.

export interface ProductionLoan {
  closingDate: string | null
  loanAmount: number | null
  lender: string | null
  loName: string | null
  loanType: string | null
  purpose: string
}

export interface ProductionGroup {
  label: string
  count: number
  volume: number
  /** Share of the loans in this view, 0-1. */
  share: number
}

export interface Production {
  count: number
  volume: number
  average: number | null
  /** Loans with no loan amount (they count, but add nothing to volume). */
  missingAmount: number
  byLender: ProductionGroup[]
  byLo: ProductionGroup[]
  byLoanType: ProductionGroup[]
  byPurpose: ProductionGroup[]
}

export const NOT_RECORDED = 'Not recorded'

/** The closing year, or null when the date is missing. */
export const closingYear = (loan: Pick<ProductionLoan, 'closingDate'>) => (loan.closingDate ? Number(loan.closingDate.slice(0, 4)) : null)

/** Years with closed loans, newest first. */
export function closingYears(loans: Pick<ProductionLoan, 'closingDate'>[]): number[] {
  return [...new Set(loans.map(closingYear).filter((y): y is number => y !== null))].sort((a, b) => b - a)
}

function groupBy(loans: ProductionLoan[], label: (l: ProductionLoan) => string | null): ProductionGroup[] {
  const groups = new Map<string, { count: number; volume: number }>()
  for (const loan of loans) {
    const key = label(loan)?.trim() || NOT_RECORDED
    const g = groups.get(key) ?? { count: 0, volume: 0 }
    g.count++
    g.volume += loan.loanAmount ?? 0
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ label: key, ...g, share: loans.length ? g.count / loans.length : 0 }))
    .sort((a, b) => b.volume - a.volume || b.count - a.count || a.label.localeCompare(b.label))
}

export function production(loans: ProductionLoan[], labels: { loanType: (v: string) => string; purpose: (v: string) => string }): Production {
  const withAmount = loans.filter((l) => l.loanAmount !== null)
  const volume = withAmount.reduce((sum, l) => sum + (l.loanAmount ?? 0), 0)
  return {
    count: loans.length,
    volume,
    average: withAmount.length ? Math.round(volume / withAmount.length) : null,
    missingAmount: loans.length - withAmount.length,
    byLender: groupBy(loans, (l) => l.lender),
    byLo: groupBy(loans, (l) => l.loName),
    byLoanType: groupBy(loans, (l) => (l.loanType ? labels.loanType(l.loanType) : null)),
    byPurpose: groupBy(loans, (l) => labels.purpose(l.purpose)),
  }
}
