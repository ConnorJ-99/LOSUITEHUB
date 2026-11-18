// Settings → Team: secondary roles, who each LO Assistant assists, and each
// person's link profile (Loan Officer Assistant step 1, Connor 2026-11-17).
// Read with * so the Team card still works before 20270214000000_loa_roles.sql
// has run (then `ready` is false and the new parts are hidden).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, type OrgRole } from '@/lib/auth/context'
import type { LinkProfile, SecondaryRole } from '@/lib/team/secondaryRoles'
import { db, keys, unwrap } from './client'

// Under orgMembers, so adding, changing or removing a member refreshes it too.
export const teamKeys = { access: [...keys.orgMembers, 'access'] as const }

export interface TeamMember extends LinkProfile {
  id: string
  name: string
  fullName: string | null
  email: string
  role: OrgRole
  secondaryRoles: SecondaryRole[]
  /** The loan officers this person assists (LO Assistant). */
  assists: string[]
}

export interface TeamAccess {
  /** False before the LO assistant roles script has run. */
  ready: boolean
  members: TeamMember[]
  assignments: { loaUserId: string; loUserId: string }[]
}

type ProfileRow = { id: string; email: string; full_name: string | null; nmls: string | null; booking_url?: string | null; display_name?: string | null; title?: string | null; bio_url?: string | null; application_url?: string | null }

export function useTeamAccess() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: [...teamKeys.access, orgId],
    enabled: !!orgId,
    queryFn: async (): Promise<TeamAccess> => {
      const rows = unwrap<{ role: OrgRole; secondary_roles?: SecondaryRole[]; profile: ProfileRow | null }[]>(
        await db().from('organization_members').select('*, profile:profiles ( * )').eq('organization_id', orgId!),
      )
      const ready = rows.some((r) => Array.isArray(r.secondary_roles))
      const a = ready ? await db().from('loa_assignments').select('loa_user_id, lo_user_id').eq('organization_id', orgId!) : null
      const assignments = ((a && !a.error ? a.data : []) as { loa_user_id: string; lo_user_id: string }[]).map((r) => ({ loaUserId: r.loa_user_id, loUserId: r.lo_user_id }))
      const members = rows
        .filter((r) => r.profile)
        .map((r): TeamMember => {
          const p = r.profile!
          return {
            id: p.id,
            name: p.full_name || p.email,
            fullName: p.full_name,
            email: p.email,
            role: r.role,
            secondaryRoles: r.secondary_roles ?? [],
            assists: assignments.filter((x) => x.loaUserId === p.id).map((x) => x.loUserId),
            displayName: p.display_name ?? null,
            title: p.title ?? null,
            nmls: p.nmls,
            applicationUrl: p.application_url ?? null,
            bookingUrl: p.booking_url ?? null,
            bioUrl: p.bio_url ?? null,
          }
        })
        .sort((x, y) => x.name.localeCompare(y.name))
      return { ready, members, assignments }
    },
  })
}

const invalidateTeam = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: teamKeys.access })
  queryClient.invalidateQueries({ queryKey: keys.orgMembers })
  queryClient.invalidateQueries({ queryKey: keys.myProfile })
}

/** Owners and admins: secondary roles and assignments in one step (set_member_access). */
export function useSetMemberAccess() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { userId: string; secondaryRoles: SecondaryRole[]; assists: string[] }) => {
      unwrap(await db().rpc('set_member_access', { p_user: v.userId, p_secondary: v.secondaryRoles, p_assists: v.assists }))
    },
    onSuccess: () => invalidateTeam(queryClient),
  })
}

/** A person's link profile: owners and admins for anyone, everyone for themselves (save_member_links). */
export function useSaveMemberLinks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { userId: string; links: LinkProfile }) => {
      const l = v.links
      unwrap(
        await db().rpc('save_member_links', {
          p_user: v.userId,
          p_links: { display_name: l.displayName, title: l.title, nmls: l.nmls, application_url: l.applicationUrl, booking_url: l.bookingUrl, bio_url: l.bioUrl },
        }),
      )
    },
    onSuccess: () => {
      invalidateTeam(queryClient)
      // Quick Quote's booking link reads the same column.
      queryClient.invalidateQueries({ queryKey: ['quickQuotes', 'loExtras'] })
    },
  })
}

/**
 * Hand a lead you just added to another loan officer (add_lead_for_lo): owners and
 * admins to anyone; an LO Assistant to the loan officers they assist, staying on
 * the file as its LO Assistant. notify = an Action Queue item and a push for the LO.
 * Before the LO assistant files script, falls back to the plain hand-over.
 */
export async function addLeadForLo(loanId: string, loId: string | null, notify: boolean): Promise<void> {
  if (!loId) {
    unwrap(await db().rpc('reassign_loan', { p_loan_id: loanId, p_lo_id: null }))
    return
  }
  const r = await db().rpc('add_lead_for_lo', { p_loan_id: loanId, p_lo_id: loId, p_notify: notify })
  if (r.error && /add_lead_for_lo/.test(r.error.message) && /(find|exist)/i.test(r.error.message)) {
    unwrap(await db().rpc('reassign_loan', { p_loan_id: loanId, p_lo_id: loId }))
    return
  }
  if (r.error) throw new Error(r.error.message)
}
