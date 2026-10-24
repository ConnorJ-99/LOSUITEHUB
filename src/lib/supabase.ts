import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const environment = import.meta.env.VITE_SUPABASE_ENV as string | undefined

/**
 * Safety tripwire for CLAUDE.md rule 1: the app refuses to start against a
 * Supabase project unless .env.local explicitly marks it as the dev project.
 */
if (url && anonKey && environment !== 'development') {
  throw new Error(
    'Refusing to connect: set VITE_SUPABASE_ENV=development in .env.local, and only point it at the DEV Supabase project.',
  )
}

/** True once .env.local has the dev project's URL and anon key. */
export const isSupabaseConfigured = Boolean(url && anonKey)

/** Null in preview mode (no .env.local yet); the app then runs without a backend. */
export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url!, anonKey!) : null
