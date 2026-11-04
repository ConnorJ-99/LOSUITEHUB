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
  pipelines: ['ghl', 'pipelines'] as const,
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
  /** How many assistant bulk messages one loan officer may approve a day (Settings → Sending). */
  bulkDailyCap: number
  /** False when the company has no saved row yet (defaults apply). */
  saved: boolean
  /** Where a closed client's GHL opportunity goes (decision 2: "Closed" / "Recently Closed"); null = not picked yet. */
  closedStage: PipelineStageChoice | null
  /** Where it goes back to when a closed client starts a new loan; null = not picked yet. */
  comebackStage: PipelineStageChoice | null
  /** The last time GHL was checked for new messages (the 10-minute scheduler, or Check for new messages). */
  lastSyncedAt: string | null
}

/** A GHL pipeline and stage, with the names as GHL had them when picked. */
export interface PipelineStageChoice {
  pipelineId: string
  stageId: string
  label: string | null
}

const choice = (pipelineId: string | null, stageId: string | null, label: string | null): PipelineStageChoice | null =>
  pipelineId && stageId ? { pipelineId, stageId, label } : null

export function useMessagingSettings() {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ghlKeys.settings,
    enabled: !!orgId,
    queryFn: async (): Promise<MessagingSettings> => {
      const row = unwrap<
        | ({ send_hours: unknown; time_zone: string; email_domain_verified: boolean; inbound_mode: string | null; last_synced_at: string | null; bulk_daily_cap: number | null } & Record<
            'closed_pipeline_id' | 'closed_stage_id' | 'closed_label' | 'comeback_pipeline_id' | 'comeback_stage_id' | 'comeback_label',
            string | null
          >)
        | null
      >(
        await db()
          .from('messaging_settings')
          .select('send_hours, time_zone, email_domain_verified, inbound_mode, last_synced_at, bulk_daily_cap, closed_pipeline_id, closed_stage_id, closed_label, comeback_pipeline_id, comeback_stage_id, comeback_label')
          .eq('organization_id', orgId!)
          .maybeSingle(),
      )
      return {
        sendHours: readSendHours(row?.send_hours),
        timeZone: row?.time_zone ?? 'America/Chicago',
        emailDomainVerified: row?.email_domain_verified ?? false,
        testMode: (row?.inbound_mode ?? 'test_only') === 'test_only',
        bulkDailyCap: row?.bulk_daily_cap ?? 250,
        saved: !!row,
        closedStage: choice(row?.closed_pipeline_id ?? null, row?.closed_stage_id ?? null, row?.closed_label ?? null),
        comebackStage: choice(row?.comeback_pipeline_id ?? null, row?.comeback_stage_id ?? null, row?.comeback_label ?? null),
        lastSyncedAt: row?.last_synced_at ?? null,
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
    mutationFn: async (v: { sendHours?: SendHours; emailDomainVerified?: boolean; closedStage?: PipelineStageChoice; comebackStage?: PipelineStageChoice; bulkDailyCap?: number }) => {
      const row = {
        organization_id: orgId,
        updated_by: userId,
        ...(v.sendHours ? { send_hours: v.sendHours } : {}),
        ...(v.emailDomainVerified === undefined ? {} : { email_domain_verified: v.emailDomainVerified }),
        ...(v.bulkDailyCap === undefined ? {} : { bulk_daily_cap: v.bulkDailyCap }),
        ...(v.closedStage ? { closed_pipeline_id: v.closedStage.pipelineId, closed_stage_id: v.closedStage.stageId, closed_label: v.closedStage.label } : {}),
        ...(v.comebackStage ? { comeback_pipeline_id: v.comebackStage.pipelineId, comeback_stage_id: v.comebackStage.stageId, comeback_label: v.comebackStage.label } : {}),
      }
      const rows = unwrap<{ organization_id: string }[]>(await db().from('messaging_settings').upsert(row, { onConflict: 'organization_id' }).select('organization_id'))
      if (rows.length === 0) throw new Error('Only owners and admins can change sending settings.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ghlKeys.settings }),
  })
}

/** What turning test mode off would skip (drafts waiting in the Action Queue, approvals not yet sent). */
export async function testModeOffPreview(organizationId: string): Promise<{ drafts: number; approvals: number }> {
  const rows = unwrap<{ drafts: number; approvals: number }[]>(await db().rpc('test_mode_off_preview', { p_organization_id: organizationId }))
  return rows[0] ?? { drafts: 0, approvals: 0 }
}

/**
 * Turns test mode on or off (owners and admins). Turning it off makes MPS HQ
 * live for everyone, and the database marks everything waiting from test mode
 * as skipped: nothing is sent.
 */
export function useSetTestMode() {
  const orgId = useOrgId()
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (testMode: boolean) => {
      const rows = unwrap<{ organization_id: string }[]>(
        await db().from('messaging_settings').update({ inbound_mode: testMode ? 'test_only' : 'all', updated_by: userId }).eq('organization_id', orgId!).select('organization_id'),
      )
      if (rows.length === 0) throw new Error('Run Check connection in Settings → GoHighLevel first. Only owners and admins can change test mode.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ghl'] }),
  })
}

export interface GhlPipeline {
  id: string
  name: string
  stages: { id: string; name: string }[]
}

/** GHL's pipelines and stages for the Settings picker (owners and admins), loaded when asked. */
export function useGhlPipelines(enabled: boolean) {
  const orgId = useOrgId()
  return useQuery({
    queryKey: ghlKeys.pipelines,
    enabled: enabled && !!orgId,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () =>
      invokeGhl<{ pipelines: GhlPipeline[]; suggestedClosed: { pipelineId: string; stageId: string } | null; logError: string | null }>(
        { task: 'pipelines', organizationId: orgId },
        "GHL's pipelines could not be loaded.",
      ),
  })
}

/** What happened to the borrower's GHL opportunity. `skipped` = GHL wasn't changed, and why. */
export type OpportunityResult =
  | { skipped: string }
  | { moved: true; created: boolean; contactCreated: boolean; to: string | null; otherOpportunities: number }

/**
 * Moves the file's borrower's one GHL opportunity: "closed" when the loan
 * closes, "comeback" when a closed client starts a new loan (decision 3).
 */
export function moveGhlOpportunity(organizationId: string, loanId: string, move: 'closed' | 'comeback') {
  return invokeGhl<OpportunityResult>({ task: 'opportunity', organizationId, loanId, move }, 'The GHL opportunity was not moved.')
}

/** What happened to the borrower's GHL contact. `skipped` = GHL wasn't changed, and why. */
export type ContactLinkResult = { skipped: string } | { linked: true; created: boolean }

/** Matches or creates the borrower's GHL contact, assigned to the file's loan officer (prequal results, decision 7). */
export function linkGhlContact(organizationId: string, loanId: string, contactId: string) {
  return invokeGhl<ContactLinkResult>({ task: 'contact', organizationId, loanId, contactId }, 'The GHL contact was not matched or added.')
}
