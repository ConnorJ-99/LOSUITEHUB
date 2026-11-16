// Buyer Readiness Plans' data (Connor, 2026-11-16; plan docs/plans/buyer-nurture.md
// Steps 4–5). Plans are rows (plan → actions → milestones); the database
// keeps an approved plan locked and only lets a person mark a milestone done.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { addDays } from '@/lib/closed/keyDates'
import { followUpFor, newKey, planPayload, type PlanDraft } from '@/lib/nurture/plan'
import { db, keys, unwrap } from './client'

export interface PlanRecord {
  id: string
  version: number
  status: 'draft' | 'approved' | 'superseded'
  source: 'ai' | 'starter'
  obstacles: string[]
  approvedAt: string | null
  updatedAt: string
  plan: PlanDraft
}

interface MilestoneRow { id: string; action_id: string | null; sort_order: number; title: string; measure: string | null; target_date: string | null; follow_up_date: string | null; status: 'outstanding' | 'done' }
interface ActionRow { id: string; sort_order: number; obstacle: string | null; title: string; why: string | null; steps: string[]; docs: string[]; status: 'not_started' | 'in_progress' | 'done' }
interface PlanRow { id: string; version: number; status: PlanRecord['status']; source: PlanRecord['source']; obstacles: string[]; intro: string | null; goal: string | null; review_on: string | null; approved_at: string | null; updated_at: string; actions: ActionRow[]; milestones: MilestoneRow[] }

const toMilestone = (m: MilestoneRow) => ({ key: m.id, id: m.id, title: m.title, measure: m.measure ?? '', targetDate: m.target_date, followUpDate: m.follow_up_date, status: m.status })

function toRecord(r: PlanRow): PlanRecord {
  const ms = [...r.milestones].sort((a, b) => a.sort_order - b.sort_order)
  return {
    id: r.id,
    version: r.version,
    status: r.status,
    source: r.source,
    obstacles: r.obstacles,
    approvedAt: r.approved_at,
    updatedAt: r.updated_at,
    plan: {
      intro: r.intro ?? '',
      goal: r.goal ?? '',
      reviewOn: r.review_on,
      actions: [...r.actions]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((a) => ({ key: a.id, id: a.id, obstacle: a.obstacle, title: a.title, why: a.why ?? '', steps: a.steps, docs: a.docs, status: a.status, milestones: ms.filter((m) => m.action_id === a.id).map(toMilestone) })),
      milestones: ms.filter((m) => !m.action_id).map(toMilestone),
    },
  }
}

const plansKey = (loanId: string) => ['readinessPlans', loanId] as const

/** Every plan version on the file, newest first; null before the script has run. */
export function useReadinessPlans(loanId: string) {
  return useQuery({
    queryKey: plansKey(loanId),
    retry: false,
    queryFn: async (): Promise<PlanRecord[] | null> => {
      const r = await db()
        .from('readiness_plans')
        .select('id, version, status, source, obstacles, intro, goal, review_on, approved_at, updated_at, actions:readiness_actions ( id, sort_order, obstacle, title, why, steps, docs, status ), milestones:readiness_milestones ( id, action_id, sort_order, title, measure, target_date, follow_up_date, status )')
        .eq('loan_id', loanId)
        .order('version', { ascending: false })
      if (r.error) return null
      return (r.data as PlanRow[]).map(toRecord)
    },
  })
}

function useInvalidate(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: plansKey(loanId) })
    void queryClient.invalidateQueries({ queryKey: ['pipeline'] })
  }
}

export function useSaveDraft(loanId: string) {
  const done = useInvalidate(loanId)
  return useMutation({
    mutationFn: async (v: { obstacles: string[]; plan: PlanDraft; source: 'ai' | 'starter'; aiRunId?: string | null }) =>
      unwrap<string>(await db().rpc('save_readiness_draft', { p_loan_id: loanId, p_obstacles: v.obstacles, p_plan: planPayload(v.plan), p_source: v.source, p_ai_run_id: v.aiRunId ?? null })),
    onSettled: done,
  })
}

export function useApprovePlan(loanId: string) {
  const done = useInvalidate(loanId)
  return useMutation({ mutationFn: async (planId: string) => void unwrap(await db().rpc('approve_readiness_plan', { p_plan_id: planId })), onSettled: done })
}

export function useRevisePlan(loanId: string) {
  const done = useInvalidate(loanId)
  return useMutation({ mutationFn: async (planId: string) => unwrap<string>(await db().rpc('revise_readiness_plan', { p_plan_id: planId })), onSettled: done })
}

/** Deletes an unapproved draft (approved plans are kept). */
export function useDiscardDraft(loanId: string) {
  const done = useInvalidate(loanId)
  return useMutation({ mutationFn: async (planId: string) => void unwrap(await db().from('readiness_plans').delete().eq('id', planId).eq('status', 'draft')), onSettled: done })
}

/** Only a person marks a milestone done (the database refuses the AI and timers). */
export function useSetMilestoneStatus(loanId: string) {
  const done = useInvalidate(loanId)
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'outstanding' | 'done' }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('readiness_milestones').update({ status }).eq('id', id).select('id'))
      if (!rows.length) throw new Error('You do not have permission to change this plan.')
    },
    onSettled: done,
  })
}

export function useSetActionStatus(loanId: string) {
  const done = useInvalidate(loanId)
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'not_started' | 'in_progress' | 'done' }) => void unwrap(await db().from('readiness_actions').update({ status }).eq('id', id).select('id')),
    onSettled: done,
  })
}

/** What the AI plan comes back as (supabase/functions/assistant/readinessPlan.ts). */
interface AiMilestone { title: string; measure: string; weeks: number }
interface AiPlan { intro: string; goal: string; actions: { obstacle: string | null; title: string; why: string; steps: string[]; docs: string[]; milestones: AiMilestone[] }[]; timeline: AiMilestone[]; reviewWeeks: number }

/** Turns the AI's weeks into dates (target, and a check-in 3 days before). */
export function aiPlanToDraft(ai: AiPlan, today: string): PlanDraft {
  const m = (x: AiMilestone) => {
    const target = addDays(today, x.weeks * 7)
    return { key: newKey(), title: x.title, measure: x.measure, targetDate: target, followUpDate: followUpFor(target, today) }
  }
  return {
    intro: ai.intro,
    goal: ai.goal,
    reviewOn: addDays(today, ai.reviewWeeks * 7),
    actions: ai.actions.map((a) => ({ key: newKey(), obstacle: a.obstacle, title: a.title, why: a.why, steps: a.steps, docs: a.docs, status: 'not_started', milestones: a.milestones.map(m) })),
    milestones: ai.timeline.map(m),
  }
}

/** Asks Opus 5.5 for a draft plan (one call); the loan officer edits and approves it. */
export async function draftPlanWithAi(loanId: string, facts: unknown): Promise<{ plan: AiPlan; runId: string }> {
  const { data, error } = await db().functions.invoke('assistant', { body: { task: 'readiness_plan', loanId, facts } })
  if (error) {
    const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
    throw new Error(detail?.error ?? 'The assistant could not draft the plan.')
  }
  return data as { plan: AiPlan; runId: string }
}

export const roadmapDocsKey = keys.documents
