// When a lender's matrix was last checked (plan §5.7): a matrix not verified
// in 45 days gets a stale warning.

export const STALE_AFTER_DAYS = 45

/** Whole days from a YYYY-MM-DD date to today; null when never verified. */
export function daysSince(date: string | null, today: string): number | null {
  if (!date) return null
  const ms = new Date(`${today}T12:00:00Z`).getTime() - new Date(`${date}T12:00:00Z`).getTime()
  return Math.max(0, Math.round(ms / 86_400_000))
}

/** The oldest verification among a lender's active programs (what the warning is about). */
export function oldestVerified(programs: { active: boolean; lastVerifiedOn: string | null }[]): string | null {
  const dates = programs.filter((p) => p.active).map((p) => p.lastVerifiedOn)
  if (dates.length === 0 || dates.some((d) => d == null)) return null
  return (dates as string[]).sort()[0]
}

export const isStale = (date: string | null, today: string, after = STALE_AFTER_DAYS) => {
  const days = daysSince(date, today)
  return days == null || days > after
}
