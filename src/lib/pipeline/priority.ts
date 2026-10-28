// The editorial theme's priority color for a list card (Connor, 2026-10-27):
// the left border is orange-red when a task is overdue or due today, navy when
// one is due in the next 7 days, sage green for a file in Nurture, and plain
// otherwise. Pure.

import type { PipelineStage } from './stages'

export type PriorityTone = 'urgent' | 'week' | 'nurture' | null

/** Tasks due within this many days count as "this week". */
export const WEEK_DAYS = 7

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** From the file's open tasks (due dates as YYYY-MM-DD) and its stage. */
export function priorityTone(openDueDates: (string | null)[], stage: PipelineStage | null, today: string): PriorityTone {
  const due = openDueDates.filter((d): d is string => !!d)
  if (due.some((d) => d <= today)) return 'urgent'
  if (due.some((d) => d <= addDays(today, WEEK_DAYS))) return 'week'
  if (stage === 'nurture') return 'nurture'
  return null
}

/** The Tailwind class for a card's left border in that tone. */
export const TONE_BORDER: Record<Exclude<PriorityTone, null>, string> = {
  urgent: 'border-l-4 border-l-urgent',
  week: 'border-l-4 border-l-week',
  nurture: 'border-l-4 border-l-nurture',
}

export const toneBorder = (tone: PriorityTone) => (tone ? TONE_BORDER[tone] : '')
