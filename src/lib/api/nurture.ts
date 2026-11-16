// Nurture data (Connor, 2026-11-16; plan docs/plans/buyer-nurture.md). Read
// on its own, so pages work before the nurture script has run.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NurtureStage } from '@/lib/nurture/obstacles'
import { db, keys, unwrap } from './client'

export interface NurtureFields {
  loanId: string
  stage: NurtureStage | null
  enteredAt: string | null
  obstacles: string[]
  target: string | null
  note: string | null
  nextFollowUp: string | null
  partnerStatus: string | null
}

interface Row {
  id: string
  nurture_stage: NurtureStage | null
  nurture_entered_at: string | null
  nurture_obstacles: string[] | null
  nurture_target: string | null
  nurture_note: string | null
  nurture_next_follow_up: string | null
  partner_status: string | null
}

const COLUMNS = 'id, nurture_stage, nurture_entered_at, nurture_obstacles, nurture_target, nurture_note, nurture_next_follow_up, partner_status'
const toFields = (r: Row): NurtureFields => ({
  loanId: r.id,
  stage: r.nurture_stage,
  enteredAt: r.nurture_entered_at,
  obstacles: r.nurture_obstacles ?? [],
  target: r.nurture_target,
  note: r.nurture_note,
  nextFollowUp: r.nurture_next_follow_up,
  partnerStatus: r.partner_status,
})

// Under ['pipeline'] so stage moves refresh them.
const boardKey = ['pipeline', 'nurture'] as const

/** One file's nurture fields; null before the script has run. */
export function useNurtureFields(loanId: string) {
  return useQuery({
    queryKey: [...boardKey, loanId],
    retry: false,
    queryFn: async () => {
      const r = await db().from('loans').select(COLUMNS).eq('id', loanId).maybeSingle()
      if (r.error) return null
      return r.data ? toFields(r.data as Row) : null
    },
  })
}

export interface NurtureBoardRow extends NurtureFields {
  /** Buyer's agents on the file (names). */
  realtors: string[]
}

/** Every Nurture file you can see, with its realtors; null before the script has run. */
export function useNurtureBoard() {
  return useQuery({
    queryKey: boardKey,
    retry: false,
    queryFn: async (): Promise<Map<string, NurtureBoardRow> | null> => {
      const r = await db().from('loans').select(`${COLUMNS}, team:loan_team_members ( role, name )`).eq('stage', 'nurture')
      if (r.error) return null
      return new Map(
        (r.data as (Row & { team: { role: string; name: string | null }[] | null })[]).map((x) => [
          x.id,
          { ...toFields(x), realtors: (x.team ?? []).filter((t) => t.role === 'buyer_agent' && t.name).map((t) => t.name!) },
        ]),
      )
    },
  })
}

/** "Move to Nurture" (and editing the obstacles while in Nurture): one database action. */
export function useMoveToNurture() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { loanId: string; obstacles: string[]; target: string | null; note: string | null; summary: string }) => {
      const r = await db().rpc('move_to_nurture', { p_loan_id: v.loanId, p_obstacles: v.obstacles, p_target: v.target, p_note: v.note, p_summary: v.summary })
      if (r.error) throw new Error(/move_to_nurture/.test(r.error.message) ? 'Run the nurture script in Supabase first.' : r.error.message)
    },
    onSettled: (_d, _e, v) => {
      for (const k of [keys.pipeline, keys.loan(v.loanId), keys.stageHistory(v.loanId), keys.contacts]) void queryClient.invalidateQueries({ queryKey: k })
      void queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
    },
  })
}

/** Changes the nurture stage or the next follow-up date. */
export function useUpdateNurture() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ loanId, ...patch }: { loanId: string; nurture_stage?: NurtureStage; nurture_next_follow_up?: string | null }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('loans').update(patch).eq('id', loanId).select('id'))
      if (!rows.length) throw new Error('You do not have permission to change this file.')
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: boardKey }),
  })
}
