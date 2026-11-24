// A closed home's value today and the equity in it, for MyHome (closed view
// Step B, docs/plans/myhome.md section 5). Estimates only, never an appraisal.
//
// Index estimate = the starting value (the purchase price, or the appraised
// value on a refinance) × (latest FHFA index ÷ the index for the quarter it
// closed), rounded to the nearest $1,000. When Connor has set the home's value
// on or after the day the latest index was loaded, his figure wins.

/** The FHFA index growth since closing, ready to apply. */
export interface IndexBasis {
  /** The purchase price, or the appraised value at closing. */
  base: number
  /** The index for the quarter it closed (the latest one when it closed after that). */
  baseIndex: number
  latestIndex: number
  /** The day the latest index was loaded (YYYY-MM-DD), to compare with Connor's figure. */
  loadedOn: string
}

/** base × growth, to the nearest $1,000. */
export function indexEstimate(b: Pick<IndexBasis, 'base' | 'baseIndex' | 'latestIndex'>): number {
  if (!(b.base > 0) || !(b.baseIndex > 0) || !(b.latestIndex > 0)) return 0
  return Math.round((b.base * (b.latestIndex / b.baseIndex)) / 1000) * 1000
}

export type HomeValue = { amount: number; by: 'connor'; on: string | null } | { amount: number; by: 'index'; base: number; gain: number }

/**
 * The value MyHome shows: Connor's figure when it is as new as the index
 * (or there is no index estimate), else the index estimate with the gain since
 * closing. Null when there is neither.
 */
export function homeValue(connor: { amount: number; on: string | null } | null, index: IndexBasis | null): HomeValue | null {
  const estimate = index ? indexEstimate(index) : 0
  if (connor && connor.amount > 0 && (!estimate || (connor.on !== null && connor.on >= index!.loadedOn))) return { amount: connor.amount, by: 'connor', on: connor.on }
  if (estimate > 0) return { amount: estimate, by: 'index', base: index!.base, gain: estimate - index!.base }
  return null
}

/** "2026 Q2" → the year and quarter; a date → the quarter it falls in. */
export function quarterOf(isoDate: string): { year: number; quarter: number } {
  return { year: Number(isoDate.slice(0, 4)), quarter: Math.floor((Number(isoDate.slice(5, 7)) - 1) / 3) + 1 }
}

/**
 * Cash-out room (MyHome Step C): what they could borrow against the home,
 * up to 80% of its value (Texas home equity's limit) less what they owe, to
 * the nearest $1,000 below; never under $0.
 */
export function cashOutRoom(value: number, balance: number, maxLtvPct = 80): number {
  if (!(value > 0)) return 0
  return Math.max(0, Math.floor((value * (maxLtvPct / 100) - Math.max(0, balance)) / 1000) * 1000)
}
