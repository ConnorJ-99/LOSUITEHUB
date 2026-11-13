import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CompSnapshot } from '@/lib/calc/loanComp'
import { useAuth } from '@/lib/auth/context'
import { db, keys, num, unwrap } from './client'

/** The company's comp settings (build plan Phase 5). Defaults until saved. */
export interface CompSettings {
  baseMode: CompSnapshot['baseMode']
  baseBps: number | null
  companySplitPct: number
  selfSplitPct: number
}

export const DEFAULT_COMP: CompSettings = { baseMode: 'revenue', baseBps: null, companySplitPct: 35.25, selfSplitPct: 70.25 }
const settingsKey = ['compSettings'] as const

export function useCompSettings() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: settingsKey,
    enabled: !!orgId,
    retry: false,
    queryFn: async (): Promise<CompSettings> => {
      const r = unwrap<{ base_mode: CompSettings['baseMode']; base_bps: unknown; company_split_pct: unknown; self_split_pct: unknown } | null>(await db().from('comp_settings').select('*').eq('organization_id', orgId!).maybeSingle())
      return r ? { baseMode: r.base_mode, baseBps: num(r.base_bps), companySplitPct: num(r.company_split_pct) ?? DEFAULT_COMP.companySplitPct, selfSplitPct: num(r.self_split_pct) ?? DEFAULT_COMP.selfSplitPct } : DEFAULT_COMP
    },
  })
}

export function useSaveCompSettings() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (s: CompSettings) => {
      const row = { organization_id: orgId, base_mode: s.baseMode, base_bps: s.baseMode === 'loan_bps' ? s.baseBps : null, company_split_pct: s.companySplitPct, self_split_pct: s.selfSplitPct }
      const r = unwrap<{ organization_id: string }[]>(await db().from('comp_settings').upsert(row).select('organization_id'))
      if (!r.length) throw new Error('Only owners and admins can change compensation settings.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKey }),
  })
}

/** Each team member's comp type (commission or salary-only). */
export function useMemberCompTypes() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: ['memberCompTypes'],
    enabled: !!orgId,
    retry: false,
    queryFn: async () => new Map(unwrap<{ user_id: string; comp_type: 'commission' | 'salary' }[]>(await db().from('organization_members').select('user_id, comp_type').eq('organization_id', orgId!)).map((r) => [r.user_id, r.comp_type])),
  })
}

export function useSetMemberCompType() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async ({ userId, compType }: { userId: string; compType: 'commission' | 'salary' }) => {
      const r = unwrap<{ user_id: string }[]>(await db().from('organization_members').update({ comp_type: compType }).eq('organization_id', orgId!).eq('user_id', userId).select('user_id'))
      if (!r.length) throw new Error('Only owners and admins can change comp types.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memberCompTypes'] }),
  })
}

/** Recent changes to the comp settings (owners and admins). */
export function useCompSettingsLog() {
  return useQuery({
    queryKey: ['compSettingsLog'],
    retry: false,
    queryFn: async () =>
      unwrap<{ id: string; what: string; old_value: string | null; new_value: string | null; changed_at: string; by: { full_name: string | null; email: string } | null }[]>(
        await db().from('comp_settings_log').select('id, what, old_value, new_value, changed_at, by:profiles!comp_settings_log_changed_by_fkey(full_name, email)').order('changed_at', { ascending: false }).limit(20),
      ),
  })
}

/** A closed loan's lead source and comp snapshot (owners and admins change them; each change is logged). */
export interface LoanCompFields {
  leadSourceType: 'company' | 'self' | null
  snapshot: CompSnapshot | null
  snapshotAt: string | null
}

export function useLoanCompFields(loanId: string) {
  return useQuery({
    queryKey: ['loanComp', loanId],
    retry: false,
    queryFn: async (): Promise<LoanCompFields> => {
      const r = unwrap<{ lead_source_type: LoanCompFields['leadSourceType']; comp_base_mode: CompSnapshot['baseMode'] | null; comp_base_bps: unknown; comp_split_pct: unknown; comp_member_type: CompSnapshot['memberType'] | null; comp_snapshot_at: string | null }>(
        await db().from('loans').select('lead_source_type, comp_base_mode, comp_base_bps, comp_split_pct, comp_member_type, comp_snapshot_at').eq('id', loanId).single(),
      )
      const split = num(r.comp_split_pct)
      return {
        leadSourceType: r.lead_source_type,
        snapshot: r.comp_base_mode && split != null ? { baseMode: r.comp_base_mode, baseBps: num(r.comp_base_bps), splitPct: split, memberType: r.comp_member_type ?? 'commission' } : null,
        snapshotAt: r.comp_snapshot_at,
      }
    },
  })
}

export function useSaveLoanComp(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (f: { leadSourceType: 'company' | 'self'; snapshot: CompSnapshot }) => {
      const r = unwrap<{ id: string }[]>(
        await db()
          .from('loans')
          .update({ lead_source_type: f.leadSourceType, comp_base_mode: f.snapshot.baseMode, comp_base_bps: f.snapshot.baseMode === 'loan_bps' ? f.snapshot.baseBps : null, comp_split_pct: f.snapshot.splitPct, comp_member_type: f.snapshot.memberType })
          .eq('id', loanId)
          .select('id'),
      )
      if (!r.length) throw new Error('Only owners and admins can change the comp on a loan.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loanComp', loanId] })
      queryClient.invalidateQueries({ queryKey: ['loanChanges', loanId] })
      queryClient.invalidateQueries({ queryKey: keys.closedLoans })
      queryClient.invalidateQueries({ queryKey: ['register'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Confirming a closed loan's commission (2026-11-13, 20270122000000)
// ---------------------------------------------------------------------------

export interface CompConfirmation {
  confirmedAt: string | null
  confirmedBy: string | null
  paidOn: string | null
}

/** null = the commission confirmation script hasn't run yet (the panel works without it). */
export function useCompConfirmation(loanId: string) {
  return useQuery({
    queryKey: ['compConfirmation', loanId],
    retry: false,
    queryFn: async (): Promise<CompConfirmation | null> => {
      const r = await db().from('loans').select('comp_confirmed_at, comp_paid_on, confirmer:profiles!loans_comp_confirmed_by_fkey ( full_name, email )').eq('id', loanId).single()
      if (r.error) return null
      const x = r.data as unknown as { comp_confirmed_at: string | null; comp_paid_on: string | null; confirmer: { full_name: string | null; email: string } | null }
      return { confirmedAt: x.comp_confirmed_at, confirmedBy: x.confirmer ? x.confirmer.full_name || x.confirmer.email : null, paidOn: x.comp_paid_on }
    },
  })
}

/** Confirm (locks the numbers), unlock (also clears paid on), or set the paid-on date. */
export function useSetCompConfirmation(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { confirmed: boolean } | { paidOn: string | null }) => {
      const changes = 'confirmed' in v ? (v.confirmed ? { comp_confirmed_at: new Date().toISOString() } : { comp_confirmed_at: null, comp_paid_on: null }) : { comp_paid_on: v.paidOn }
      const r = unwrap<{ id: string }[]>(await db().from('loans').update(changes).eq('id', loanId).select('id'))
      if (!r.length) throw new Error('Only owners and admins can confirm a commission.')
    },
    onSettled: () => {
      for (const k of [['compConfirmation', loanId], ['loanChanges', loanId], ['register'], keys.closedLoans]) queryClient.invalidateQueries({ queryKey: k })
    },
  })
}
