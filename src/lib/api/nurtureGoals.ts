// Nurture goals from MPS-HQ's side (Phase 1, docs/plans/nurture-goals.md):
// read a file's goals and their history, add / edit / pause / remove, and
// verify (verify_nurture_goal(): the verified value, "complete", the file's
// credit score for a credit goal, its milestone ticked). Borrower updates
// come only through MyHome. Reads come back null before the script has run.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GoalKind } from '@/lib/calc/goals'
import { db, unwrap } from './client'

export type GoalStatus = 'not_started' | 'in_progress' | 'reported_complete' | 'verified_complete'
export type DebtType = 'credit_card' | 'auto' | 'installment' | 'student' | 'collection' | 'other'

export const DEBT_TYPE_LABEL: Record<DebtType, string> = {
  credit_card: 'Credit card',
  auto: 'Auto loan',
  installment: 'Installment loan',
  student: 'Student loan',
  collection: 'Collection',
  other: 'Other debt',
}

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  reported_complete: 'Borrower reported complete',
  verified_complete: 'Verified complete',
}

export interface NurtureGoal {
  id: string
  contactId: string
  kind: GoalKind
  label: string
  debtType: DebtType | null
  liabilityId: string | null
  milestoneId: string | null
  start: number
  target: number
  current: number | null
  currentAt: string | null
  verified: number | null
  verifiedAt: string | null
  targetDate: string | null
  status: GoalStatus
  paused: boolean
  /** A savings goal's accounts from the borrower's My assets (Phase 2); empty = typed by them. */
  followsAssets: string[]
}

export interface GoalUpdate {
  id: string
  goalId: string
  kind: string
  amount: number | null
  before: number | null
  after: number | null
  note: string | null
  happenedOn: string
  byBorrower: boolean
  createdAt: string
}

const num = (v: unknown) => (v == null ? null : Number(v))
const key = (loanId: string) => ['nurtureGoals', loanId] as const

export function useNurtureGoals(loanId: string) {
  return useQuery({
    queryKey: key(loanId),
    retry: false,
    queryFn: async (): Promise<{ goals: NurtureGoal[]; updates: GoalUpdate[] } | null> => {
      const [g, u] = await Promise.all([
        db().from('nurture_goals').select('*').eq('loan_id', loanId).order('sort_order').order('created_at'),
        db().from('nurture_goal_updates').select('id, goal_id, kind, amount, before_value, after_value, note, happened_on, account_id, created_at').eq('loan_id', loanId).order('created_at', { ascending: false }).limit(200),
      ])
      if (g.error || u.error) return null
      return {
        goals: (g.data as Record<string, unknown>[]).map((r) => ({
          id: r.id as string,
          contactId: r.contact_id as string,
          kind: r.kind as GoalKind,
          label: r.label as string,
          debtType: (r.debt_type as DebtType | null) ?? null,
          liabilityId: (r.liability_id as string | null) ?? null,
          milestoneId: (r.milestone_id as string | null) ?? null,
          start: Number(r.start_value),
          target: Number(r.target_value),
          current: num(r.current_value),
          currentAt: (r.current_at as string | null) ?? null,
          verified: num(r.verified_value),
          verifiedAt: (r.verified_at as string | null) ?? null,
          targetDate: (r.target_date as string | null) ?? null,
          status: r.status as GoalStatus,
          paused: r.paused as boolean,
          followsAssets: (r.follows_assets as string[] | null) ?? [],
        })),
        updates: (u.data as Record<string, unknown>[]).map((r) => ({
          id: r.id as string,
          goalId: r.goal_id as string,
          kind: r.kind as string,
          amount: num(r.amount),
          before: num(r.before_value),
          after: num(r.after_value),
          note: (r.note as string | null) ?? null,
          happenedOn: r.happened_on as string,
          byBorrower: r.account_id != null,
          createdAt: r.created_at as string,
        })),
      }
    },
  })
}

export interface GoalInput {
  kind: GoalKind
  label: string
  debtType: DebtType | null
  liabilityId: string | null
  milestoneId: string | null
  start: number
  target: number
  targetDate: string | null
}

function useGoalMutation<V>(loanId: string, fn: (v: V) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key(loanId) })
      queryClient.invalidateQueries({ queryKey: ['nurtureUpdates', loanId] })
    },
  })
}

export const useAddGoal = (loanId: string, organizationId: string, contactId: string) =>
  useGoalMutation<GoalInput>(loanId, async (v) => {
    unwrap(
      await db()
        .from('nurture_goals')
        .insert({
          organization_id: organizationId,
          loan_id: loanId,
          contact_id: contactId,
          kind: v.kind,
          label: v.label.trim(),
          debt_type: v.kind === 'debt' ? v.debtType : null,
          liability_id: v.kind === 'debt' ? v.liabilityId : null,
          milestone_id: v.milestoneId,
          start_value: v.start,
          target_value: v.target,
          target_date: v.targetDate,
        })
        .select('id'),
    )
  })

/** Edits what the LO controls: label, target, target date, milestone, paused. */
export const useEditGoal = (loanId: string) =>
  useGoalMutation<{ id: string; label?: string; target?: number; targetDate?: string | null; milestoneId?: string | null; paused?: boolean }>(loanId, async (v) => {
    unwrap(
      await db()
        .from('nurture_goals')
        .update({
          ...(v.label !== undefined && { label: v.label.trim() }),
          ...(v.target !== undefined && { target_value: v.target }),
          ...(v.targetDate !== undefined && { target_date: v.targetDate }),
          ...(v.milestoneId !== undefined && { milestone_id: v.milestoneId }),
          ...(v.paused !== undefined && { paused: v.paused }),
        })
        .eq('id', v.id)
        .select('id'),
    )
  })

export const useRemoveGoal = (loanId: string) =>
  useGoalMutation<string>(loanId, async (id) => {
    unwrap(await db().from('nurture_goals').delete().eq('id', id).select('id'))
  })

export const useVerifyGoal = (loanId: string) =>
  useGoalMutation<{ id: string; value: number | null; complete: boolean }>(loanId, async (v) => {
    unwrap(await db().rpc('verify_nurture_goal', { p_goal: v.id, p_value: v.value, p_complete: v.complete }))
  })

/** The approved plan's milestones (for "this goal completes a milestone"). */
export function usePlanMilestones(loanId: string) {
  return useQuery({
    queryKey: ['planMilestones', loanId],
    retry: false,
    queryFn: async (): Promise<{ id: string; title: string }[]> => {
      const r = await db().from('readiness_milestones').select('id, title, plan:readiness_plans!inner ( status )').eq('loan_id', loanId).eq('plan.status', 'approved').order('sort_order')
      if (r.error) return []
      return (r.data as unknown as { id: string; title: string }[]).map((m) => ({ id: m.id, title: m.title }))
    },
  })
}
