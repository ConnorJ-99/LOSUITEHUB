import { useEffect, useState } from 'react'
import type * as React from 'react'
import type { User } from '@supabase/supabase-js'
import { queryClient } from '@/lib/api/client'
import { supabase } from '@/lib/supabase'
import { AuthContext, type AuthState, type CurrentUser, type OrgRole } from './context'

const previewUser: CurrentUser = {
  id: 'preview',
  email: 'preview@mps.mortgage',
  fullName: 'Preview User',
  role: 'owner',
  organizationId: null,
  organizationName: 'MPS Mortgage LLC',
}

interface MembershipRow {
  role: OrgRole
  organization: { id: string; name: string } | null
  profile: { full_name: string | null } | null
}

/** Load the signed-in user's profile, organization and role. */
async function loadCurrentUser(user: User): Promise<CurrentUser> {
  const base: CurrentUser = {
    id: user.id,
    email: user.email ?? '',
    fullName: user.email ?? 'User',
    role: null,
    organizationId: null,
    organizationName: null,
  }
  if (!supabase) return base

  const { data } = await supabase
    .from('organization_members')
    .select('role, organization:organizations(id, name), profile:profiles(full_name)')
    .eq('user_id', user.id)
    // Always the same company: the one joined first (a user in several companies otherwise got a random one).
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<MembershipRow>()

  if (!data) return base
  return {
    ...base,
    fullName: data.profile?.full_name || base.fullName,
    role: data.role,
    organizationId: data.organization?.id ?? null,
    organizationName: data.organization?.name ?? null,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(
    supabase ? { status: 'loading' } : { status: 'preview', user: previewUser },
  )

  useEffect(() => {
    const client = supabase
    if (!client) return

    let cancelled = false
    const apply = async (user: User | null) => {
      const next: AuthState = user ? { status: 'signedIn', user: await loadCurrentUser(user) } : { status: 'signedOut' }
      if (!cancelled) setState(next)
    }

    client.auth.getSession().then(({ data }) => apply(data.session?.user ?? null))
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      // Defer so Supabase finishes its own auth work before we query tables.
      setTimeout(() => apply(session?.user ?? null), 0)
    })
    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase is not configured yet.' }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase?.auth.signOut()
    // Drop cached loans and contacts so the next person to sign in can't see them.
    queryClient.clear()
  }

  return <AuthContext.Provider value={{ state, signIn, signOut }}>{children}</AuthContext.Provider>
}
