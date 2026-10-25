import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth/context'
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
}

export interface Profile {
  id: string
  email: string
  fullName: string | null
  nmls: string | null
  phone: string | null
  stateLicense: string | null
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
}

interface ProfileRow {
  id: string
  email: string
  full_name: string | null
  nmls: string | null
  phone: string | null
  state_license: string | null
}

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  nmls: r.nmls,
  phone: r.phone,
  stateLicense: r.state_license,
})

/** The signed-in user's organization (company name, NMLS, address). */
export function useOrganization() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: keys.organization,
    enabled: !!orgId,
    queryFn: async (): Promise<Organization | null> => {
      const r = unwrap<OrgRow | null>(
        await db().from('organizations').select('id, name, nmls, address_line, city, state, zip, phone').eq('id', orgId!).maybeSingle(),
      )
      return r ? { id: r.id, name: r.name, nmls: r.nmls, addressLine: r.address_line, city: r.city, state: r.state, zip: r.zip, phone: r.phone } : null
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
        await db().from('profiles').select('id, email, full_name, nmls, phone, state_license').eq('id', id!).maybeSingle(),
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
          .update({ full_name: p.fullName?.trim() || null, nmls: p.nmls?.trim() || null, phone: p.phone?.trim() || null, state_license: p.stateLicense?.trim() || null })
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
