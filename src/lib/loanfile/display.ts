// Display rules for the loan file workspace: credit tiers and step counts.
// Pure functions; the components only render what these return.

export type StepStatus = 'not_started' | 'ready' | 'in_progress' | 'done' | 'blocked' | 'na'

export interface CreditTier {
  label: 'Exceptional' | 'Very good' | 'Good' | 'Fair' | 'Poor'
  /** Dot color on the metrics strip. */
  tone: 'green' | 'amber' | 'red'
}

/** FICO score bands: 800+ Exceptional, 740 Very good, 670 Good, 580 Fair, below 580 Poor. */
export function creditTier(score: number | null): CreditTier | null {
  if (score === null || !Number.isFinite(score)) return null
  if (score >= 800) return { label: 'Exceptional', tone: 'green' }
  if (score >= 740) return { label: 'Very good', tone: 'green' }
  if (score >= 670) return { label: 'Good', tone: 'green' }
  if (score >= 580) return { label: 'Fair', tone: 'amber' }
  return { label: 'Poor', tone: 'red' }
}

export interface GroupCounts {
  done: number
  /** Steps that count toward progress (not-applicable steps are left out). */
  total: number
  ready: number
  blocked: number
}

/** Progress for one step group: done out of applicable steps, plus how many are ready or blocked. */
export function groupCounts(statuses: StepStatus[]): GroupCounts {
  const applicable = statuses.filter((s) => s !== 'na')
  return {
    done: applicable.filter((s) => s === 'done').length,
    total: applicable.length,
    ready: applicable.filter((s) => s === 'ready').length,
    blocked: applicable.filter((s) => s === 'blocked').length,
  }
}

/** "3/7 · 2 ready" under each progress bar. */
export function groupCountLabel(c: GroupCounts): string {
  const extras = [c.ready && `${c.ready} ready`, c.blocked && `${c.blocked} blocked`].filter(Boolean)
  return [`${c.done}/${c.total}`, ...extras].join(' · ')
}

/** "3d at this step", "1 day at this step", "today". */
export function daysAtStep(days: number): string {
  if (days <= 0) return 'today'
  return days === 1 ? '1 day at this step' : `${days} days at this step`
}
