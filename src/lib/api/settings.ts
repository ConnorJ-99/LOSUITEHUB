import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth, type OrgRole } from '@/lib/auth/context'
import { db, keys, unwrap } from './client'

export interface Organization {
  id: string
  name: string
  nmls: string | null
  addressLine: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  /** The company logo in the brand-files bucket (null = the built-in MPS logo). */
  logoPath: string | null
  /** "Open in Arive": an Arive loan address with {number} where the loan number goes (null = no link). */
  ariveLoanUrl?: string | null
  /** The home county's one-unit loan limits for Max Approval (null = not set or the script hasn't run). */
  conformingLoanLimit?: number | null
  fhaLoanLimit?: number | null
  /** Default homeowner's insurance, percent of the price a year (Smart Fees script). */
  defaultHoiPct?: number | null
}

export interface Profile {
  id: string
  email: string
  fullName: string | null
  nmls: string | null
  phone: string | null
  stateLicense: string | null
  /** Signature image for letters, in the brand-files bucket. */
  signaturePath: string | null
  /** The LO's own cell, offered in the text after prequal results are emailed. */
  personalCell: string | null
}

interface OrgRow {
  id: string
  name: string
  nmls: string | null
  address_line: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  logo_path: string | null
  /** Present once the Arive link script has run (selected with *, so nothing breaks before). */
  arive_loan_url?: string | null
  /** Present once the loan limits script has run. */
  conforming_loan_limit?: number | string | null
  fha_loan_limit?: number | string | null
  default_hoi_pct?: number | string | null
}

interface ProfileRow {
  id: string
  email: string
  full_name: string | null
  nmls: string | null
  phone: string | null
  state_license: string | null
  signature_path: string | null
  personal_cell: string | null
}

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  nmls: r.nmls,
  phone: r.phone,
  stateLicense: r.state_license,
  signaturePath: r.signature_path,
  personalCell: r.personal_cell,
})

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v))

/** The signed-in user's organization (company name, NMLS, address). */
export function useOrganization() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: keys.organization,
    enabled: !!orgId,
    queryFn: async (): Promise<Organization | null> => {
      const r = unwrap<OrgRow | null>(
        await db().from('organizations').select('*').eq('id', orgId!).maybeSingle(),
      )
      return r ? { id: r.id, name: r.name, nmls: r.nmls, addressLine: r.address_line, city: r.city, state: r.state, zip: r.zip, phone: r.phone, logoPath: r.logo_path, ariveLoanUrl: r.arive_loan_url ?? null, conformingLoanLimit: num(r.conforming_loan_limit), fhaLoanLimit: num(r.fha_loan_limit), defaultHoiPct: num(r.default_hoi_pct) } : null
    },
  })
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...o }: Organization) => {
      const rows = unwrap<{ id: string }[]>(
        await db()
          .from('organizations')
          .update({
            name: o.name.trim(),
            nmls: o.nmls?.trim() || null,
            address_line: o.addressLine?.trim() || null,
            city: o.city?.trim() || null,
            state: o.state?.trim().toUpperCase() || null,
            zip: o.zip?.trim() || null,
            phone: o.phone?.trim() || null,
            // Sent only when it changed, so saving company details works before the Arive link script has run.
            ...((o.ariveLoanUrl?.trim() || null) !== (queryClient.getQueryData<Organization | null>(keys.organization)?.ariveLoanUrl ?? null) ? { arive_loan_url: o.ariveLoanUrl?.trim() || null } : {}),
            // Same for the loan limits (the loan limits script).
            ...((o.conformingLoanLimit ?? null) !== (queryClient.getQueryData<Organization | null>(keys.organization)?.conformingLoanLimit ?? null) ? { conforming_loan_limit: o.conformingLoanLimit ?? null } : {}),
            ...((o.fhaLoanLimit ?? null) !== (queryClient.getQueryData<Organization | null>(keys.organization)?.fhaLoanLimit ?? null) ? { fha_loan_limit: o.fhaLoanLimit ?? null } : {}),
          })
          .eq('id', id)
          .select('id'),
      )
      if (rows.length === 0) throw new Error('Only owners and admins can edit company details.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.organization }),
  })
}

/** Any profile the user can see (themselves or a teammate), e.g. the assigned LO for section 9. */
export function useProfile(id: string | null | undefined) {
  return useQuery({
    queryKey: [...keys.myProfile, id ?? ''],
    enabled: !!id,
    queryFn: async (): Promise<Profile | null> => {
      const r = unwrap<ProfileRow | null>(
        await db().from('profiles').select('id, email, full_name, nmls, phone, state_license, signature_path, personal_cell').eq('id', id!).maybeSingle(),
      )
      return r ? toProfile(r) : null
    },
  })
}

export function useUpdateMyProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (p: Profile) => {
      const rows = unwrap<{ id: string }[]>(
        await db()
          .from('profiles')
          .update({ full_name: p.fullName?.trim() || null, nmls: p.nmls?.trim() || null, phone: p.phone?.trim() || null, state_license: p.stateLicense?.trim() || null, personal_cell: p.personalCell?.trim() || null })
          .eq('id', p.id)
          .select('id'),
      )
      if (rows.length === 0) throw new Error('You can only edit your own profile.')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.myProfile })
      queryClient.invalidateQueries({ queryKey: keys.orgMembers })
    },
  })
}

// ---------------------------------------------------------------------------
// Team: owners and admins add, change and remove members. The database keeps
// at least one owner and lets only owners manage owners (team_settings script).
// ---------------------------------------------------------------------------

/** Add a login that already exists in Supabase Auth, by its email. */
export function useAddMember() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async ({ email, role }: { email: string; role: OrgRole }) => {
      unwrap(await db().rpc('add_member_by_email', { p_organization_id: orgId, p_email: email, p_role: role }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.orgMembers }),
  })
}

export function useSetMemberRole() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: OrgRole }) => {
      const rows = unwrap<{ user_id: string }[]>(
        await db().from('organization_members').update({ role }).eq('organization_id', orgId!).eq('user_id', userId).select('user_id'),
      )
      if (rows.length === 0) throw new Error('Only owners and admins can change roles.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.orgMembers }),
  })
}

export function useRemoveMember() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (userId: string) => {
      const rows = unwrap<{ user_id: string }[]>(
        await db().from('organization_members').delete().eq('organization_id', orgId!).eq('user_id', userId).select('user_id'),
      )
      if (rows.length === 0) throw new Error('Only owners and admins can remove people.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.orgMembers }),
  })
}
