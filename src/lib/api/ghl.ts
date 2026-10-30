import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useAuth } from '@/lib/auth/context'
import { readSendHours, type SendHours } from '@/lib/messaging/sendHours'
import { db, unwrap } from './client'

// GoHighLevel connection (Phase 1, Connor 2026-10-29; docs/plans/ghl-messaging.md).
// The "ghl" Edge Function holds the token; the browser only ever sees results.

const ghlKeys = {
  status: ['ghl', 'status'] as const,
  check: (orgId: string) => ['ghl', 'check', orgId] as const,
  links: ['ghl', 'links'] as const,
  lastCheck: ['ghl', 'lastCheck'] as const,
  settings: ['ghl', 'settings'] as const,
}

export interface GhlStatus {
  ready: boolean
  /** Why not: the secrets aren't added yet, or the function can't be reached (not deployed). */
  reason?: 'not_set_up' | 'unreachable'
}

/**
 * Whether GHL features can run, like useAiStatus: nothing else in the app
 * depends on GHL, so message features ask this first and say what's missing.
 * No GHL call is made.
 */
export function useGhlStatus() {
  return useQuery({
    queryKey: ghlKeys.status,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<GhlStatus> => {
      const { error } = await db().functions.invoke('ghl', { body: { task: 'status' } })
      if (!error) return { ready: true }
      if (error instanceof FunctionsHttpError) {
        const detail = await error.context.json().catch(() => null)
        if (String(detail?.error ?? '').includes('not set up yet')) return { ready: false, reason: 'not_set_up' }
        // 404 = the function isn't deployed; anything else means it answered.
        return error.context.status === 404 ? { ready: false, reason: 'unreachable' } : { ready: true }
      }
      return { ready: false, reason: 'unreachable' }
    },
  })
}

/** Calls the "ghl" Edge Function. Its errors are plain English, so they're passed through as-is. */
async function invokeGhl<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await db().functions.invoke<T>('ghl', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null)
      throw new Error(detail?.error ?? fallback)
    }
    throw new Error(fallback)
  }
  return data as T
}

export type CheckResult = 'works' | 'missing_scope' | 'bad_token' | 'failed'

export interface GhlCheck {
  key: string
  label: string
  scope: string
  result: CheckResult
  httpStatus: number | null
  detail: string
}

export interface GhlUser {
  id: string
  name: string
  email: string | null
  phone: string | null
  ghlNumber: string | null
  role: string | null
}

export interface GhlNumber {
  number: string
  name: string | null
  isDefault: boolean
  assignedUserId: string | null
  type: string | null
}

export interface GhlCheckResult {
  location: { name: string | null; timezone: string | null } | null
  users: GhlUser[]
  numbers: GhlNumber[]
  checks: GhlCheck[]
  missingScopes: string[]
  tokenRejected: boolean
  linksChecked: number
  logError: string | null
}

function useOrgId() {
  const { state } = useAuth()
  return state.status === 'signedIn' ? state.user.organizationId : null
}

/**
 * The connection check: what the token can do, the GHL users and numbers,
 * and every linked number re-confirmed. Owners and admins only; runs when
 * Settings opens (at most every 10 minutes) and on "Check connection".
 */
export function useGhlCheck(enabled: boolean) {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ghlKeys.check(orgId ?? ''),
    enabled: enabled && !!orgId,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await invokeGhl<GhlCheckResult>({ task: 'token_check', organizationId: orgId }, 'The GHL check did not finish.')
      // Links were just re-confirmed, and the check was logged.
      queryClient.invalidateQueries({ queryKey: ghlKeys.links })
      queryClient.invalidateQueries({ queryKey: ghlKeys.lastCheck })
      return result
    },
  })
}

export interface GhlLink {
  id: string
  profileId: string
  ghlUserId: string
  ghlName: string | null
  ghlEmail: string | null
  ghlNumber: string | null
  /** When GHL last showed ghlNumber assigned to this user; null = not confirmed, nothing texts from it. */
  numberConfirmedAt: string | null
  checkedAt: string
}

/** Team members' GHL users. Everyone in the company can see them. */
export function useGhlLinks() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ghlKeys.links,
    enabled: !!orgId,
    queryFn: async () => {
      const rows = unwrap<
        { id: string; profile_id: string; ghl_user_id: string; ghl_name: string | null; ghl_email: string | null; ghl_number: string | null; number_confirmed_at: string | null; checked_at: string }[]
      >(await db().from('ghl_user_links').select('id, profile_id, ghl_user_id, ghl_name, ghl_email, ghl_number, number_confirmed_at, checked_at').eq('organization_id', orgId!))
      return rows.map(
        (r): GhlLink => ({
          id: r.id,
          profileId: r.profile_id,
          ghlUserId: r.ghl_user_id,
          ghlName: r.ghl_name,
          ghlEmail: r.ghl_email,
          ghlNumber: r.ghl_number,
          numberConfirmedAt: r.number_confirmed_at,
          checkedAt: r.checked_at,
        }),
      )
    },
  })
}

/** When the connection was last checked (owners and admins; others see nothing). */
export function useLastGhlCheck() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ghlKeys.lastCheck,
    enabled: !!orgId,
    queryFn: async () => {
      const rows = unwrap<{ called_at: string }[]>(
        await db().from('ghl_calls').select('called_at').eq('organization_id', orgId!).eq('task', 'token_check').order('called_at', { ascending: false }).limit(1),
      )
      return rows[0]?.called_at ?? null
    },
  })
}

/** Links a team member to a GHL user; the function confirms the number with GHL first. */
export function useLinkGhlUser() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { profileId: string; ghlUserId: string }) =>
      invokeGhl<{ link: { ghl_name: string | null; ghl_number: string | null; number_confirmed_at: string | null }; logError: string | null }>(
        { task: 'link_user', organizationId: orgId, ...v },
        'The link was not saved.',
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ghlKeys.links }),
  })
}

export function useUnlinkGhlUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from('ghl_user_links').delete().eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('Only owners and admins can unlink someone.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ghlKeys.links }),
  })
}

export interface MessagingSettings {
  sendHours: SendHours
  timeZone: string
  /** mps.mortgage verified for sending in GHL: yes = LOs email from their own address, no = info@mps.mortgage. */
  emailDomainVerified: boolean
  /** Test mode: only people named TEST are sent to or saved from GHL (switched to all at cutover). */
  testMode: boolean
  /** False when the company has no saved row yet (defaults apply). */
  saved: boolean
}

export function useMessagingSettings() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ghlKeys.settings,
    enabled: !!orgId,
    queryFn: async (): Promise<MessagingSettings> => {
      const row = unwrap<{ send_hours: unknown; time_zone: string; email_domain_verified: boolean; inbound_mode: string | null } | null>(
        await db().from('messaging_settings').select('send_hours, time_zone, email_domain_verified, inbound_mode').eq('organization_id', orgId!).maybeSingle(),
      )
      return {
        sendHours: readSendHours(row?.send_hours),
        timeZone: row?.time_zone ?? 'America/Chicago',
        emailDomainVerified: row?.email_domain_verified ?? false,
        testMode: (row?.inbound_mode ?? 'test_only') === 'test_only',
        saved: !!row,
      }
    },
  })
}

export function useSaveMessagingSettings() {
  const orgId = useOrgId()
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { sendHours?: SendHours; emailDomainVerified?: boolean }) => {
      const row = {
        organization_id: orgId,
        updated_by: userId,
        ...(v.sendHours ? { send_hours: v.sendHours } : {}),
        ...(v.emailDomainVerified === undefined ? {} : { email_domain_verified: v.emailDomainVerified }),
      }
      const rows = unwrap<{ organization_id: string }[]>(await db().from('messaging_settings').upsert(row, { onConflict: 'organization_id' }).select('organization_id'))
      if (rows.length === 0) throw new Error('Only owners and admins can change sending settings.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ghlKeys.settings }),
  })
}
