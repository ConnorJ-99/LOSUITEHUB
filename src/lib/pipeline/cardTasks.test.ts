import { describe, expect, it } from 'vitest'
import { sortTasks } from '@/lib/api/tasks'
import type { Task } from '@/lib/api/types'
import { cardTasks } from './cardTasks'

const task = (id: string, dueOn: string | null): Task => ({ id, loanId: 'l1', title: `Task ${id}`, dueOn, completedAt: null, assignedTo: null, createdAt: '2026-10-01T00:00:00Z', sourceKey: null })
const today = '2026-10-27'

describe('tasks under a card', () => {
  it('shows the next two by due date, overdue first, then "+N more"', () => {
    const open = sortTasks([task('later', '2026-11-05'), task('none', null), task('today', '2026-10-27'), task('late', '2026-10-12')])
    const r = cardTasks(open, today)
    expect(r.shown.map((s) => [s.task.id, s.when, s.overdue, s.dueToday])).toEqual([
      ['late', 'Overdue · Mon, Oct 12', true, false],
      ['today', 'Today', false, true],
    ])
    expect(r.more).toBe(2)
  })
  it('later and undated tasks', () => {
    const r = cardTasks([task('later', '2026-10-29'), task('none', null)], today)
    expect(r.shown.map((s) => s.when)).toEqual(['Thu, Oct 29', 'No due date'])
    expect(r.more).toBe(0)
  })
  it('no tasks, nothing shown', () => {
    expect(cardTasks([], today)).toEqual({ shown: [], more: 0 })
  })
})
