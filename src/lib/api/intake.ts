// The intake interview's data (LO Assistant step 4, Connor 2026-11-17;
// 20270217000000_intake_interviews.sql). Answers autosave from the page;
// the status changes only through submit_intake() (and step 5's review).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Answers } from '@/lib/intake/sections'
import { db, unwrap } from './client'

export type IntakeStatus = 'draft' | 'submitted' | 'returned' | 'accepted'

export interface Intake {
  id: string
  organizationId: string
  loanId: string
  loUserId: string | null
  interviewerUserId: string | null
  interviewerName: string | null
  status: IntakeStatus
  answers: Answers
  summary: Record<string, unknown> | null
  partialReason: string | null
  submittedAt: string | null
  reviewedAt: string | null
  reviewNote: string | null
  updatedAt: string
}

type Row = {
  id: string
  organization_id: string
  loan_id: string
  lo_user_id: string | null
  interviewer_user_id: string | null
  interviewer: { full_name: string | null; email: string } | null
  status: IntakeStatus
  answers: Answers
  summary: Record<string, unknown> | null
  partial_reason: string | null
  submitted_at: string | null
  reviewed_at: string | null
  review_note: string | null
  updated_at: string
}

const toIntake = (r: Row): Intake => ({
  id: r.id,
  organizationId: r.organization_id,
  loanId: r.loan_id,
  loUserId: r.lo_user_id,
  interviewerUserId: r.interviewer_user_id,
  interviewerName: r.interviewer ? r.interviewer.full_name || r.interviewer.email : null,
  status: r.status,
  answers: r.answers ?? {},
  summary: r.summary,
  partialReason: r.partial_reason,
  submittedAt: r.submitted_at,
  reviewedAt: r.reviewed_at,
  reviewNote: r.review_note,
  updatedAt: r.updated_at,
})

export const intakeKey = (loanId: string) => ['intake', loanId] as const

/**
 * The file's latest intake interview (an open one first), null when there's none,
 * or 'not_installed' before the intake script has run.
 */
export function useIntake(loanId: string) {
  return useQuery({
    queryKey: intakeKey(loanId),
    retry: false,
    queryFn: async (): Promise<Intake | null | 'not_installed'> => {
      const r = await db()
        .from('intake_interviews')
        .select('*, interviewer:profiles!intake_interviews_interviewer_user_id_fkey ( full_name, email )')
        .eq('loan_id', loanId)
        .order('created_at', { ascending: false })
        .limit(5)
      if (r.error) {
        if (/intake_interviews/.test(r.error.message) && /(exist|find|schema cache)/i.test(r.error.message)) return 'not_installed'
        throw new Error(r.error.message)
      }
      const rows = (r.data ?? []) as unknown as Row[]
      const open = rows.find((x) => x.status !== 'accepted') ?? rows[0]
      return open ? toIntake(open) : null
    },
  })
}

/** Whether you may start or run one on this file (its LO, an admin, or its LO Assistant for an LO they assist). */
export function useMayRunIntake(loanId: string) {
  return useQuery({
    queryKey: ['intake', loanId, 'mayRun'],
    retry: false,
    queryFn: async () => {
      const r = await db().rpc('may_run_intake', { p_loan_id: loanId })
      return !r.error && r.data === true
    },
  })
}

export function useStartIntake(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { organizationId: string; interviewerId: string; answers: Answers }) => {
      unwrap(await db().from('intake_interviews').insert({ organization_id: v.organizationId, loan_id: loanId, interviewer_user_id: v.interviewerId, answers: v.answers }).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: intakeKey(loanId) }),
  })
}

/** Autosave: only the answers. */
export async function saveIntakeAnswers(id: string, answers: Answers): Promise<void> {
  const rows = unwrap<{ id: string }[]>(await db().from('intake_interviews').update({ answers }).eq('id', id).select('id'))
  if (!rows.length) throw new Error("The intake wasn't saved: it may have been submitted, or it isn't yours.")
}

export function useSubmitIntake(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; partialReason: string | null }) => {
      unwrap(await db().rpc('submit_intake', { p_id: v.id, p_partial_reason: v.partialReason }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: intakeKey(loanId) }),
  })
}
