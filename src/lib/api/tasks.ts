import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { fullName } from '@/lib/pipeline/helpers'
import { db, keys, unwrap } from './client'
import type { Task } from './types'

interface TaskRow {
  id: string
  loan_id: string
  title: string
  due_on: string | null
  completed_at: string | null
  created_at: string
  source_key: string | null
  assigned: { id: string; full_name: string | null; email: string } | null
}

const TASK_SELECT = 'id, loan_id, title, due_on, completed_at, created_at, source_key, assigned:profiles!tasks_assigned_to_fkey ( id, full_name, email )'

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    loanId: r.loan_id,
    title: r.title,
    dueOn: r.due_on,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    sourceKey: r.source_key,
    assignedTo: r.assigned ? { id: r.assigned.id, name: r.assigned.full_name || r.assigned.email } : null,
  }
}

/** Open tasks first (soonest due first, undated last), then completed ones. */
export function sortTasks<T extends Task>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (!!a.completedAt !== !!b.completedAt) return a.completedAt ? 1 : -1
    if (a.completedAt && b.completedAt) return b.completedAt.localeCompare(a.completedAt)
    return (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31') || a.createdAt.localeCompare(b.createdAt)
  })
}

export function useLoanTasks(loanId: string) {
  return useQuery({
    queryKey: keys.loanTasks(loanId),
    queryFn: async () => {
      const rows = unwrap<TaskRow[]>(await db().from('tasks').select(TASK_SELECT).eq('loan_id', loanId))
      return sortTasks(rows.map(toTask))
    },
  })
}

/** Every open task the user can see, grouped by loan (for the pipeline cards). Soonest due first. */
export function useOpenTasks() {
  return useQuery({
    queryKey: keys.openTasks,
    queryFn: async () => {
      const rows = unwrap<TaskRow[]>(await db().from('tasks').select(TASK_SELECT).is('completed_at', null))
      const byLoan = new Map<string, Task[]>()
      for (const t of sortTasks(rows.map(toTask))) byLoan.set(t.loanId, [...(byLoan.get(t.loanId) ?? []), t])
      return byLoan
    },
  })
}

export interface MyTask extends Task {
  borrowerName: string
}

/** Open tasks assigned to the signed-in user, for the dashboard. */
export function useMyOpenTasks() {
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null
  return useQuery({
    queryKey: keys.myTasks,
    enabled: !!userId,
    queryFn: async () => {
      const rows = unwrap<(TaskRow & { loan: { borrowers: { role: string; contact: { first_name: string; last_name: string } | null }[] } | null })[]>(
        await db()
          .from('tasks')
          .select(`${TASK_SELECT}, loan:loans!tasks_loan_id_fkey ( borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name ) ) )`)
          .eq('assigned_to', userId!)
          .is('completed_at', null),
      )
      const tasks = rows.map((row): MyTask => {
        const primary = row.loan?.borrowers.find((b) => b.role === 'primary')?.contact
        return {
          ...toTask(row),
          borrowerName: primary ? fullName({ firstName: primary.first_name, lastName: primary.last_name }) : 'No borrower',
        }
      })
      return sortTasks(tasks)
    },
  })
}

function useInvalidateTasks(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: keys.loanTasks(loanId) })
    queryClient.invalidateQueries({ queryKey: keys.myTasks })
    queryClient.invalidateQueries({ queryKey: keys.openTasks })
  }
}

export function useAddTask(loanId: string, organizationId: string) {
  const invalidate = useInvalidateTasks(loanId)
  return useMutation({
    mutationFn: async (input: { title: string; dueOn: string | null }) => {
      unwrap(
        await db()
          .from('tasks')
          .insert({ organization_id: organizationId, loan_id: loanId, title: input.title.trim(), due_on: input.dueOn || null })
          .select('id'),
      )
    },
    onSuccess: invalidate,
  })
}

export function useToggleTask(loanId: string) {
  const invalidate = useInvalidateTasks(loanId)
  return useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => {
      unwrap(await db().from('tasks').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id).select('id'))
    },
    onSuccess: invalidate,
  })
}

export function useDeleteTask(loanId: string) {
  const invalidate = useInvalidateTasks(loanId)
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('tasks').delete().eq('id', id))
    },
    onSuccess: invalidate,
  })
}
