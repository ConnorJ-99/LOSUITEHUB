// Lead follow-ups' data (Connor, 2026-11-16): each waiting draft's priority and
// snooze, snoozing, the settings, and the check before sending. Read on their
// own, so Today and Settings work before the lead follow-ups script has run.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
import { DEFAULT_LEAD_FOLLOWUP_SETTINGS, SETTING_COLUMNS, type LeadFollowupSettings } from '@/lib/leads/followups'
import { isLeadStage } from '@/lib/leads/nextAction'
import { db, keys, unwrap } from './client'

const metaKey = ['leadFollowups', 'meta'] as const
const settingsKey = ['leadFollowups', 'settings'] as const

export interface LeadFollowupMeta {
  priority: 'high' | 'normal'
  snoozedUntil: string | null
}

/** Every waiting lead follow-up's priority and snooze; null before the script has run. */
export function useLeadFollowupMeta() {
  return useQuery({
    queryKey: metaKey,
    retry: false,
    queryFn: async () => {
      const r = await db().from('action_items').select('id, priority, snoozed_until').eq('source', 'lead_followup').eq('status', 'pending')
      if (r.error) return null
      return new Map((r.data as { id: string; priority: 'high' | 'normal'; snoozed_until: string | null }[]).map((x) => [x.id, { priority: x.priority, snoozedUntil: x.snoozed_until } satisfies LeadFollowupMeta]))
    },
  })
}

/** Hides a waiting follow-up until a day (null = show it again). */
export function useSnoozeFollowup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, until }: { id: string; until: string | null }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('action_items').update({ snoozed_until: until }).eq('id', id).eq('status', 'pending').select('id'))
      if (!rows.length) throw new Error('That follow-up was already decided.')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: metaKey })
      queryClient.invalidateQueries({ queryKey: keys.today })
    },
  })
}

/** Before sending: the file must still be a lead (else the draft is dismissed). */
export async function stillALead(loanId: string): Promise<boolean> {
  const row = unwrap<{ stage: string } | null>(await db().from('loans').select('stage').eq('id', loanId).maybeSingle())
  return !!row && isLeadStage(row.stage)
}

export function useLeadFollowupSettings() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: settingsKey,
    enabled: !!orgId,
    retry: false,
    queryFn: async (): Promise<LeadFollowupSettings> => {
      const r = unwrap<Record<string, unknown> | null>(await db().from('lead_followup_settings').select('*').eq('organization_id', orgId!).maybeSingle())
      if (!r) return DEFAULT_LEAD_FOLLOWUP_SETTINGS
      const out = { ...DEFAULT_LEAD_FOLLOWUP_SETTINGS, enabled: r.enabled === true }
      for (const [field, column] of Object.entries(SETTING_COLUMNS) as [keyof typeof SETTING_COLUMNS, string][]) out[field] = Number(r[column])
      return out
    },
  })
}

export function useSaveLeadFollowupSettings() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (f: LeadFollowupSettings) => {
      if (!orgId) throw new Error('Not signed in.')
      const row: Record<string, unknown> = { organization_id: orgId, enabled: f.enabled }
      for (const [field, column] of Object.entries(SETTING_COLUMNS) as [keyof typeof SETTING_COLUMNS, string][]) row[column] = f[field]
      unwrap(await db().from('lead_followup_settings').upsert(row).select('organization_id'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
  })
}
