import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Condition, ConditionParty, ConditionStatus } from '@/lib/loanfile/conditions'
import { db, keys, unwrap } from './client'

interface ConditionRow {
  id: string
  position: number
  body: string
  party: ConditionParty
  status: ConditionStatus
  due_on: string | null
  notes: string | null
  status_changed_at: string
}

const SELECT = 'id, position, body, party, status, due_on, notes, status_changed_at'
const toCondition = (r: ConditionRow): Condition => ({ id: r.id, position: r.position, body: r.body, party: r.party, status: r.status, dueOn: r.due_on, notes: r.notes, statusChangedAt: r.status_changed_at })

/** A file's conditions, in list order. */
export function useConditions(loanId: string) {
  return useQuery({
    queryKey: keys.conditions(loanId),
    queryFn: async () => unwrap<ConditionRow[]>(await db().from('loan_conditions').select(SELECT).eq('loan_id', loanId).order('position').order('created_at')).map(toCondition),
  })
}

function useInvalidate(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: keys.conditions(loanId) })
    // The pipeline cards show "X of Y cleared".
    queryClient.invalidateQueries({ queryKey: keys.pipeline })
  }
}

/** Adds conditions at the end of the list (one, or a pasted list split into rows). */
export function useAddConditions(loanId: string, organizationId: string) {
  const invalidate = useInvalidate(loanId)
  return useMutation({
    mutationFn: async ({ items, after }: { items: { body: string; party: ConditionParty }[]; after: number }) => {
      if (!items.length) return
      unwrap(await db().from('loan_conditions').insert(items.map((c, i) => ({ organization_id: organizationId, loan_id: loanId, body: c.body.trim(), party: c.party, position: after + i + 1 }))).select('id'))
    },
    onSuccess: invalidate,
  })
}

export type ConditionChanges = Partial<Pick<Condition, 'body' | 'party' | 'status' | 'dueOn' | 'notes'>>

export function useUpdateCondition(loanId: string) {
  const invalidate = useInvalidate(loanId)
  return useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: ConditionChanges }) => {
      const row = {
        ...(changes.body !== undefined ? { body: changes.body.trim() } : {}),
        ...(changes.party !== undefined ? { party: changes.party } : {}),
        ...(changes.status !== undefined ? { status: changes.status } : {}),
        ...(changes.dueOn !== undefined ? { due_on: changes.dueOn } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes?.trim() || null } : {}),
      }
      if (unwrap<{ id: string }[]>(await db().from('loan_conditions').update(row).eq('id', id).select('id')).length === 0) throw new Error('This condition was removed, or you do not have permission to change it.')
    },
    onSuccess: invalidate,
  })
}

export function useDeleteCondition(loanId: string) {
  const invalidate = useInvalidate(loanId)
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('loan_conditions').delete().eq('id', id).select('id'))
    },
    onSuccess: invalidate,
  })
}
