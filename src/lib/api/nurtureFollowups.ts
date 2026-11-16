// Nurture check-ins, reported updates and Reassess (Connor, 2026-11-16; plan
// docs/plans/buyer-nurture.md Steps 6–8). Read on their own, so pages work
// before the nurture follow-ups script has run.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { NURTURE_SETTING_COLUMNS, nurtureSettingsFrom, type NurtureFollowupSettings, type NurtureUpdate } from '@/lib/nurture/followups'
import { db, keys, unwrap } from './client'

const updatesKey = (loanId: string) => ['nurtureUpdates', loanId] as const
const settingsKey = ['leadFollowups', 'settings', 'nurture'] as const

interface UpdateRow {
  id: string
  status: NurtureUpdate['status']
  source: NurtureUpdate['source']
  kind: NurtureUpdate['kind']
  summary: string | null
  suggested_next: string | null
  confidence: NurtureUpdate['confidence']
  milestone_id: string | null
  message_id: string | null
  created_at: string
  verified_at: string | null
}

/** The file's reported updates, newest first; null before the script has run. */
export function useNurtureUpdates(loanId: string) {
  return useQuery({
    queryKey: updatesKey(loanId),
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<NurtureUpdate[] | null> => {
      const r = await db()
        .from('nurture_updates')
        .select('id, status, source, kind, summary, suggested_next, confidence, milestone_id, message_id, created_at, verified_at')
        .eq('loan_id', loanId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (r.error) return null
      return (r.data as UpdateRow[]).map((u) => ({
        id: u.id,
        status: u.status,
        source: u.source,
        kind: u.kind,
        summary: u.summary,
        suggestedNext: u.suggested_next,
        confidence: u.confidence,
        milestoneId: u.milestone_id,
        messageId: u.message_id,
        createdAt: u.created_at,
        verifiedAt: u.verified_at,
      }))
    },
  })
}

function useRefresh(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: updatesKey(loanId) })
    void queryClient.invalidateQueries({ queryKey: ['readinessPlans', loanId] })
    void queryClient.invalidateQueries({ queryKey: ['pipeline'] })
  }
}

/** Verify an update (and, if asked, tick its milestone done as you). */
export function useVerifyUpdate(loanId: string) {
  const done = useRefresh(loanId)
  return useMutation({
    mutationFn: async ({ id, milestoneDone }: { id: string; milestoneDone: boolean }) => void unwrap(await db().rpc('verify_nurture_update', { p_id: id, p_milestone_done: milestoneDone })),
    onSettled: done,
  })
}

/** Change what an update says or which milestone it's about (before or after reading it yourself). */
export function useEditUpdate(loanId: string) {
  const done = useRefresh(loanId)
  return useMutation({
    mutationFn: async ({ id, ...v }: { id: string; summary: string; milestoneId: string | null; status?: 'unverified' | 'dismissed' }) => {
      const patch: Record<string, unknown> = { summary: v.summary.trim() || null, milestone_id: v.milestoneId }
      if (v.status) patch.status = v.status
      const rows = unwrap<{ id: string }[]>(await db().from('nurture_updates').update(patch).eq('id', id).select('id'))
      if (!rows.length) throw new Error('You do not have permission to change this file.')
    },
    onSettled: done,
  })
}

export function useDismissUpdate(loanId: string) {
  const done = useRefresh(loanId)
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('nurture_updates').update({ status: 'dismissed' }).eq('id', id).select('id'))
      if (!rows.length) throw new Error('You do not have permission to change this file.')
    },
    onSettled: done,
  })
}

/** Something they told you by phone or in person (starts unverified). */
export function useAddUpdate(loanId: string, organizationId: string) {
  const done = useRefresh(loanId)
  return useMutation({
    mutationFn: async (v: { summary: string; milestoneId: string | null; kind: NurtureUpdate['kind'] }) =>
      void unwrap(await db().from('nurture_updates').insert({ organization_id: organizationId, loan_id: loanId, source: 'typed', status: 'unverified', summary: v.summary.trim(), milestone_id: v.milestoneId, kind: v.kind }).select('id')),
    onSettled: done,
  })
}

/** Reassess for Prequalification: back to New lead (contacted). */
export function useReassess(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (note: string | null) => {
      const r = await db().rpc('reassess_nurture', { p_loan_id: loanId, p_note: note })
      if (r.error) throw new Error(/reassess_nurture/.test(r.error.message) ? 'Run the nurture follow-ups script in Supabase first.' : r.error.message)
    },
    onSettled: () => {
      for (const k of [keys.pipeline, keys.loan(loanId), keys.stageHistory(loanId), keys.contacts]) void queryClient.invalidateQueries({ queryKey: k })
      void queryClient.invalidateQueries({ queryKey: ['contactLoans'] })
      void queryClient.invalidateQueries({ queryKey: keys.today })
    },
  })
}

/** Before sending a check-in: the file must still be in Nurture. */
export async function stillInNurture(loanId: string): Promise<boolean> {
  const row = unwrap<{ stage: string } | null>(await db().from('loans').select('stage').eq('id', loanId).maybeSingle())
  return row?.stage === 'nurture'
}

/** Settings → Nurture check-ins; null before the script has run. */
export function useNurtureSettings() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: settingsKey,
    enabled: !!orgId,
    retry: false,
    queryFn: async () => {
      // With no settings row yet, the nurture table says whether the script has run.
      const installed = !(await db().from('nurture_updates').select('id').limit(1)).error
      if (!installed) return null
      return nurtureSettingsFrom(unwrap<Record<string, unknown> | null>(await db().from('lead_followup_settings').select('*').eq('organization_id', orgId!).maybeSingle()))
    },
  })
}

export function useSaveNurtureSettings() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (s: NurtureFollowupSettings) => {
      if (!orgId) throw new Error('Not signed in.')
      const row: Record<string, unknown> = { organization_id: orgId }
      for (const [field, column] of Object.entries(NURTURE_SETTING_COLUMNS) as [keyof NurtureFollowupSettings, string][]) row[column] = s[field]
      unwrap(await db().from('lead_followup_settings').upsert(row).select('organization_id'))
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['leadFollowups', 'settings'] }),
  })
}
