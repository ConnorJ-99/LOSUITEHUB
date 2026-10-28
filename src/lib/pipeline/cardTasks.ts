// Open tasks under a pipeline card (Pipeline v2 step 4, like Connor's old
// app): the next two by due date, then "+N more". Pure.

import type { Task } from '@/lib/api/types'

/** How many tasks show on a card. */
export const CARD_TASKS = 2

export interface CardTask {
  task: Task
  /** Due before today. */
  overdue: boolean
  dueToday: boolean
  /** "Overdue · Mon, Oct 12", "Today", "Thu, Oct 29" or "No due date". */
  when: string
}

const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))

/** The tasks to show (already sorted: soonest due first, undated last) and how many more there are. */
export function cardTasks(open: Task[], today: string): { shown: CardTask[]; more: number } {
  const shown = open.slice(0, CARD_TASKS).map((task): CardTask => {
    const overdue = !!task.dueOn && task.dueOn < today
    const dueToday = task.dueOn === today
    const when = !task.dueOn ? 'No due date' : overdue ? `Overdue · ${dayLabel(task.dueOn)}` : dueToday ? 'Today' : dayLabel(task.dueOn)
    return { task, overdue, dueToday, when }
  })
  return { shown, more: Math.max(0, open.length - CARD_TASKS) }
}
