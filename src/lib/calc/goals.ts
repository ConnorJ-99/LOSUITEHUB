// Nurture goals (docs/plans/nurture-goals.md, Connor's spec 2026-11-24): how
// far along a savings, credit or debt goal is, what's left, the savings pace
// to a target date, and the plain-language line borrowers see. Pure; money in
// cents through round(), dates as YYYY-MM-DD.
//
// Savings progress uses the latest reported balance, never a sum of
// contributions. Debt progress is the part of the required paydown done.
import { round } from './round'

export type GoalKind = 'savings' | 'credit' | 'debt'

export interface GoalProgress {
  /** 0–100, one decimal. */
  pct: number
  /** Saved, points gained, or paid down since the start (never below 0). */
  moved: number
  /** Still to go to the target (never below 0). */
  remaining: number
  reached: boolean
}

export function goalProgress(g: { kind: GoalKind; start: number; target: number; current: number | null }): GoalProgress {
  const current = g.current ?? g.start
  const span = g.kind === 'debt' ? g.start - g.target : g.target - g.start
  const moved = g.kind === 'debt' ? g.start - current : current - g.start
  const remaining = g.kind === 'debt' ? current - g.target : g.target - current
  const pct = span > 0 ? Math.min(100, Math.max(0, round((moved / span) * 100, 1))) : 0
  return { pct, moved: Math.max(0, round(moved)), remaining: Math.max(0, round(remaining)), reached: remaining <= 0 }
}

/** What saving `remaining` by `targetDate` takes each week, every two weeks and each month. Null without a future date. */
export function savingsPace(remaining: number, targetDate: string | null, today: string): { days: number; perWeek: number; perTwoWeeks: number; perMonth: number } | null {
  if (!targetDate || targetDate <= today || remaining <= 0) return null
  const days = Math.round((Date.parse(`${targetDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
  if (days <= 0) return null
  const perDay = remaining / days
  return { days, perWeek: round(perDay * 7), perTwoWeeks: round(perDay * 14), perMonth: round(perDay * (365.25 / 12)) }
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** The one plain-language line under a goal ("You're $1,200 away from your savings goal."). */
export function goalLine(kind: GoalKind, label: string, p: GoalProgress): string {
  if (kind === 'savings') return p.reached ? 'You reached your savings goal.' : `You're ${money(p.remaining)} away from your savings goal.`
  if (kind === 'credit') {
    const gained = p.moved > 0 ? `Your reported credit score has improved by ${Math.round(p.moved)} point${Math.round(p.moved) === 1 ? '' : 's'}.` : 'Report your newest score to track your progress.'
    return p.reached ? `${gained} You reached your target.` : `${gained} ${Math.round(p.remaining)} to go.`
  }
  const paid = p.moved > 0 ? `You've paid down ${money(p.moved)} toward your ${label} goal.` : `Report a payment or your new balance on ${label}.`
  return p.reached ? `${paid} You reached your target.` : `${paid} ${money(p.remaining)} to go.`
}
