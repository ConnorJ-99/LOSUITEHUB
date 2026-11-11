import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Condition, ConditionParty, ConditionStatus } from '@/lib/loanfile/conditions'
import type { SelectedProgram } from '@/lib/conditions/facts'
import type { ProgramLimits } from '@/lib/conditions/suggest'
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
  source_key?: string | null
  document_request_id?: string | null
}

// * so the tab works before the suggested conditions script adds source_key.
const SELECT = '*'
const toCondition = (r: ConditionRow): Condition => ({
  id: r.id,
  position: r.position,
  body: r.body,
  party: r.party,
  status: r.status,
  dueOn: r.due_on,
  notes: r.notes,
  statusChangedAt: r.status_changed_at,
  sourceKey: r.source_key ?? null,
  documentRequestId: r.document_request_id ?? null,
})

/** A file's conditions, in list order (the Conditions tab, and the assistant). */
export async function fetchConditions(loanId: string): Promise<Condition[]> {
  return unwrap<ConditionRow[]>(await db().from('loan_conditions').select(SELECT).eq('loan_id', loanId).order('position').order('created_at')).map(toCondition)
}

/** A file's conditions, in list order. */
export function useConditions(loanId: string) {
  return useQuery({
    queryKey: keys.conditions(loanId),
    queryFn: () => fetchConditions(loanId),
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
    mutationFn: async ({ items, after }: { items: { body: string; party: ConditionParty; sourceKey?: string; documentRequestId?: string | null }[]; after: number }) => {
      if (!items.length) return
      unwrap(
        await db()
          .from('loan_conditions')
          .insert(
            items.map((c, i) => ({
              organization_id: organizationId,
              loan_id: loanId,
              body: c.body.trim(),
              party: c.party,
              position: after + i + 1,
              // Only sent for suggestions, so typed conditions work before the Phase 8 script.
              ...(c.sourceKey ? { source_key: c.sourceKey, document_request_id: c.documentRequestId ?? null } : {}),
            })),
          )
          .select('id'),
      )
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

// ---------------------------------------------------------------------------
// Suggested conditions (Phase 8): dismissals and the selected program's months
// ---------------------------------------------------------------------------

const dismissalKey = (loanId: string) => ['conditionDismissals', loanId] as const

/** Suggestion keys dismissed on this file. Empty before the Phase 8 script has run. */
export function useConditionDismissals(loanId: string) {
  return useQuery({
    queryKey: dismissalKey(loanId),
    retry: false,
    queryFn: async (): Promise<string[]> => {
      const r = await db().from('condition_dismissals').select('source_key').eq('loan_id', loanId)
      if (r.error) return []
      return (r.data as { source_key: string }[]).map((x) => x.source_key)
    },
  })
}

export function useDismissSuggestion(loanId: string, organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ key, undo }: { key: string; undo?: boolean }) => {
      if (undo) unwrap(await db().from('condition_dismissals').delete().eq('loan_id', loanId).eq('source_key', key).select('id'))
      else {
        const r = await db().from('condition_dismissals').insert({ organization_id: organizationId, loan_id: loanId, source_key: key }).select('id')
        if (r.error && r.error.code !== '23505') throw new Error(/condition_dismissals/.test(r.error.message) ? 'Run the suggested conditions script (20270112000000) in Supabase first.' : r.error.message)
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dismissalKey(loanId) }),
  })
}

interface ProgramRuleRow {
  field: string
  value: unknown
  source_page: number | null
  source_quote: string | null
  updated_at: string
}

/** The selected program's name, lender and statement months (with their citations). */
export function useSelectedProgram(programId: string | null) {
  return useQuery({
    queryKey: ['conditionProgram', programId],
    enabled: !!programId,
    queryFn: async (): Promise<SelectedProgram | null> => {
      const p = unwrap<{ id: string; name: string; lender_id: string } | null>(await db().from('programs').select('id, name, lender_id').eq('id', programId!).maybeSingle())
      if (!p) return null
      const rules = await db()
        .from('program_rules')
        .select('field, value, source_page, source_quote, updated_at')
        .eq('program_id', programId!)
        .in('field', ['bank_statement_months', 'asset_statement_months', 'tax_return_years'])
        .order('updated_at', { ascending: false })
      const limits: ProgramLimits = {}
      const names = { bank_statement_months: 'bankStatementMonths', asset_statement_months: 'assetStatementMonths', tax_return_years: 'taxReturnYears' } as const
      for (const r of (rules.data ?? []) as ProgramRuleRow[]) {
        const key = names[r.field as keyof typeof names]
        const value = Number(r.value)
        if (!key || limits[key] || !Number.isFinite(value) || value <= 0) continue
        const where = [r.source_page ? `p. ${r.source_page}` : null, r.source_quote ? `"${r.source_quote}"` : null].filter(Boolean).join(': ')
        limits[key] = { value, citation: where || null }
      }
      return { id: p.id, name: p.name, lenderId: p.lender_id, limits }
    },
  })
}
