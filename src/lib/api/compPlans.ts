import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CompFee, CompPlan } from '@/lib/calc/lenderComp'
import { useAuth } from '@/lib/auth/context'
import { db, num, unwrap } from './client'

/** A lender comp plan as saved (build plan Phase 5), with its notes. */
export interface SavedCompPlan extends CompPlan {
  notes: string | null
}

interface PlanRow {
  id: string
  lender_id: string
  comp_type: CompPlan['compType']
  comp_pct: unknown
  min_amount: unknown
  max_amount: unknown
  fees: CompFee[]
  effective_from: string
  effective_to: string | null
  program_ids: string[] | null
  notes: string | null
}

const toPlan = (r: PlanRow): SavedCompPlan => ({
  id: r.id,
  lenderId: r.lender_id,
  compType: r.comp_type,
  compPct: num(r.comp_pct) ?? 0,
  minAmount: num(r.min_amount),
  maxAmount: num(r.max_amount),
  fees: (r.fees ?? []).map((f) => ({ name: String(f.name ?? ''), amount: Number(f.amount) || 0, adds: f.adds === true })),
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  programIds: r.program_ids,
  notes: r.notes,
})

export const compPlansKey = ['compPlans'] as const

/** Every lender's comp plans (current and past), newest first. Everyone in the company reads them. */
export function useCompPlans() {
  return useQuery({
    queryKey: compPlansKey,
    queryFn: async () => unwrap<PlanRow[]>(await db().from('lender_comp_plans').select('*').order('effective_from', { ascending: false })).map(toPlan),
    retry: false,
  })
}

export type CompPlanDraft = Omit<SavedCompPlan, 'id'> & { id?: string }

export function useSaveCompPlan() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (p: CompPlanDraft) => {
      const row = {
        lender_id: p.lenderId,
        comp_type: p.compType,
        comp_pct: p.compPct,
        min_amount: p.minAmount,
        max_amount: p.maxAmount,
        fees: p.fees.filter((f) => f.name.trim() && f.amount > 0).map((f) => ({ name: f.name.trim(), amount: f.amount, adds: f.adds })),
        effective_from: p.effectiveFrom,
        effective_to: p.effectiveTo,
        program_ids: p.programIds?.length ? p.programIds : null,
        notes: p.notes?.trim() || null,
      }
      const r = p.id ? await db().from('lender_comp_plans').update(row).eq('id', p.id).select('id') : await db().from('lender_comp_plans').insert({ ...row, organization_id: orgId }).select('id')
      if (r.error) throw new Error(r.error.message)
      if (!(r.data as unknown[]).length) throw new Error('Only owners and admins can change comp plans.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: compPlansKey }),
  })
}

export function useDeleteCompPlan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const r = unwrap<{ id: string }[]>(await db().from('lender_comp_plans').delete().eq('id', id).select('id'))
      if (!r.length) throw new Error('Only owners and admins can delete comp plans.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: compPlansKey }),
  })
}
