import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReviewStatus } from '@/lib/closed/reviews'
import { DEFAULT_REVIEW_EMAIL, DEFAULT_REVIEW_SUBJECT, DEFAULT_REVIEW_TEXT } from '@/lib/closed/reviews'
import { todayIso } from '@/lib/dates'
import { useAuth } from '@/lib/auth/context'
import { db, keys, unwrap } from './client'

/** Settings → Reviews (build plan Phase 6). */
export interface ReviewSettingsForm {
  enabled: boolean
  companyLink: string
  secondLink: string
  daysAfter: number
  followUp: boolean
  followUpDays: number
  textTemplate: string
  emailSubject: string
  emailTemplate: string
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettingsForm = { enabled: false, companyLink: '', secondLink: '', daysAfter: 3, followUp: true, followUpDays: 7, textTemplate: DEFAULT_REVIEW_TEXT, emailSubject: DEFAULT_REVIEW_SUBJECT, emailTemplate: DEFAULT_REVIEW_EMAIL }

export function useReviewSettings() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: ['reviewSettings'],
    enabled: !!orgId,
    retry: false,
    queryFn: async (): Promise<ReviewSettingsForm> => {
      const r = unwrap<Record<string, unknown> | null>(await db().from('review_settings').select('*').eq('organization_id', orgId!).maybeSingle())
      if (!r) return DEFAULT_REVIEW_SETTINGS
      return {
        enabled: r.enabled === true,
        companyLink: (r.company_link as string | null) ?? '',
        secondLink: (r.second_link as string | null) ?? '',
        daysAfter: Number(r.days_after),
        followUp: r.follow_up === true,
        followUpDays: Number(r.follow_up_days),
        textTemplate: String(r.text_template),
        emailSubject: String(r.email_subject),
        emailTemplate: String(r.email_template),
      }
    },
  })
}

export function useSaveReviewSettings() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (s: ReviewSettingsForm) => {
      const row = {
        organization_id: orgId,
        enabled: s.enabled,
        company_link: s.companyLink.trim() || null,
        second_link: s.secondLink.trim() || null,
        days_after: s.daysAfter,
        follow_up: s.followUp,
        follow_up_days: s.followUpDays,
        text_template: s.textTemplate.trim(),
        email_subject: s.emailSubject.trim(),
        email_template: s.emailTemplate.trim(),
      }
      const r = unwrap<{ organization_id: string }[]>(await db().from('review_settings').upsert(row).select('organization_id'))
      if (!r.length) throw new Error('Only owners and admins can change review settings.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reviewSettings'] }),
  })
}

/** Your own review link (used instead of the company's on your files). */
export function useMyReviewLink() {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  return useQuery({
    queryKey: ['myReviewLink', me],
    enabled: !!me,
    retry: false,
    queryFn: async () => unwrap<{ review_link: string | null }>(await db().from('profiles').select('review_link').eq('id', me!).single()).review_link ?? '',
  })
}

export function useSaveMyReviewLink() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  return useMutation({
    mutationFn: async (link: string) => {
      unwrap(await db().from('profiles').update({ review_link: link.trim() || null }).eq('id', me!).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myReviewLink'] }),
  })
}

export interface LoanReview {
  status: ReviewStatus
  requestedAt: string | null
  receivedOn: string | null
  skip: boolean
  skipNote: string | null
}

export function useLoanReview(loanId: string) {
  return useQuery({
    queryKey: ['loanReview', loanId],
    retry: false,
    queryFn: async (): Promise<LoanReview> => {
      const r = unwrap<{ review_status: ReviewStatus; review_requested_at: string | null; review_received_on: string | null; review_skip: boolean; review_skip_note: string | null }>(
        await db().from('loans').select('review_status, review_requested_at, review_received_on, review_skip, review_skip_note').eq('id', loanId).single(),
      )
      return { status: r.review_status, requestedAt: r.review_requested_at, receivedOn: r.review_received_on, skip: r.review_skip, skipNote: r.review_skip_note }
    },
  })
}

const refresh = (queryClient: ReturnType<typeof useQueryClient>, loanId: string) => {
  for (const key of [['loanReview', loanId], keys.queue(loanId), keys.today, ['register'], ['loanChanges', loanId], ['reviewCounts']]) queryClient.invalidateQueries({ queryKey: key })
}

export function useReviewActions(loanId: string) {
  const queryClient = useQueryClient()
  return {
    request: useMutation({
      mutationFn: async () => unwrap<string>(await db().rpc('request_review', { p_loan_id: loanId })),
      onSettled: () => refresh(queryClient, loanId),
    }),
    received: useMutation({
      mutationFn: async (on: string | null) => unwrap(await db().rpc('mark_review_received', { p_loan_id: loanId, p_on: on ?? todayIso() })),
      onSettled: () => refresh(queryClient, loanId),
    }),
    skip: useMutation({
      mutationFn: async ({ skip, note }: { skip: boolean; note: string | null }) => {
        const r = unwrap<{ id: string }[]>(await db().from('loans').update({ review_skip: skip, review_skip_note: skip ? note?.trim() || null : null }).eq('id', loanId).select('id'))
        if (!r.length) throw new Error('You do not have permission to change this loan.')
      },
      onSettled: () => refresh(queryClient, loanId),
    }),
  }
}

/** "Reviews: X requested / Y received this month" (files you can see). */
export function useReviewCounts() {
  return useQuery({
    queryKey: ['reviewCounts'],
    retry: false,
    queryFn: async () => {
      const first = `${todayIso().slice(0, 7)}-01`
      const [asked, got] = await Promise.all([
        db().from('loans').select('id', { count: 'exact', head: true }).gte('review_requested_at', `${first}T06:00:00Z`),
        db().from('loans').select('id', { count: 'exact', head: true }).gte('review_received_on', first),
      ])
      if (asked.error || got.error) throw new Error((asked.error ?? got.error)!.message)
      return { requested: asked.count ?? 0, received: got.count ?? 0 }
    },
  })
}
