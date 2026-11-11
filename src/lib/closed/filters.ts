// Closed loans → More filters (Connor, 2026-11-11): search closed loans by
// their details, any mix at once. Each range is "from" and/or "to"
// (inclusive); a blank end is open. A loan with no value for a field that has
// a range set doesn't match (an unknown credit score isn't "680 and up").

export interface Range {
  min: number | null
  max: number | null
}

export interface ClosedFilters {
  credit: Range
  /** Note rate, in percent (6.25 = 6.25%). */
  rate: Range
  amount: Range
  /** Closing date, YYYY-MM-DD. */
  closedFrom: string | null
  closedTo: string | null
  purpose: string | null
  occupancy: string | null
  termYears: number | null
}

export const NO_FILTERS: ClosedFilters = {
  credit: { min: null, max: null },
  rate: { min: null, max: null },
  amount: { min: null, max: null },
  closedFrom: null,
  closedTo: null,
  purpose: null,
  occupancy: null,
  termYears: null,
}

export interface FilterableLoan {
  creditScore: number | null
  rate: number | null
  loanAmount: number | null
  closingDate: string | null
  purpose: string
  occupancy: string
  termMonths: number | null
}

const rangeSet = (r: Range) => r.min != null || r.max != null

function inRange(value: number | null, r: Range): boolean {
  if (!rangeSet(r)) return true
  if (value == null) return false
  // Rates are compared to 3 decimals so 6.25 typed matches 6.250 saved.
  const v = Math.round(value * 1000) / 1000
  return (r.min == null || v >= r.min) && (r.max == null || v <= r.max)
}

export function matchesFilters(l: FilterableLoan, f: ClosedFilters): boolean {
  if (!inRange(l.creditScore, f.credit) || !inRange(l.rate, f.rate) || !inRange(l.loanAmount, f.amount)) return false
  if (f.closedFrom || f.closedTo) {
    if (!l.closingDate) return false
    if (f.closedFrom && l.closingDate < f.closedFrom) return false
    if (f.closedTo && l.closingDate > f.closedTo) return false
  }
  if (f.purpose && l.purpose !== f.purpose) return false
  if (f.occupancy && l.occupancy !== f.occupancy) return false
  if (f.termYears != null && (l.termMonths == null || l.termMonths !== f.termYears * 12)) return false
  return true
}

/** How many filters are set (for the "More filters (3)" button). */
export function activeCount(f: ClosedFilters): number {
  return [rangeSet(f.credit), rangeSet(f.rate), rangeSet(f.amount), !!(f.closedFrom || f.closedTo), !!f.purpose, !!f.occupancy, f.termYears != null].filter(Boolean).length
}

/** A min above its max is a typo, not "nothing matches". */
export function rangeProblem(r: Range): string | null {
  return r.min != null && r.max != null && r.min > r.max ? 'The "from" is above the "to".' : null
}

/** Quick picks for credit, like the bands lenders use. */
export const CREDIT_BANDS: { label: string; range: Range }[] = [
  { label: 'Under 620', range: { min: null, max: 619 } },
  { label: '620–659', range: { min: 620, max: 659 } },
  { label: '660–699', range: { min: 660, max: 699 } },
  { label: '700–739', range: { min: 700, max: 739 } },
  { label: '740+', range: { min: 740, max: null } },
]
