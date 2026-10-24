import { createContext, useContext } from 'react'

export type OrgRole = 'owner' | 'admin' | 'loan_officer' | 'processor'

export const roleLabels: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  loan_officer: 'Loan Officer',
  processor: 'Processor',
}

export interface CurrentUser {
  id: string
  email: string
  fullName: string
  role: OrgRole | null
  organizationId: string | null
  organizationName: string | null
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: CurrentUser }
  /** No Supabase configured yet: browse the app with a sample user. */
  | { status: 'preview'; user: CurrentUser }

export interface AuthContextValue {
  state: AuthState
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
