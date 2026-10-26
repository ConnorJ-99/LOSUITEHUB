import type { SupabaseClient } from '@supabase/supabase-js'
import { QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
})

/** Query keys in one place so saves can refresh exactly the right lists. */
export const keys = {
  pipeline: ['pipeline'] as const,
  loan: (id: string) => ['loan', id] as const,
  stageHistory: (id: string) => ['stageHistory', id] as const,
  contacts: ['contacts'] as const,
  contactLoans: (contactId: string) => ['contactLoans', contactId] as const,
  orgMembers: ['orgMembers'] as const,
  properties: (loanId: string) => ['properties', loanId] as const,
  notes: (contactId: string) => ['notes', contactId] as const,
  loanTasks: (loanId: string) => ['tasks', 'loan', loanId] as const,
  myTasks: ['tasks', 'mine'] as const,
  application: (loanId: string) => ['application', loanId] as const,
  organization: ['organization'] as const,
  myProfile: ['myProfile'] as const,
  matches: (email: string, phone: string) => ['matches', email, phone] as const,
  worksheets: (loanId: string) => ['worksheets', loanId] as const,
  queue: (loanId: string) => ['queue', loanId] as const,
  today: ['today'] as const,
  stepTemplates: ['stepTemplates'] as const,
  loanFile: (loanId: string) => ['loanFile', loanId] as const,
  templates: ['templates'] as const,
  documents: (loanId: string) => ['documents', loanId] as const,
  readings: (loanId: string) => ['readings', loanId] as const,
}

/** The Supabase client, or a clear error in preview mode (no .env.local). */
export function db(): SupabaseClient {
  if (!supabase) throw new Error('Not connected to Supabase. Add the dev project keys to .env.local.')
  return supabase
}

/** Turn a Supabase error into a thrown Error so TanStack Query reports it. */
export function unwrap<T>(result: { data: unknown; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}

/** Postgres numeric columns can arrive as strings; normalize to number or null. */
export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
